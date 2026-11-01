"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TranscriptView } from "@/components/TranscriptView";
import { loadIndex, type NoteMeta, type Transcript } from "@/lib/drive";
import { cache } from "@/lib/local";
import { deleteNote, loadAudio, loadNoteBody, transcriptToText, updateNote } from "@/lib/notes";
import { formatDuration } from "@/lib/recorder";
import { useAccessToken } from "@/lib/useAccessToken";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, status } = useAccessToken();

  const [meta, setMeta] = useState<NoteMeta | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState({ title: "", notes: "" });
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [tab, setTab] = useState<"notes" | "transcript">("notes");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const cached = (await cache.getIndex())?.notes.find((n) => n.id === id);
        const found = cached ?? (await loadIndex(token)).index.notes.find((n) => n.id === id);
        if (!found) {
          setMessage("This note couldn't be found. It may have been deleted from Drive.");
          return;
        }
        setMeta(found);
        setTitle(found.title);
        const body = await loadNoteBody(token, found);
        setNotes(body.notes);
        setSavedNotes({ title: found.title, notes: body.notes });
        setTranscript(body.transcript);
      } catch {
        setMessage("Couldn't load this note from Google Drive.");
      }
    })();
  }, [token, id]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const dirty = title !== savedNotes.title || notes !== savedNotes.notes;

  const save = async () => {
    if (!token || !meta) return;
    setSaving(true);
    try {
      const updated = await updateNote(token, meta, { title: title.trim() || meta.title, notes });
      setMeta(updated);
      setSavedNotes({ title: updated.title, notes });
      setMessage(null);
    } catch {
      setMessage("Couldn't save to Google Drive. Check your connection and try again.");
    }
    setSaving(false);
  };

  const playAudio = async () => {
    if (!token || !meta) return;
    setLoadingAudio(true);
    try {
      const blob = await loadAudio(token, meta);
      if (blob) setAudioUrl(URL.createObjectURL(blob));
    } catch {
      setMessage("Couldn't load the recording.");
    }
    setLoadingAudio(false);
  };

  const copyTranscript = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcriptToText(transcript));
    setMessage("Transcript copied.");
  };

  const remove = async () => {
    if (!token || !meta) return;
    if (!confirm("Move this note to your Google Drive trash?")) return;
    try {
      await deleteNote(token, meta);
      router.replace("/");
    } catch {
      setMessage("Couldn't delete this note.");
    }
  };

  return (
    <>
      <AppHeader back="/" />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
        {message && <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">{message}</p>}
        {!meta ? (
          !message && <p className="text-muted">Loading…</p>
        ) : (
          <>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-2xl font-bold outline-none"
              aria-label="Title"
            />
            <p className="mt-1 text-sm text-muted">
              {new Date(meta.createdAt).toLocaleString()} · {formatDuration(meta.durationSec * 1000)} ·{" "}
              {meta.language === "hi-IN" ? "हिंदी" : "English"}
            </p>

            <div className="mt-4">
              {audioUrl ? (
                <audio controls src={audioUrl} className="w-full" />
              ) : meta.audioFileId ? (
                <button onClick={playAudio} disabled={loadingAudio} className="rounded-full border border-border px-4 py-2 text-sm font-medium">
                  {loadingAudio ? "Loading recording…" : "▶ Play recording"}
                </button>
              ) : null}
            </div>

            <div className="mt-6 flex gap-2 border-b border-border">
              {(["notes", "transcript"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-accent" : "border-transparent text-muted"}`}
                >
                  {t === "notes" ? "Notes" : "Transcript"}
                </button>
              ))}
            </div>

            {tab === "notes" ? (
              <section className="mt-4">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="No notes yet. AI notes from the transcript are coming soon."
                  className="min-h-72 w-full resize-y rounded-2xl border border-border bg-card p-4 leading-relaxed outline-none focus:border-accent"
                />
              </section>
            ) : (
              <section className="mt-4 rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex justify-end">
                  <button onClick={copyTranscript} className="rounded-full border border-border px-3 py-1 text-xs font-medium">
                    Copy
                  </button>
                </div>
                <TranscriptView segments={transcript?.segments ?? []} />
              </section>
            )}

            <div className="mt-6 flex items-center justify-between">
              <button onClick={remove} className="text-sm text-muted underline">
                Delete note
              </button>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="rounded-full bg-accent px-6 py-2.5 font-semibold text-white disabled:opacity-40"
              >
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
