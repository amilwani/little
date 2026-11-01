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

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
export const ROOT_FOLDER_NAME = "Little";

export type NoteMeta = {
  id: string; // our own id, stable across devices
  title: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  durationSec: number;
  language: "en-IN" | "hi-IN";
  folderId: string;
  notesFileId?: string;
  transcriptFileId?: string;
  audioFileId?: string;
  aiNotesFileId?: string;
};

export type TranscriptSegment = {
  text: string;
  startSec: number;
};

export type Transcript = {
  language: string;
  source: "browser" | "gemini" | "openai";
  segments: TranscriptSegment[];
};

export type NoteIndex = { version: 1; notes: NoteMeta[] };

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

// ---- index.json: the list of all notes -------------------------------------

export async function loadIndex(token: string): Promise<{ index: NoteIndex; fileId: string | null }> {
  const root = await getRootFolder(token);
  const fileId = await findFileInFolder(token, root, "index.json");
  if (!fileId) return { index: { version: 1, notes: [] }, fileId: null };
  return { index: await readJson<NoteIndex>(token, fileId), fileId };
}

export async function saveIndex(token: string, index: NoteIndex, fileId: string | null) {
  const root = await getRootFolder(token);
  return saveFile(token, {
    name: "index.json",
    mimeType: "application/json",
    body: JSON.stringify(index, null, 2),
    folderId: root,
    fileId: fileId ?? undefined,
  });
}

/** Adds or replaces one note in index.json (read-modify-write). */
export async function upsertNoteInIndex(token: string, meta: NoteMeta) {
  const { index, fileId } = await loadIndex(token);
  const others = index.notes.filter((n) => n.id !== meta.id);
  index.notes = [meta, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  await saveIndex(token, index, fileId);
  return index;
}

export async function removeNoteFromIndex(token: string, noteId: string) {
  const { index, fileId } = await loadIndex(token);
  index.notes = index.notes.filter((n) => n.id !== noteId);
  await saveIndex(token, index, fileId);
  return index;
}

// ---- settings.json ----------------------------------------------------------

export type AiProvider = "gemini" | "openai" | "anthropic";

export type Settings = {
  version: 1;
  saveAudio: boolean;
  defaultLanguage: "en-IN" | "hi-IN";
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
