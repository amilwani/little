"use client";

// Browser cache (IndexedDB). Keeps the notes list instant and holds a note
// that hasn't reached Drive yet (offline, or the upload failed), so nothing is
// lost if the connection drops mid-meeting.

import { createStore, del, get, keys, set } from "idb-keyval";
import type { NoteIndex, Transcript } from "./drive";

const store = typeof indexedDB !== "undefined" ? createStore("little", "kv") : undefined;

export type PendingNote = {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number;
  language: "en-IN" | "hi-IN";
  notes: string;
  transcript: Transcript;
  audio: Blob | null;
  projectId?: string;
  template?: string;
};

export const cache = {
  getIndex: () => (store ? get<NoteIndex>("index", store) : Promise.resolve(undefined)),
  setIndex: (index: NoteIndex) => (store ? set("index", index, store) : Promise.resolve()),

  savePending: (note: PendingNote) => (store ? set(`pending:${note.id}`, note, store) : Promise.resolve()),
  removePending: (id: string) => (store ? del(`pending:${id}`, store) : Promise.resolve()),
  async listPending(): Promise<PendingNote[]> {
    if (!store) return [];
    const all = (await keys(store)).filter((k) => String(k).startsWith("pending:"));
    const notes = await Promise.all(all.map((k) => get<PendingNote>(k, store)));
    return notes.filter((n): n is PendingNote => !!n);
  },

  clear: async () => {
    if (!store) return;
    for (const k of await keys(store)) await del(k, store);
  },
};
