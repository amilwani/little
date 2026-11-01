"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
import { Mascot } from "@/components/Mascot";
import { TranscriptView } from "@/components/TranscriptView";
import {
  AiError,
  translateMarkdown,
  generateNotes,
  pickTextAi,
  pickTranscriber,
  PROVIDER_NAMES,
  transcribeAudio,
} from "@/lib/ai";
import {
  loadIndex,
  type NoteMeta,
  type Project,
  type Transcript,
} from "@/lib/drive";
import { cache } from "@/lib/local";
import {
  deleteNote,
  loadAiNotes,
  loadAudio,
  loadNoteBody,
  moveNotes,
  patchNote,
  saveAiNotes,
  toggleAction,
  saveTranscript,
  setTaskDone,
  transcriptToText,
  updateNote,
} from "@/lib/notes";
import { formatDuration } from "@/lib/recorder";
import { LANGUAGES, langInfo } from "@/lib/languages";
import { exportToGoogleDocs, noteAsHtml, noteAsText } from "@/lib/exportNote";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import {
  addActionToTodos,
  loadTodos,
  parseAction,
  todoTitlesForNote,
} from "@/lib/todos";
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [playSec, setPlaySec] = useState<number | undefined>();
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [tab, setTab] = useState<Tab>("ai");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showKeyNeeded, setShowKeyNeeded] = useState<
    null | "notes" | "transcript"
  >(null);
  const autoRan = useRef(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [onBoard, setOnBoard] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const cached = (await cache.getIndex())?.notes.find((n) => n.id === id);
        const found =
          cached ??
          (await loadIndex(token)).index.notes.find((n) => n.id === id);
        if (!found) {
          setMessage(
            "This note couldn't be found. It may have been deleted from Drive.",
          );
          return;
        }
        setMeta(found);
        setTitle(found.title);
        cache.getIndex().then((i) => setProjects(i?.projects ?? []));
        loadIndex(token)
          .then(({ index }) => setProjects(index.projects ?? []))
          .catch(() => {});
        loadTodos(token)
          .then((d) => setOnBoard(todoTitlesForNote(d.todos, found.id)))
          .catch(() => {});
        const [body, ai] = await Promise.all([
          loadNoteBody(token, found),
          loadAiNotes(token, found),
        ]);
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
    async (
      current: NoteMeta,
    ): Promise<{ meta: NoteMeta; transcript: Transcript } | null> => {
      if (!token || !transcriber || !current.audioFileId) return null;
      setAiBusy(
        `Transcribing the recording with ${PROVIDER_NAMES[transcriber.provider]}`,
      );
      const blob = await loadAudio(token, current);
      if (!blob) return null;
      const better = await transcribeAudio(
        transcriber,
        blob,
        current.language,
        current.attendees,
      );
      if (!better.segments.length) return null;
      const updated = await saveTranscript(token, current, better);
      setMeta(updated);
      setTranscript(better);
      return { meta: updated, transcript: better };
    },
    [token, transcriber],
  );

  const writeAiNotes = useCallback(
    async (
      current: NoteMeta,
      t: Transcript,
      userNotes: string,
      noteTitle: string,
    ) => {
      if (!token || !textAi) return;
      setAiBusy(`Writing notes with ${PROVIDER_NAMES[textAi.provider]}`);
      const md = await generateNotes(textAi, {
        title: noteTitle,
        language: current.language,
        transcript: t,
        notes: userNotes,
        template: current.template,
        attendees: current.attendees,
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
      setAiError(
        e instanceof AiError
          ? e.message
          : "Something went wrong. Please try again.",
      );
    }
    setAiBusy(null);
  };

  // Right after a recording: improve the transcript, then write AI notes, if keys allow.
  useEffect(() => {
    if (!isNew || autoRan.current || !meta || !transcript || !settingsLoaded)
      return;
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
      const updated = await updateNote(token, meta, {
        title: title.trim() || meta.title,
        notes,
      });
      setMeta(updated);
      setSavedNotes({ title: updated.title, notes });
      setMessage(null);
    } catch {
      setMessage(
        "Couldn't save to Google Drive. Check your connection and try again.",
      );
    }
    setSaving(false);
  };

  /** Plays the recording from a transcript line, loading it first if needed. */
  const seek = (sec: number) => {
    const el = audioRef.current;
    if (el) {
      el.currentTime = sec;
      el.play().catch(() => {});
      return;
    }
    pendingSeek.current = sec;
    playAudio();
  };

  const playAudio = async () => {
    if (!token || !meta || loadingAudio) return;
    setLoadingAudio(true);
    try {
      const blob = await loadAudio(token, meta);
      if (blob) setAudioUrl(URL.createObjectURL(blob));
    } catch {
      setMessage("Couldn't load the recording.");
    }
    setLoadingAudio(false);
  };

  const shareNote = async () => {
    if (!meta) return;
    const text = noteAsText(meta, aiNotes, notes);
    if (navigator.share) {
      try {
        await navigator.share({ title: meta.title, text });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    await copy(text, "Note");
  };

  const emailNote = () => {
    if (!meta) return;
    const body = noteAsText(meta, aiNotes, notes);
    window.location.href = `mailto:?subject=${encodeURIComponent(meta.title)}&body=${encodeURIComponent(body)}`;
  };

  const [exporting, setExporting] = useState(false);
  const [translated, setTranslated] = useState<{
    lang: string;
    text: string;
  } | null>(null);
  const translate = (lang: string) => {
    if (!aiNotes || !lang) return;
    if (!textAi) return setShowKeyNeeded("notes");
    run(async () => {
      setAiBusy(`Translating into ${langInfo(lang).name}`);
      setTranslated({
        lang,
        text: await translateMarkdown(textAi, aiNotes, lang),
      });
    });
  };
  const exportDoc = async () => {
    if (!token || !meta) return;
    // Open the tab now (while the tap still counts), then point it at the new doc.
    const tab = window.open("", "_blank");
    setExporting(true);
    try {
      const url = await exportToGoogleDocs(
        token,
        meta,
        noteAsHtml(meta, aiNotes, notes, transcript),
      );
      if (tab) tab.location.href = url;
      else window.location.href = url;
      setMessage("Saved as a Google Doc next to this note in your Drive.");
    } catch {
      tab?.close();
      setMessage(
        "Couldn't create the Google Doc. Check your connection and try again.",
      );
    }
    setExporting(false);
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

  /** Saves pin, tags or template right away, keeping the page in step. */
  const patch = async (
    p: Partial<Pick<NoteMeta, "pinned" | "tags" | "template">>,
  ) => {
    if (!token || !meta) return;
    setMeta({ ...meta, ...p });
    try {
      const r = await patchNote(token, meta.id, p);
      if (r.note) setMeta(r.note);
    } catch {
      setMessage(
        "Couldn't save to Google Drive. Check your connection and try again.",
      );
    }
  };

  const changeProject = async (projectId: string) => {
    if (!token || !meta) return;
    setMeta({ ...meta, projectId: projectId || undefined });
    try {
      const index = await moveNotes(token, [meta.id], projectId || null);
      const fresh = index.notes.find((n) => n.id === meta.id);
      if (fresh) setMeta(fresh);
    } catch {
      setMessage(
        "Couldn't move this note. Check your connection and try again.",
      );
    }
  };

  const addTag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = tagDraft
      .trim()
      .replace(/^#/, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    setTagDraft("");
    if (!tag || meta?.tags?.includes(tag)) return;
    patch({ tags: [...(meta?.tags ?? []), tag] });
  };

  const tickTask = async (n: number, done: boolean) => {
    if (!token || !meta || !aiNotes) return;
    const before = aiNotes;
    setAiNotes(setTaskDone(aiNotes, n, done));
    try {
      const r = await toggleAction(token, meta, n, done);
      setMeta(r.meta);
      setAiNotes(r.markdown);
    } catch {
      setAiNotes(before);
      setMessage(
        "Couldn't save to Google Drive. Check your connection and try again.",
      );
    }
  };

  const addToTodos = async (text: string) => {
    if (!token || !meta) return;
    const key = parseAction(text).title.toLowerCase();
    setOnBoard((s) => new Set(s).add(key));
    try {
      await addActionToTodos(token, meta, text);
    } catch {
      setOnBoard((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
      setMessage(
        "Couldn't add it to your to-dos. Check your connection and try again.",
      );
    }
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
        {message && (
          <p className="mb-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">
            {message}
          </p>
        )}
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
              {new Date(meta.createdAt).toLocaleString()} ·{" "}
              {formatDuration(meta.durationSec * 1000)} ·{" "}
              {langInfo(meta.language).native}
            </p>
            {meta.attendees?.length ? (
              <p className="mt-1 text-sm text-muted">
                📅 With {meta.attendees.join(", ")}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <button
                onClick={() => patch({ pinned: !meta.pinned })}
                className={`rounded-full border px-3 py-1 ${meta.pinned ? "border-accent bg-accent-soft" : "border-border"}`}
              >
                📌 {meta.pinned ? "Pinned" : "Pin"}
              </button>
              <select
                aria-label="Project"
                value={meta.projectId ?? ""}
                onChange={(e) => changeProject(e.target.value)}
                className="rounded-full border border-border bg-card px-3 py-1"
              >
                <option value="">📁 No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    📁 {p.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Meeting type"
                value={getTemplate(meta.template).id}
                onChange={(e) => patch({ template: e.target.value })}
                className="rounded-full border border-border bg-card px-3 py-1"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {meta.tags?.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    patch({ tags: meta.tags?.filter((x) => x !== t) })
                  }
                  className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs"
                  aria-label={`Remove tag ${t}`}
                >
                  #{t} ×
                </button>
              ))}
              <form onSubmit={addTag}>
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="+ tag"
                  className="w-20 rounded-full bg-transparent px-2 py-0.5 text-xs outline-none focus:w-32 focus:bg-card"
                />
              </form>
            </div>

            <div className="mt-4">
              {audioUrl ? (
                <audio
                  ref={audioRef}
                  controls
                  src={audioUrl}
                  className="w-full"
                  onLoadedMetadata={(e) => {
                    if (pendingSeek.current === null) return;
                    e.currentTarget.currentTime = pendingSeek.current;
                    pendingSeek.current = null;
                    e.currentTarget.play().catch(() => {});
                  }}
                  onTimeUpdate={(e) => setPlaySec(e.currentTarget.currentTime)}
                />
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

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={shareNote}
                className="rounded-full border border-border px-3 py-1.5 text-sm"
              >
                ↗ Share
              </button>
              <button
                onClick={emailNote}
                className="rounded-full border border-border px-3 py-1.5 text-sm"
              >
                ✉ Email
              </button>
              <button
                onClick={exportDoc}
                disabled={exporting}
                className="rounded-full border border-border px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {exporting ? "Creating doc…" : "📄 Google Docs"}
              </button>
            </div>

            {aiBusy && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
                <Mascot size={36} mood="listening" />
                <span>{aiBusy}…</span>
              </div>
            )}
            {aiError && (
              <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">
                {aiError}
              </p>
            )}
            {showKeyNeeded && (
              <div className="mt-4">
                <KeyNeeded
                  feature={
                    showKeyNeeded === "notes" ? "AI notes" : "AI transcripts"
                  }
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
                    tab === t.id
                      ? "border-accent"
                      : "border-transparent text-muted"
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
                    <div className="mb-3 flex flex-wrap justify-end gap-2">
                      <select
                        aria-label="Translate"
                        value=""
                        disabled={!!aiBusy}
                        onChange={(e) => translate(e.target.value)}
                        className="rounded-full border border-border bg-card px-2 py-1 text-xs font-medium"
                      >
                        <option value="">🌐 Translate…</option>
                        {LANGUAGES.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.native} · {l.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          copy(translated?.text ?? aiNotes, "AI notes")
                        }
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium"
                      >
                        Copy
                      </button>
                      <button
                        onClick={onWriteNotes}
                        disabled={!!aiBusy}
                        className="rounded-full border border-border px-3 py-1 text-xs font-medium disabled:opacity-40"
                      >
                        Rewrite as {getTemplate(meta.template).name}
                      </button>
                    </div>
                    {translated && (
                      <div className="mb-4 rounded-xl bg-background p-3">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted">
                          <span>
                            Translated into {langInfo(translated.lang).name}
                          </span>
                          <button
                            onClick={() => setTranslated(null)}
                            className="underline"
                          >
                            Show original
                          </button>
                        </div>
                        <Markdown source={translated.text} />
                      </div>
                    )}
                    {!translated && (
                      <Markdown
                        source={aiNotes}
                        onToggleTask={tickTask}
                        taskExtra={(text) =>
                          /^none mentioned/i.test(text) ? null : onBoard.has(
                              parseAction(text).title.toLowerCase(),
                            ) ? (
                            <span className="shrink-0 self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] text-muted">
                              ✓ In to-dos
                            </span>
                          ) : (
                            <button
                              onClick={() => addToTodos(text)}
                              className="shrink-0 self-start whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-medium hover:border-accent"
                            >
                              + To-do
                            </button>
                          )
                        }
                      />
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <Mascot size={72} />
                    <p className="max-w-xs text-sm text-muted">
                      I can turn the transcript and your notes into a summary,
                      key points and action items.
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
                      onClick={() =>
                        transcript &&
                        copy(transcriptToText(transcript), "Transcript")
                      }
                      className="rounded-full border border-border px-3 py-1 text-xs font-medium"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                {meta.audioFileId && (
                  <p className="mb-2 text-xs text-muted">
                    Tap a line to play the recording from there.
                  </p>
                )}
                <TranscriptView
                  segments={transcript?.segments ?? []}
                  onSeek={meta.audioFileId ? seek : undefined}
                  activeSec={audioUrl ? playSec : undefined}
                />
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
