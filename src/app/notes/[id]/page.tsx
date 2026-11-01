"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
import { Mascot } from "@/components/Mascot";
import { TranscriptView } from "@/components/TranscriptView";
import { AiError, generateNotes, pickTextAi, pickTranscriber, PROVIDER_NAMES, transcribeAudio } from "@/lib/ai";
import { loadIndex, type NoteMeta, type Transcript } from "@/lib/drive";
import { cache } from "@/lib/local";
import {
  deleteNote,
  loadAiNotes,
  loadAudio,
  loadNoteBody,
  saveAiNotes,
  saveTranscript,
  transcriptToText,
  updateNote,
} from "@/lib/notes";
import { formatDuration } from "@/lib/recorder";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

type Tab = "ai" | "notes" | "transcript";

export default function NotePageWrapper() {
  return (
    <Suspense>
      <NotePage />
    </Suspense>
  );
}

function NotePage() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get("new") === "1";
  const router = useRouter();
  const { token, status } = useAccessToken();
  const { settings, loaded: settingsLoaded } = useSettings(token);

  const [meta, setMeta] = useState<NoteMeta | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [savedNotes, setSavedNotes] = useState({ title: "", notes: "" });
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [aiNotes, setAiNotes] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showKeyNeeded, setShowKeyNeeded] = useState<null | "notes" | "transcript">(null);
  const autoRan = useRef(false);

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
        const [body, ai] = await Promise.all([loadNoteBody(token, found), loadAiNotes(token, found)]);
        setNotes(body.notes);
        setSavedNotes({ title: found.title, notes: body.notes });
        setTranscript(body.transcript);
        setAiNotes(ai);
      } catch {
        setMessage("Couldn't load this note from Google Drive.");
      }
    })();
  }, [token, id]);

  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const textAi = pickTextAi(settings);
  const transcriber = pickTranscriber(settings);

  /** Re-transcribes the saved recording with the user's Gemini or OpenAI key. */
  const improveTranscript = useCallback(
    async (current: NoteMeta): Promise<{ meta: NoteMeta; transcript: Transcript } | null> => {
      if (!token || !transcriber || !current.audioFileId) return null;
      setAiBusy(`Transcribing the recording with ${PROVIDER_NAMES[transcriber.provider]}`);
      const blob = await loadAudio(token, current);
      if (!blob) return null;
      const better = await transcribeAudio(transcriber, blob, current.language);
      if (!better.segments.length) return null;
      const updated = await saveTranscript(token, current, better);
      setMeta(updated);
      setTranscript(better);
      return { meta: updated, transcript: better };
    },
    [token, transcriber],
  );

  const writeAiNotes = useCallback(
    async (current: NoteMeta, t: Transcript, userNotes: string, noteTitle: string) => {
      if (!token || !textAi) return;
      setAiBusy(`Writing notes with ${PROVIDER_NAMES[textAi.provider]}`);
      const md = await generateNotes(textAi, {
        title: noteTitle,
        language: current.language,
        transcript: t,
        notes: userNotes,
      });
      setAiNotes(md);
      setTab("ai");
      const updated = await saveAiNotes(token, current, md);
      setMeta(updated);
    },
    [token, textAi],
  );

  const run = async (fn: () => Promise<void>) => {
    setAiError(null);
    try {
      await fn();
    } catch (e) {
      setAiError(e instanceof AiError ? e.message : "Something went wrong. Please try again.");
    }
    setAiBusy(null);
  };

  // Right after a recording: improve the transcript, then write AI notes, if keys allow.
  useEffect(() => {
    if (!isNew || autoRan.current || !meta || !transcript || !settingsLoaded) return;
    if (aiNotes) return;
    if (!textAi) return;
    autoRan.current = true;
    run(async () => {
      let m = meta;
      let t = transcript;
      if (transcriber && m.audioFileId) {
        try {
          const r = await improveTranscript(m);
          if (r) ({ meta: m, transcript: t } = r);
        } catch {
          /* keep the live transcript */
        }
      }
      await writeAiNotes(m, t, notes, title);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, meta, transcript, settingsLoaded, aiNotes]);

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

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setMessage(`${what} copied.`);
    setTimeout(() => setMessage(null), 2000);
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

  const onWriteNotes = () => {
    if (!meta || !transcript) return;
    if (!textAi) return setShowKeyNeeded("notes");
    run(() => writeAiNotes(meta, transcript, notes, title));
  };

  const onImproveTranscript = () => {
    if (!meta) return;
    if (!transcriber) return setShowKeyNeeded("transcript");
    run(async () => {
      const r = await improveTranscript(meta);
      if (!r) setAiError("No speech was found in the recording.");
    });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "ai", label: "AI notes" },
    { id: "notes", label: "My notes" },
    { id: "transcript", label: "Transcript" },
  ];

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
                <button
                  onClick={playAudio}
                  disabled={loadingAudio}
                  className="rounded-full border border-border px-4 py-2 text-sm font-medium"
                >
                  {loadingAudio ? "Loading recording…" : "▶ Play recording"}
                </button>
              ) : null}
            </div>

            {aiBusy && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
                <Mascot size={36} mood="listening" />
                <span>{aiBusy}…</span>
              </div>
            )}
            {aiError && <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">{aiError}</p>}
            {showKeyNeeded && (
              <div className="mt-4">
                <KeyNeeded
                  feature={showKeyNeeded === "notes" ? "AI notes" : "AI transcripts"}
                  audio={showKeyNeeded === "transcript"}
                />
              </div>
            )}

            <div className="mt-6 flex gap-1 border-b border-border">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                    tab === t.id ? "border-accent" : "border-transparent text-muted"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "ai" && (
              <section className="mt-4 rounded-2xl border border-border bg-card p-4">
                {aiNotes ? (
                  <>
                    <div className="mb-3 flex justify-end gap-2">
                      <button
                        onClick={() => copy(aiNotes, "AI notes")}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium"
                      >
                        Copy
                      </button>
                      <button
                        onClick={onWriteNotes}
                        disabled={!!aiBusy}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium disabled:opacity-40"
                      >
                        Rewrite
                      </button>
                    </div>
                    <Markdown source={aiNotes} />
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <Mascot size={72} />
                    <p className="max-w-xs text-sm text-muted">
                      I can turn the transcript and your notes into a summary, key points and action items.
                    </p>
                    <button
                      onClick={onWriteNotes}
                      disabled={!!aiBusy}
                      className="rounded-full bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-40"
                    >
                      ✨ Write AI notes
                    </button>
                  </div>
                )}
              </section>
            )}

            {tab === "notes" && (
              <section className="mt-4">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Your own notes for this recording."
                  className="min-h-72 w-full resize-y rounded-2xl border border-border bg-card p-4 leading-relaxed outline-none focus:border-accent"
                />
              </section>
            )}

            {tab === "transcript" && (
              <section className="mt-4 rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {transcript?.source === "gemini"
                      ? "AI transcript (Gemini)"
                      : transcript?.source === "openai"
                        ? "AI transcript (OpenAI)"
                        : "Live transcript from your browser"}
                  </span>
                  <div className="flex gap-2">
                    {meta.audioFileId && transcript?.source === "browser" && (
                      <button
                        onClick={onImproveTranscript}
                        disabled={!!aiBusy}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium disabled:opacity-40"
                      >
                        ✨ Improve with AI
                      </button>
                    )}
                    <button
                      onClick={() => transcript && copy(transcriptToText(transcript), "Transcript")}
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium"
                    >
                      Copy
                    </button>
                  </div>
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
