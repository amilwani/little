"use client";

import {
  createFolder,
  loadIndex,
  moveFile,
  patchNoteInIndex,
  renameFile,
  updateIndex,
  type ActionItem,
  type Project,
  getRootFolder,
  readBlob,
  readJson,
  readText,
  removeNoteFromIndex,
  saveFile,
  trashFile,
  uploadLargeFile,
  upsertNoteInIndex,
  type NoteMeta,
  type Transcript,
} from "./drive";
import { cache, type PendingNote } from "./local";

function folderName(note: { title: string; createdAt: string }) {
  const day = note.createdAt.slice(0, 10);
  const safe = note.title.replace(/[\\/:*?"<>|]/g, " ").trim() || "Untitled";
  return `${day} ${safe}`;
}

function audioExtension(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export function transcriptToText(t: Transcript) {
  return t.segments.map((s) => s.text).join(" ");
}

function notesMarkdown(note: PendingNote) {
  return `# ${note.title}\n\n${note.notes.trim()}\n`;
}

/** Writes a finished recording to the user's Drive and updates index.json. */
export async function saveNoteToDrive(
  token: string,
  note: PendingNote,
  opts: { saveAudio: boolean; onProgress?: (step: string) => void },
): Promise<NoteMeta> {
  const root = await getRootFolder(token);
  opts.onProgress?.("Creating folder");
  let parent = root;
  if (note.projectId) {
    const { index } = await loadIndex(token);
    parent = index.projects?.find((p) => p.id === note.projectId)?.folderId ?? root;
  }
  const folderId = await createFolder(token, folderName(note), parent);

  opts.onProgress?.("Saving notes");
  const notesFileId = await saveFile(token, {
    name: "notes.md",
    mimeType: "text/markdown",
    body: notesMarkdown(note),
    folderId,
  });

  opts.onProgress?.("Saving transcript");
  const transcriptFileId = await saveFile(token, {
    name: "transcript.json",
    mimeType: "application/json",
    body: JSON.stringify(note.transcript, null, 2),
    folderId,
  });

  let audioFileId: string | undefined;
  if (opts.saveAudio && note.audio && note.audio.size > 0) {
    audioFileId = await uploadLargeFile(token, {
      name: `audio.${audioExtension(note.audio.type)}`,
      mimeType: note.audio.type || "audio/webm",
      blob: note.audio,
      folderId,
      onProgress: (f) => opts.onProgress?.(`Uploading recording ${Math.round(f * 100)}%`),
    });
  }

  const now = new Date().toISOString();
  const meta: NoteMeta = {
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: now,
    durationSec: note.durationSec,
    language: note.language,
    folderId,
    notesFileId,
    transcriptFileId,
    audioFileId,
    projectId: note.projectId,
    template: note.template,
  };
  opts.onProgress?.("Updating your notes list");
  const index = await upsertNoteInIndex(token, meta);
  await cache.setIndex(index);
  await cache.removePending(note.id);
  return meta;
}

/** Tries to upload notes that were saved offline or whose upload failed. */
export async function syncPending(token: string, saveAudio: boolean) {
  const pending = await cache.listPending();
  let synced = 0;
  for (const note of pending) {
    try {
      await saveNoteToDrive(token, note, { saveAudio });
      synced++;
    } catch {
      /* try again next time */
    }
  }
  return synced;
}

export async function loadNoteBody(token: string, meta: NoteMeta) {
  const [notesMd, transcript] = await Promise.all([
    meta.notesFileId ? readText(token, meta.notesFileId) : Promise.resolve(""),
    meta.transcriptFileId
      ? readJson<Transcript>(token, meta.transcriptFileId)
      : Promise.resolve<Transcript>({ language: meta.language, source: "browser", segments: [] }),
  ]);
  // Strip the "# Title" line we write at the top of notes.md.
  const notes = notesMd.replace(/^# .*\n+/, "");
  return { notes, transcript };
}

export async function loadAudio(token: string, meta: NoteMeta) {
  return meta.audioFileId ? readBlob(token, meta.audioFileId) : null;
}

export async function updateNote(token: string, meta: NoteMeta, changes: { title: string; notes: string }) {
  const notesFileId = await saveFile(token, {
    name: "notes.md",
    mimeType: "text/markdown",
    body: `# ${changes.title}\n\n${changes.notes.trim()}\n`,
    folderId: meta.folderId,
    fileId: meta.notesFileId,
  });
  return patchAndCache(token, meta, { title: changes.title, notesFileId, updatedAt: new Date().toISOString() });
}

async function patchAndCache(token: string, meta: NoteMeta, patch: Partial<NoteMeta>) {
  const { index, note } = await patchNoteInIndex(token, meta.id, patch);
  await cache.setIndex(index);
  return note ?? { ...meta, ...patch };
}

export async function deleteNote(token: string, meta: NoteMeta) {
  // Moves the note's folder to the Drive trash, so it can still be restored.
  await trashFile(token, meta.folderId);
  const index = await removeNoteFromIndex(token, meta.id);
  await cache.setIndex(index);
}

export async function loadAiNotes(token: string, meta: NoteMeta) {
  return meta.aiNotesFileId ? readText(token, meta.aiNotesFileId) : null;
}

/** Saves AI notes as ai-notes.md next to the note and records it in index.json. */
export async function saveAiNotes(token: string, meta: NoteMeta, markdown: string) {
  const aiNotesFileId = await saveFile(token, {
    name: "ai-notes.md",
    mimeType: "text/markdown",
    body: markdown,
    folderId: meta.folderId,
    fileId: meta.aiNotesFileId,
  });
  return patchAndCache(token, meta, {
    aiNotesFileId,
    actions: extractActions(markdown),
    updatedAt: new Date().toISOString(),
  });
}

/** Replaces transcript.json, e.g. with a more accurate AI transcript. */
export async function saveTranscript(token: string, meta: NoteMeta, transcript: Transcript) {
  const transcriptFileId = await saveFile(token, {
    name: "transcript.json",
    mimeType: "application/json",
    body: JSON.stringify(transcript, null, 2),
    folderId: meta.folderId,
    fileId: meta.transcriptFileId,
  });
  return patchAndCache(token, meta, { transcriptFileId, updatedAt: new Date().toISOString() });
}

// ---- Action items -------------------------------------------------------------

const TASK = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;

export function extractActions(markdown: string): ActionItem[] {
  return markdown
    .split("\n")
    .map((line) => line.match(TASK))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ text: m[4].trim(), done: m[2] !== " " }));
}

/** Ticks or unticks the n-th task in a Markdown string. */
export function setTaskDone(markdown: string, n: number, done: boolean) {
  let i = -1;
  return markdown
    .split("\n")
    .map((line) => {
      const m = line.match(TASK);
      if (!m || ++i !== n) return line;
      return `${m[1]}${done ? "x" : " "}${m[3]}${m[4]}`;
    })
    .join("\n");
}

/** Ticks a task in the note's ai-notes.md and returns the updated note and Markdown. */
export async function toggleAction(token: string, meta: NoteMeta, n: number, done: boolean) {
  const current = await loadAiNotes(token, meta);
  if (current === null) throw new Error("No AI notes");
  const next = setTaskDone(current, n, done);
  const updated = await saveAiNotes(token, meta, next);
  return { meta: updated, markdown: next };
}

// ---- Pins, tags, templates ----------------------------------------------------

/** Changes small fields of a note (pin, tags, template) in index.json. */
export async function patchNote(
  token: string,
  id: string,
  patch: Partial<Pick<NoteMeta, "pinned" | "tags" | "template" | "title">>,
) {
  const r = await patchNoteInIndex(token, id, patch);
  await cache.setIndex(r.index);
  return r;
}

// ---- Projects -----------------------------------------------------------------

export const PROJECT_COLORS = ["#f07167", "#f4a261", "#e9c46a", "#2a9d8f", "#4d96ff", "#9b5de5", "#ef476f", "#6c757d"];

function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, " ").trim() || "Project";
}

export async function createProject(token: string, name: string, color?: string, owner?: string) {
  const root = await getRootFolder(token);
  const folderId = await createFolder(token, safeName(name), root);
  const { index: before } = await loadIndex(token);
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim() || "Project",
    color: color ?? PROJECT_COLORS[(before.projects?.length ?? 0) % PROJECT_COLORS.length],
    folderId,
    createdAt: new Date().toISOString(),
    owner,
    role: "owner",
  };
  const index = await updateIndex(token, (idx) => {
    idx.projects = [...(idx.projects ?? []), project];
  });
  await cache.setIndex(index);
  return { index, project };
}

export async function updateProject(token: string, project: Project, changes: { name?: string; color?: string }) {
  if (changes.name && changes.name !== project.name) await renameFile(token, project.folderId, safeName(changes.name));
  const index = await updateIndex(token, (idx) => {
    idx.projects = idx.projects?.map((p) => (p.id === project.id ? { ...p, ...changes } : p));
  });
  await cache.setIndex(index);
  return index;
}

/** Stops showing a project someone shared with you. Their Drive is untouched. */
export async function leaveProject(token: string, project: Project) {
  const index = await updateIndex(token, (idx) => {
    idx.projects = idx.projects?.filter((p) => p.id !== project.id);
    idx.notes = idx.notes.filter((n) => n.projectId !== project.id);
  });
  await cache.setIndex(index);
  return index;
}

/** Deletes a project. Its notes are kept and moved back to "No project". */
export async function deleteProject(token: string, project: Project) {
  const root = await getRootFolder(token);
  const { index: current } = await loadIndex(token);
  const inside = current.notes.filter((n) => n.projectId === project.id);
  await Promise.all(inside.map((n) => moveFile(token, n.folderId, root)));
  await trashFile(token, project.folderId);
  const index = await updateIndex(token, (idx) => {
    idx.projects = idx.projects?.filter((p) => p.id !== project.id);
    idx.notes = idx.notes.map((n) => (n.projectId === project.id ? { ...n, projectId: undefined } : n));
  });
  await cache.setIndex(index);
  return index;
}

/** Moves notes into a project (or out of all projects when projectId is null). */
export async function moveNotes(token: string, noteIds: string[], projectId: string | null) {
  const root = await getRootFolder(token);
  const { index: current } = await loadIndex(token);
  const target = projectId ? current.projects?.find((p) => p.id === projectId) : undefined;
  if (projectId && !target) throw new Error("Project not found");
  const notes = current.notes.filter((n) => noteIds.includes(n.id) && (n.projectId ?? null) !== projectId);
  await Promise.all(notes.map((n) => moveFile(token, n.folderId, target?.folderId ?? root)));
  const moved = new Set(notes.map((n) => n.id));
  const index = await updateIndex(token, (idx) => {
    idx.notes = idx.notes.map((n) => (moved.has(n.id) ? { ...n, projectId: projectId ?? undefined } : n));
  });
  await cache.setIndex(index);
  return index;
}
