// Client-side Google Drive helpers. Everything Little saves lives in a
// "Little" folder in the user's own Drive:
//
//   Little/
//     index.json                     list of notes, for a fast notes list
//     settings.json                  user settings (AI keys, preferences)
//     2026-11-01 Team sync/
//       notes.md                     typed notes (and AI notes later)
//       transcript.json              transcript with timestamps
//       ai-notes.md                  AI summary, key points, action items
//       audio.webm                   the recording
//
// We use the `drive.file` scope, so Little can only see files it created.

import type { Lang } from "./languages";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Little";

export type NoteMeta = {
  id: string; // our own id, stable across devices
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  durationSec: number;
  /** "written" for a note typed by hand, with no recording. */
  kind?: "written";
  language: Lang;
  folderId: string;
  notesFileId?: string;
  transcriptFileId?: string;
  audioFileId?: string;
  aiNotesFileId?: string;
  projectId?: string;
  tags?: string[];
  pinned?: boolean;
  template?: string;
  /** The Google Calendar event this note was recorded for. */
  calendarEventId?: string;
  /** Who was invited, as names or emails, from the calendar event. */
  attendees?: string[];
  /** Task list items from the AI notes, kept here so the Actions page is fast. */
  actions?: ActionItem[];
};

export type ActionItem = { text: string; done: boolean };

export type Project = {
  id: string;
  name: string;
  color: string;
  /** The project's folder in Drive (Little/<name>/), holding its notes' folders. */
  folderId: string;
  createdAt: string;
  /** Email of the person whose Drive holds the project. */
  owner?: string;
  /** True once the project has been shared with anyone. */
  shared?: boolean;
  /** "member" when someone else shared this project with you. */
  role?: "owner" | "member";
  /** Set when the project can't be read (unshared, deleted or offline). */
  unavailable?: boolean;
};

export type TranscriptSegment = {
  text: string;
  startSec: number;
  /** Who said it, when an AI transcript could tell. */
  speaker?: string;
};

export type Transcript = {
  language: string;
  source: "browser" | "gemini" | "openai";
  segments: TranscriptSegment[];
};

export type NoteIndex = { version: 1; notes: NoteMeta[]; projects?: Project[] };

export class DriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new DriveError(`Drive request failed (${res.status}): ${await res.text()}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

function escapeQuery(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOne(token: string, q: string): Promise<string | null> {
  const params = new URLSearchParams({ q, fields: "files(id)", spaces: "drive", pageSize: "1" });
  const data = await call<{ files: { id: string }[] }>(token, `${API}/files?${params}`);
  return data.files[0]?.id ?? null;
}

export async function createFolder(token: string, name: string, parentId?: string) {
  const data = await call<{ id: string }>(token, `${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
  });
  return data.id;
}

let rootFolderPromise: Promise<string> | null = null;

/** Finds or creates the "Little" folder at the top of the user's Drive. */
export function getRootFolder(token: string): Promise<string> {
  rootFolderPromise ??= (async () => {
    const existing = await findOne(
      token,
      `name = '${ROOT_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    );
    return existing ?? createFolder(token, ROOT_FOLDER_NAME);
  })().catch((e) => {
    rootFolderPromise = null;
    throw e;
  });
  return rootFolderPromise;
}

export async function findFileInFolder(token: string, folderId: string, name: string) {
  return findOne(token, `name = '${escapeQuery(name)}' and '${folderId}' in parents and trashed = false`);
}

/** Creates or replaces a small file (JSON, Markdown) with one multipart request. */
export async function saveFile(
  token: string,
  opts: { name: string; mimeType: string; body: Blob | string; folderId: string; fileId?: string },
): Promise<string> {
  const boundary = `little-${crypto.randomUUID()}`;
  const metadata = opts.fileId ? { name: opts.name } : { name: opts.name, parents: [opts.folderId] };
  const content = typeof opts.body === "string" ? new Blob([opts.body], { type: opts.mimeType }) : opts.body;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${opts.mimeType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ]);
  const url = opts.fileId
    ? `${UPLOAD}/files/${opts.fileId}?uploadType=multipart&fields=id`
    : `${UPLOAD}/files?uploadType=multipart&fields=id`;
  const data = await call<{ id: string }>(token, url, {
    method: opts.fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return data.id;
}

/**
 * Uploads a large file (a recording) with Drive's resumable upload, in 8 MB
 * chunks, so long meetings work on slow mobile connections.
 */
export async function uploadLargeFile(
  token: string,
  opts: { name: string; mimeType: string; blob: Blob; folderId: string; onProgress?: (fraction: number) => void },
): Promise<string> {
  const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mimeType,
      "X-Upload-Content-Length": String(opts.blob.size),
    },
    body: JSON.stringify({ name: opts.name, parents: [opts.folderId] }),
  });
  if (!start.ok) throw new DriveError(`Could not start upload (${start.status})`, start.status);
  const sessionUrl = start.headers.get("Location");
  if (!sessionUrl) throw new DriveError("Drive did not return an upload URL", 500);

  const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KB
  const total = opts.blob.size;
  let offset = 0;
  while (true) {
    const end = Math.min(offset + CHUNK, total);
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": total === 0 ? "bytes */0" : `bytes ${offset}-${end - 1}/${total}` },
      body: opts.blob.slice(offset, end),
    });
    if (res.status === 200 || res.status === 201) {
      opts.onProgress?.(1);
      return ((await res.json()) as { id: string }).id;
    }
    if (res.status !== 308) throw new DriveError(`Upload failed (${res.status})`, res.status);
    const range = res.headers.get("Range"); // e.g. "bytes=0-8388607"
    offset = range ? Number(range.split("-")[1]) + 1 : end;
    opts.onProgress?.(offset / total);
  }
}

export async function readText(token: string, fileId: string): Promise<string> {
  return call<string>(token, `${API}/files/${fileId}?alt=media`, { headers: { Accept: "text/plain" } }).then(
    (v) => (typeof v === "string" ? v : JSON.stringify(v)),
  );
}

export async function readJson<T>(token: string, fileId: string): Promise<T> {
  return JSON.parse(await readText(token, fileId)) as T;
}

export async function readBlob(token: string, fileId: string): Promise<Blob> {
  const res = await fetch(`${API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new DriveError(`Could not download file (${res.status})`, res.status);
  return res.blob();
}

export async function trashFile(token: string, fileId: string) {
  await call(token, `${API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

// ---- The notes list -----------------------------------------------------------
//
// Notes that aren't in a project are listed in Little/index.json, which also
// lists the user's projects. Each project's notes are listed in
// <project folder>/project.json, so a project shared with teammates carries its
// own list. loadIndex() combines them into one view; updateIndex() writes back
// only the files whose part of the view changed.

type ProjectFile = {
  version: 1;
  project: { id: string; name: string; color: string; createdAt: string; owner?: string };
  notes: NoteMeta[];
};

type Loaded = {
  index: NoteIndex;
  personal: { fileId: string | null; raw: string };
  projectFiles: Map<string, { fileId: string | null; raw: string | null }>;
};

const PROJECT_FILE = "project.json";

function personalJson(index: NoteIndex) {
  const known = new Set((index.projects ?? []).filter((p) => !p.unavailable).map((p) => p.id));
  return JSON.stringify(
    {
      version: 1,
      notes: index.notes.filter((n) => !n.projectId || !known.has(n.projectId)),
      projects: (index.projects ?? []).map(({ unavailable, ...ref }) => (void unavailable, ref)),
    },
    null,
    2,
  );
}

function projectJson(index: NoteIndex, p: Project) {
  const file: ProjectFile = {
    version: 1,
    project: { id: p.id, name: p.name, color: p.color, createdAt: p.createdAt, owner: p.owner },
    notes: index.notes.filter((n) => n.projectId === p.id),
  };
  return JSON.stringify(file, null, 2);
}

async function loadAll(token: string): Promise<Loaded> {
  const root = await getRootFolder(token);
  const fileId = await findFileInFolder(token, root, "index.json");
  const personalRaw = fileId ? await readText(token, fileId) : "";
  const personal: NoteIndex = personalRaw ? JSON.parse(personalRaw) : { version: 1, notes: [] };
  const projects = personal.projects ?? [];
  const projectFiles: Loaded["projectFiles"] = new Map();
  let notes = [...personal.notes];

  await Promise.all(
    projects.map(async (p, i) => {
      try {
        const id = await findFileInFolder(token, p.folderId, PROJECT_FILE);
        if (!id) {
          // A project from before project.json existed: its notes are still in index.json.
          projectFiles.set(p.id, { fileId: null, raw: null });
          return;
        }
        const raw = await readText(token, id);
        const file = JSON.parse(raw) as ProjectFile;
        projectFiles.set(p.id, { fileId: id, raw });
        // project.json is the source of truth for a project's name and colour.
        projects[i] = { ...p, ...file.project, folderId: p.folderId, shared: p.shared, role: p.role };
        notes = notes.filter((n) => n.projectId !== p.id).concat(file.notes.map((n) => ({ ...n, projectId: p.id })));
      } catch {
        // Unshared, deleted or offline: show it as unavailable and never overwrite it.
        projects[i] = { ...p, unavailable: true };
      }
    }),
  );

  notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const index: NoteIndex = { version: 1, notes, projects };
  return { index, personal: { fileId, raw: personalRaw }, projectFiles };
}

export async function loadIndex(token: string): Promise<{ index: NoteIndex }> {
  return { index: (await loadAll(token)).index };
}

async function saveAll(token: string, before: Loaded, index: NoteIndex) {
  const root = await getRootFolder(token);
  const writes: Promise<unknown>[] = [];
  for (const p of index.projects ?? []) {
    if (p.unavailable) continue;
    const raw = projectJson(index, p);
    const prev = before.projectFiles.get(p.id);
    if (prev && prev.raw === raw) continue;
    writes.push(
      saveFile(token, {
        name: PROJECT_FILE,
        mimeType: "application/json",
        body: raw,
        folderId: p.folderId,
        fileId: prev?.fileId ?? undefined,
      }),
    );
  }
  // Write project files first, so a note is never missing from both lists.
  await Promise.all(writes);
  const raw = personalJson(index);
  if (raw !== before.personal.raw) {
    await saveFile(token, {
      name: "index.json",
      mimeType: "application/json",
      body: raw,
      folderId: root,
      fileId: before.personal.fileId ?? undefined,
    });
  }
}

/** Adds or replaces one note. */
export async function upsertNoteInIndex(token: string, meta: NoteMeta) {
  return updateIndex(token, (index) => {
    const others = index.notes.filter((n) => n.id !== meta.id);
    index.notes = [meta, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

/** Changes some fields of one note, keeping fields changed elsewhere. */
export async function patchNoteInIndex(token: string, id: string, patch: Partial<NoteMeta>) {
  let updated: NoteMeta | undefined;
  const index = await updateIndex(token, (idx) => {
    idx.notes = idx.notes.map((n) => (n.id === id ? (updated = { ...n, ...patch }) : n));
  });
  return { index, note: updated };
}

let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write of the notes list. Changes from this tab run one at a
 * time, so quick edits (a tag, then a pin) never overwrite each other.
 */
export function updateIndex(token: string, change: (index: NoteIndex) => void): Promise<NoteIndex> {
  const run = indexQueue.then(async () => {
    const before = await loadAll(token);
    const index: NoteIndex = structuredClone(before.index);
    index.projects ??= [];
    change(index);
    await saveAll(token, before, index);
    return index;
  });
  indexQueue = run.catch(() => {});
  return run;
}

/** Moves a file or folder from one Drive folder to another. */
export async function moveFile(token: string, fileId: string, toFolderId: string) {
  const current = await call<{ parents?: string[] }>(token, `${API}/files/${fileId}?fields=parents`);
  const params = new URLSearchParams({ addParents: toFolderId, fields: "id" });
  const remove = (current.parents ?? []).filter((p) => p !== toFolderId).join(",");
  if (remove) params.set("removeParents", remove);
  await call(token, `${API}/files/${fileId}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function renameFile(token: string, fileId: string, name: string) {
  await call(token, `${API}/files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/**
 * Full-text search across Little's files in Drive (notes, transcripts, AI
 * notes). Returns the ids of the folders that hold matching files.
 */
export async function searchDrive(token: string, text: string): Promise<Set<string>> {
  const q = `fullText contains '${escapeQuery(text)}' and trashed = false and mimeType != '${FOLDER_MIME}'`;
  const params = new URLSearchParams({ q, fields: "files(parents)", spaces: "drive", pageSize: "200" });
  const data = await call<{ files: { parents?: string[] }[] }>(token, `${API}/files?${params}`);
  return new Set(data.files.flatMap((f) => f.parents ?? []));
}

export async function removeNoteFromIndex(token: string, noteId: string) {
  return updateIndex(token, (index) => {
    index.notes = index.notes.filter((n) => n.id !== noteId);
  });
}

// ---- settings.json ----------------------------------------------------------

export type AiProvider = "gemini" | "openai" | "anthropic";

export type Settings = {
  version: 1;
  saveAudio: boolean;
  defaultLanguage: Lang;
  aiProvider: AiProvider | null;
  apiKeys: Partial<Record<AiProvider, string>>;
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  saveAudio: true,
  defaultLanguage: "en-IN",
  aiProvider: null,
  apiKeys: {},
};

/** Returns null when there is no settings.json in Drive yet. */
export async function loadSettings(token: string): Promise<Settings | null> {
  const root = await getRootFolder(token);
  const fileId = await findFileInFolder(token, root, "settings.json");
  if (!fileId) return null;
  return { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(token, fileId)) };
}

export async function saveSettings(token: string, settings: Settings) {
  const root = await getRootFolder(token);
  const fileId = await findFileInFolder(token, root, "settings.json");
  return saveFile(token, {
    name: "settings.json",
    mimeType: "application/json",
    body: JSON.stringify(settings, null, 2),
    folderId: root,
    fileId: fileId ?? undefined,
  });
}
