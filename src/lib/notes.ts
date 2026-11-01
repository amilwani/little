"use client";

import {
  createFolder,
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
  const folderId = await createFolder(token, folderName(note), root);

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
  const updated: NoteMeta = { ...meta, title: changes.title, notesFileId, updatedAt: new Date().toISOString() };
  const index = await upsertNoteInIndex(token, updated);
  await cache.setIndex(index);
  return updated;
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
  const updated: NoteMeta = { ...meta, aiNotesFileId, updatedAt: new Date().toISOString() };
  const index = await upsertNoteInIndex(token, updated);
  await cache.setIndex(index);
  return updated;
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
  const updated: NoteMeta = { ...meta, transcriptFileId, updatedAt: new Date().toISOString() };
  const index = await upsertNoteInIndex(token, updated);
  await cache.setIndex(index);
  return updated;
}
