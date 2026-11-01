"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
import { Mascot } from "@/components/Mascot";
import { Icon } from "@/components/Icon";
import { Menu } from "@/components/Menu";
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

/** Keeps the last notes you opened, for Recent in the sidebar. */
function rememberRecent(id: string) {
  try {
    const list: string[] = JSON.parse(localStorage.getItem("little:recent") ?? "[]");
    localStorage.setItem("little:recent", JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 8)));
    window.dispatchEvent(new Event("little:recent"));
  } catch {
    /* storage blocked */
  }
}

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
        rememberRecent(found.id);
        if (found.kind === "written") setTab("notes");
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

  // Messages show as a toast for a few seconds.
  useEffect(() => {
    if (!message || !meta) return;
    const t = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(t);
  }, [message, meta]);

  // Ctrl/⌘ S saves.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const written = meta?.kind === "written";
  const tabs: { id: Tab; label: string }[] = written
    ? [
        { id: "notes", label: "Note" },
        { id: "ai", label: "AI summary" },
      ]
    : [
        { id: "ai", label: "AI notes" },
        { id: "notes", label: "My notes" },
        { id: "transcript", label: "Transcript" },
      ];

  const project = meta?.projectId ? projects.find((p) => p.id === meta.projectId) : undefined;
  const template = meta ? getTemplate(meta.template) : null;
  const pill = "h-8 rounded-lg border border-border bg-card px-2.5 text-[13px] hover:border-foreground/30";
  const toolBtn = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-subtle hover:text-foreground disabled:opacity-40";

  return (
    <>
      <AppHeader
        back={meta?.projectId ? `/notes?p=${meta.projectId}` : "/notes"}
        title={project?.name}
        actions={
          meta && (
            <div className="flex items-center">
              <button
                onClick={() => patch({ pinned: !meta.pinned })}
                aria-label={meta.pinned ? "Unpin" : "Pin"}
                aria-pressed={!!meta.pinned}
                className={`flex h-9 w-9 items-center justify-center rounded-lg hover:bg-subtle ${meta.pinned ? "text-accent" : "text-muted"}`}
              >
                <Icon name="pin" size={18} />
              </button>
              <Menu
                label="Share"
                icon="share"
                items={[
                  { label: "Share…", icon: "share", onClick: shareNote },
                  { label: "Email", icon: "mail", onClick: emailNote },
                  { label: exporting ? "Creating doc…" : "Save as Google Doc", icon: "doc", onClick: exportDoc, disabled: exporting },
                ]}
              />
              <Menu label="More" items={[{ label: "Delete note", icon: "trash", onClick: remove, danger: true }]} />
            </div>
          )
        }
      />
      <main className="pb-nav mx-auto max-w-3xl px-4 pt-6 md:pt-10">
        {message && !meta && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{message}</p>}
        {message && meta && (
          <p role="status" className="animate-pop fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            {message}
          </p>
        )}
        {!meta ? (
          !message && (
            <div className="space-y-3" aria-label="Loading">
              <div className="h-8 w-2/3 animate-pulse rounded-lg bg-subtle" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-subtle" />
              <div className="mt-8 h-48 animate-pulse rounded-2xl bg-subtle" />
            </div>
          )
        ) : (
          <>
            <nav aria-label="Breadcrumb" className="mb-3 hidden items-center gap-1 text-sm text-muted md:flex">
              <Link href="/notes" className="hover:text-foreground">
                Notes
              </Link>
              {project && (
                <>
                  <Icon name="chevronRight" size={14} />
                  <Link href={`/notes?p=${project.id}`} className="flex items-center gap-1.5 hover:text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: project.color }} />
                    {project.name}
                  </Link>
                </>
              )}
            </nav>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent font-display text-[38px] font-normal leading-[1.05] tracking-[-0.01em] outline-none"
              aria-label="Title"
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
              <span>{new Date(meta.createdAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
              {written ? (
                <>
                  <span aria-hidden>·</span>
                  <span>Written note</span>
                </>
              ) : (
                <>
                  <span aria-hidden>·</span>
                  <span>{formatDuration(meta.durationSec * 1000)}</span>
                  <span aria-hidden>·</span>
                  <span>{langInfo(meta.language).native}</span>
                </>
              )}
              {meta.attendees?.length ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="flex items-center gap-1">
                    <Icon name="users" size={14} /> {meta.attendees.join(", ")}
                  </span>
                </>
              ) : null}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <label className={`flex items-center gap-1.5 ${pill}`}>
                {project ? <span className="h-2 w-2 rounded-full" style={{ background: project.color }} /> : <Icon name="folder" size={14} className="text-muted" />}
                <select
                  aria-label="Project"
                  value={meta.projectId ?? ""}
                  onChange={(e) => changeProject(e.target.value)}
                  className="h-full cursor-pointer appearance-none bg-transparent pr-0.5 outline-none"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" size={13} className="pointer-events-none -ml-1 text-muted" />
              </label>
              {!written && <label className={`flex items-center gap-1.5 ${pill}`}>
                <Icon name="notes" size={14} className="text-muted" />
                <select
                  aria-label="Meeting type"
                  value={template!.id}
                  onChange={(e) => patch({ template: e.target.value })}
                  className="h-full cursor-pointer appearance-none bg-transparent pr-0.5 outline-none"
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" size={13} className="pointer-events-none -ml-1 text-muted" />
              </label>}
              {meta.tags?.map((t) => (
                <button
                  key={t}
                  onClick={() => patch({ tags: meta.tags?.filter((x) => x !== t) })}
                  className="group flex h-8 items-center gap-1 rounded-lg bg-subtle px-2.5 text-[13px]"
                  aria-label={`Remove tag ${t}`}
                >
                  #{t}
                  <Icon name="close" size={12} className="text-muted group-hover:text-foreground" />
                </button>
              ))}
              <form onSubmit={addTag} className="flex">
                <label className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted focus-within:bg-card focus-within:ring-1 focus-within:ring-border">
                  <Icon name="tag" size={14} />
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="Add tag"
                    aria-label="Add tag"
                    className="w-16 bg-transparent outline-none placeholder:text-muted focus:w-28"
                  />
                </label>
              </form>
            </div>

            {(audioUrl || meta.audioFileId) && (
              <div className="mt-4">
                {audioUrl ? (
                  <audio
                    ref={audioRef}
                    controls
                    src={audioUrl}
                    className="h-10 w-full"
                    onLoadedMetadata={(e) => {
                      if (pendingSeek.current === null) return;
                      e.currentTarget.currentTime = pendingSeek.current;
                      pendingSeek.current = null;
                      e.currentTarget.play().catch(() => {});
                    }}
                    onTimeUpdate={(e) => setPlaySec(e.currentTarget.currentTime)}
                  />
                ) : (
                  <button
                    onClick={playAudio}
                    disabled={loadingAudio}
                    className="flex h-10 items-center gap-2 rounded-full border border-border bg-card pl-1.5 pr-4 text-sm hover:border-foreground/30"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background">
                      <Icon name="play" size={11} />
                    </span>
                    {loadingAudio ? "Loading recording…" : "Play recording"}
                  </button>
                )}
              </div>
            )}

            {aiBusy && (
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
                <Mascot size={32} mood="listening" />
                <span>{aiBusy}…</span>
              </div>
            )}
            {aiError && <p className="mt-5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{aiError}</p>}
            {showKeyNeeded && (
              <div className="mt-5">
                <KeyNeeded feature={showKeyNeeded === "notes" ? "AI notes" : "AI transcripts"} audio={showKeyNeeded === "transcript"} />
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-3 border-b border-border">
              <div role="tablist" className="flex gap-5">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`-mb-px border-b-2 pb-2.5 text-sm ${tab === t.id ? "border-foreground font-medium" : "border-transparent text-muted hover:text-foreground"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {tab === "ai" && aiNotes && (
                <div className="-mt-1.5 flex items-center">
                  <label className={`${toolBtn} relative`} title="Translate">
                    <Icon name="globe" size={15} />
                    <span className="hidden sm:inline">Translate</span>
                    <select
                      aria-label="Translate"
                      value=""
                      disabled={!!aiBusy}
                      onChange={(e) => translate(e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    >
                      <option value="">Translate into…</option>
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.native} · {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button onClick={() => copy(translated?.text ?? aiNotes, "AI notes")} className={toolBtn} title="Copy">
                    <Icon name="copy" size={15} />
                    <span className="hidden sm:inline">Copy</span>
                  </button>
                  <button onClick={onWriteNotes} disabled={!!aiBusy} className={toolBtn} title={`Rewrite as ${template!.name}`}>
                    <Icon name="refresh" size={15} />
                    <span className="hidden sm:inline">Rewrite</span>
                  </button>
                </div>
              )}
              {tab === "transcript" && (
                <div className="-mt-1.5 flex items-center">
                  {meta.audioFileId && transcript?.source === "browser" && (
                    <button onClick={onImproveTranscript} disabled={!!aiBusy} className={toolBtn}>
                      <Icon name="sparkles" size={15} /> Improve
                    </button>
                  )}
                  <button onClick={() => transcript && copy(transcriptToText(transcript), "Transcript")} className={toolBtn}>
                    <Icon name="copy" size={15} />
                    <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              )}
            </div>

            {tab === "ai" && (
              <section className="mt-6">
                {aiNotes ? (
                  <>
                    {translated && (
                      <div className="mb-4">
                        <div className="mb-3 flex items-center justify-between rounded-lg bg-subtle px-3 py-2 text-xs text-muted">
                          <span>Translated into {langInfo(translated.lang).name}</span>
                          <button onClick={() => setTranslated(null)} className="font-medium text-foreground">
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
                          /^none mentioned/i.test(text) ? null : onBoard.has(parseAction(text).title.toLowerCase()) ? (
                            <span className="flex shrink-0 items-center gap-1 self-start whitespace-nowrap px-2 py-0.5 text-[11px] text-muted">
                              <Icon name="check" size={12} /> In to-dos
                            </span>
                          ) : (
                            <button
                              onClick={() => addToTodos(text)}
                              className="flex shrink-0 items-center gap-1 self-start whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium hover:border-foreground/30"
                            >
                              <Icon name="plus" size={12} /> To-do
                            </button>
                          )
                        }
                      />
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-10 text-center">
                    <Mascot size={64} />
                    <p className="max-w-xs text-sm text-muted">
                      {written
                        ? "I can tidy your note into a clear summary with action items."
                        : `I can turn the transcript and your notes into a ${template!.name.toLowerCase()} write-up with action items.`}
                    </p>
                    <button
                      onClick={onWriteNotes}
                      disabled={!!aiBusy}
                      className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
                    >
                      <Icon name="sparkles" size={16} /> {written ? "Summarize" : "Write AI notes"}
                    </button>
                  </div>
                )}
              </section>
            )}

            {tab === "notes" && (
              <section className="mt-6">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={written ? "Start writing…" : "Write your own notes for this meeting…"}
                  aria-label="Note"
                  className="min-h-80 text-[17px] w-full resize-y bg-transparent leading-relaxed outline-none placeholder:text-muted"
                />
              </section>
            )}

            {tab === "transcript" && (
              <section className="mt-6">
                <p className="mb-3 text-xs text-muted">
                  {transcript?.source === "gemini"
                    ? "AI transcript (Gemini)"
                    : transcript?.source === "openai"
                      ? "AI transcript (OpenAI)"
                      : "Live transcript from your browser"}
                  {meta.audioFileId && " · Tap a line to play from there"}
                </p>
                <TranscriptView
                  segments={transcript?.segments ?? []}
                  onSeek={meta.audioFileId ? seek : undefined}
                  activeSec={audioUrl ? playSec : undefined}
                />
              </section>
            )}

            {(dirty || saving) && (
              <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-8">
                <div className="animate-pop flex items-center gap-3 rounded-full bg-foreground py-1.5 pl-4 pr-1.5 text-sm text-background shadow-2xl">
                  <span>Unsaved changes</span>
                  <button onClick={save} disabled={saving} className="rounded-full bg-background px-4 py-1.5 font-medium text-foreground disabled:opacity-60">
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
