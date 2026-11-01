"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { relTime } from "@/lib/dates";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
import { Mascot } from "@/components/Mascot";
import { AiError, pickTextAi, PROVIDER_NAMES, riffOnIdea } from "@/lib/ai";
import { cachedIdeas, IDEA_COLORS, loadIdeas, newIdea, SPARKS, updateIdeas, type Idea, type IdeaColor } from "@/lib/ideas";
import { cache, type PendingNote } from "@/lib/local";
import { saveNoteToDrive } from "@/lib/notes";
import { useLiveTranscript } from "@/lib/speech";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

export default function IdeasPage() {
  return (
    <Suspense>
      <Ideas />
    </Suspense>
  );
}

function Ideas() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, status } = useAccessToken();
  const { settings } = useSettings(token);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<IdeaColor>("plain");
  const [spark, setSpark] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState<IdeaColor | null>(null);
  const [open, setOpen] = useState<Idea | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const live = useLiveTranscript(() => 0);
  const [listening, setListening] = useState(false);
  const heard = useRef(0);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    const c = cachedIdeas();
    if (c) setIdeas((x) => x ?? c);
    if (params.get("new")) setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) return;
    loadIdeas(token)
      .then(setIdeas)
      .catch(() => {
        setIdeas((x) => x ?? []);
        setError("Couldn't reach Google Drive. Showing what's saved on this device.");
      });
  }, [token]);

  // Speech typed straight into the box.
  useEffect(() => {
    if (live.segments.length <= heard.current) return;
    const words = live.segments.slice(heard.current).map((s) => s.text).join(" ");
    heard.current = live.segments.length;
    setDraft((d) => (d.trim() ? `${d.trimEnd()} ${words}` : words));
  }, [live.segments]);

  // Grow the box with its text.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft]);

  const toggleMic = () => {
    if (listening) {
      live.stop();
      setListening(false);
    } else {
      heard.current = 0;
      live.reset();
      live.start(settings.defaultLanguage);
      setListening(true);
    }
  };

  const save = (change: (list: Idea[]) => Idea[]) => {
    setIdeas((list) => (list ? change(list) : list));
    if (!token) return;
    updateIdeas(token, change).catch(() => setError("Couldn't save to Google Drive. Check your connection and try again."));
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    if (listening) toggleMic();
    const prompt = spark !== null ? SPARKS[spark] : null;
    const idea = newIdea(prompt && !text.includes(prompt) ? `${prompt}\n${text}` : text, color);
    save((list) => [idea, ...list]);
    setDraft("");
    setSpark(null);
    inputRef.current?.focus();
  };

  const patch = (id: string, p: Partial<Idea>) => {
    const at = new Date().toISOString();
    save((list) => list.map((i) => (i.id === id ? { ...i, ...p, updatedAt: at } : i)));
    setOpen((o) => (o && o.id === id ? { ...o, ...p, updatedAt: at } : o));
  };

  const remove = (id: string) => {
    save((list) => list.filter((i) => i.id !== id));
    setOpen(null);
  };

  const shown = useMemo(() => {
    let list = ideas ?? [];
    if (colorFilter) list = list.filter((i) => i.color === colorFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => i.text.toLowerCase().includes(q) || i.riff?.toLowerCase().includes(q));
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt));
  }, [ideas, colorFilter, query]);

  const usedColors = useMemo(() => new Set((ideas ?? []).map((i) => i.color)), [ideas]);

  return (
    <>
      <AppHeader />
      <main className="pb-nav mx-auto max-w-6xl px-4 pt-6 md:pt-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[38px] font-normal leading-[1.05] tracking-[-0.01em]">Ideas</h1>
            <p className="mt-0.5 text-sm text-muted">Your space to think out loud. Only you can see it.</p>
          </div>
        </div>

        {/* Capture */}
        <div className={`idea-${color} bg-idea mt-5 rounded-2xl border border-border p-3 shadow-sm transition-colors md:p-4`}>
          {spark !== null && (
            <div className="mb-1.5 flex items-start gap-2 text-sm font-medium">
              <Icon name="sparkles" size={15} className="mt-0.5 text-accent" />
              <span className="flex-1">{SPARKS[spark]}</span>
              <button onClick={() => setSpark(null)} aria-label="Remove prompt" className="text-muted hover:text-foreground">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                add();
              }
            }}
            rows={2}
            placeholder={listening ? "Listening…" : "What's the idea? Half-formed is fine."}
            aria-label="New idea"
            className="block w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-muted"
          />
          {listening && live.interim && <p className="text-[17px] text-muted">{live.interim}</p>}
          <div className="mt-2 flex items-center gap-1.5">
            <ColorDots value={color} onChange={setColor} />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setSpark((s) => (s === null ? Math.floor(Math.random() * SPARKS.length) : (s + 1) % SPARKS.length))}
                className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted hover:bg-foreground/5 hover:text-foreground"
                title="Give me a prompt"
              >
                <Icon name="bulb" size={15} />
                <span className="hidden sm:inline">{spark === null ? "Spark" : "Another"}</span>
              </button>
              {live.supported && (
                <button
                  onClick={toggleMic}
                  aria-label={listening ? "Stop listening" : "Say it"}
                  aria-pressed={listening}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg ${listening ? "bg-accent text-white" : "text-muted hover:bg-foreground/5 hover:text-foreground"}`}
                >
                  <Icon name="mic" size={17} />
                </button>
              )}
              <button
                onClick={add}
                disabled={!draft.trim()}
                className="h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}

        {ideas && ideas.length > 3 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:border-foreground/30 sm:max-w-xs">
              <Icon name="search" size={16} className="text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ideas"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
            {usedColors.size > 1 && (
              <div className="flex items-center gap-1" role="group" aria-label="Filter by colour">
                {IDEA_COLORS.filter((c) => usedColors.has(c)).map((c) => (
                  <button
                    key={c}
                    onClick={() => setColorFilter((f) => (f === c ? null : c))}
                    aria-label={`Only ${c}`}
                    aria-pressed={colorFilter === c}
                    className={`idea-${c} bg-idea-dot h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition ${colorFilter === c ? "ring-2 ring-foreground" : "opacity-80 hover:opacity-100"}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <section className="mt-6">
          {ideas === null ? (
            <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
              {[90, 140, 70, 120].map((h, i) => (
                <div key={i} className="mb-3 animate-pulse break-inside-avoid rounded-2xl bg-subtle" style={{ height: h }} />
              ))}
            </div>
          ) : ideas.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <Mascot size={72} />
              <p className="font-medium">A blank page, all yours</p>
              <p className="max-w-xs text-sm text-muted">
                Jot down anything: a product idea, a story, a fix for something that bugs you. Stuck? Tap Spark for a prompt.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted">No ideas match.</p>
          ) : (
            <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
              {shown.map((i) => (
                <IdeaCard key={i.id} idea={i} onOpen={() => setOpen(i)} />
              ))}
            </div>
          )}
        </section>
      </main>

      {open && (
        <IdeaSheet
          idea={open}
          token={token}
          ai={pickTextAi(settings)}
          onClose={() => setOpen(null)}
          onPatch={(p) => patch(open.id, p)}
          onDelete={() => remove(open.id)}
          onNote={async () => {
            if (!token) return;
            const lines = open.text.trim().split("\n");
            const note: PendingNote = {
              id: crypto.randomUUID(),
              title: lines[0].slice(0, 70),
              createdAt: new Date().toISOString(),
              durationSec: 0,
              kind: "written",
              language: settings.defaultLanguage,
              notes: [open.text.trim(), open.riff && `\n---\n\n${open.riff}`].filter(Boolean).join("\n"),
              transcript: { language: settings.defaultLanguage, source: "browser", segments: [] },
              audio: null,
            };
            await cache.savePending(note);
            await saveNoteToDrive(token, note, { saveAudio: false });
            router.push(`/notes/${note.id}`);
          }}
        />
      )}
    </>
  );
}

function ColorDots({ value, onChange }: { value: IdeaColor; onChange: (c: IdeaColor) => void }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
      {IDEA_COLORS.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`idea-${c} bg-idea-dot flex h-5 w-5 items-center sm:h-6 sm:w-6 justify-center rounded-full transition ${value === c ? "scale-110 ring-2 ring-foreground/60" : "hover:scale-110"}`}
        />
      ))}
    </div>
  );
}

function IdeaCard({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  const [first, ...rest] = idea.text.split("\n");
  return (
    <button
      onClick={onOpen}
      className={`idea-${idea.color} bg-idea mb-3 block w-full break-inside-avoid rounded-2xl border border-border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md`}
    >
      <span className="block whitespace-pre-wrap break-words text-[15px] font-medium leading-snug">{first}</span>
      {rest.join("\n").trim() && (
        <span className="mt-1.5 line-clamp-[8] block whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/75">
          {rest.join("\n").trim()}
        </span>
      )}
      <span className="mt-3 flex items-center gap-2 text-xs text-muted">
        {idea.pinned && <Icon name="pin" size={12} className="text-accent" />}
        <span>{relTime(idea.createdAt)}</span>
        {idea.riff && (
          <span className="flex items-center gap-1">
            <Icon name="sparkles" size={12} /> Riffed
          </span>
        )}
      </span>
    </button>
  );
}

function IdeaSheet({
  idea,
  token,
  ai,
  onClose,
  onPatch,
  onDelete,
  onNote,
}: {
  idea: Idea;
  token: string | null;
  ai: ReturnType<typeof pickTextAi>;
  onClose: () => void;
  onPatch: (p: Partial<Idea>) => void;
  onDelete: () => void;
  onNote: () => Promise<void>;
}) {
  const [text, setText] = useState(idea.text);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(false);

  const commit = () => {
    if (text.trim() && text !== idea.text) onPatch({ text: text.trim() });
  };
  const close = () => {
    commit();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const riff = async () => {
    if (!ai) return setNeedKey(true);
    setErr(null);
    setBusy(`Thinking with ${PROVIDER_NAMES[ai.provider]}`);
    try {
      const r = await riffOnIdea(ai, text);
      onPatch({ riff: r, text: text.trim() });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "Something went wrong. Please try again.");
    }
    setBusy(null);
  };

  const btn = "flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-foreground/5 disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center md:p-6" onClick={close}>
      <div
        role="dialog"
        aria-label="Idea"
        onClick={(e) => e.stopPropagation()}
        className={`idea-${idea.color} bg-idea animate-pop flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-border shadow-2xl md:rounded-3xl`}
      >
        <div className="flex items-center gap-2 px-4 pt-4">
          <ColorDots value={idea.color} onChange={(c) => onPatch({ color: c })} />
          <button
            onClick={() => onPatch({ pinned: !idea.pinned })}
            aria-pressed={!!idea.pinned}
            aria-label={idea.pinned ? "Unpin" : "Pin"}
            className={`ml-auto flex h-9 w-9 items-center justify-center rounded-lg hover:bg-foreground/5 ${idea.pinned ? "text-accent" : "text-muted"}`}
          >
            <Icon name="pin" size={17} />
          </button>
          <button onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-foreground/5">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            aria-label="Idea"
            className="min-h-40 w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none"
          />
          {busy && (
            <div className="mt-2 flex items-center gap-3 rounded-2xl bg-card/70 px-4 py-3 text-sm">
              <Mascot size={28} mood="listening" />
              {busy}…
            </div>
          )}
          {err && <p className="mt-2 text-sm text-muted">{err}</p>}
          {needKey && (
            <div className="mt-2">
              <KeyNeeded feature="AI riffs" />
            </div>
          )}
          {idea.riff && (
            <div className="mt-3 rounded-2xl bg-card/80 p-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted">
                <span className="flex items-center gap-1">
                  <Icon name="sparkles" size={13} /> Little&apos;s take
                </span>
                <button onClick={() => onPatch({ riff: undefined })} className="hover:text-foreground">
                  Clear
                </button>
              </div>
              <Markdown source={idea.riff} />
            </div>
          )}
        </div>
        <div className="safe-bottom flex flex-wrap items-center gap-1 border-t border-border/60 px-3 pt-2 md:pb-3">
          <button onClick={riff} disabled={!!busy || !text.trim()} className={`${btn} font-medium`}>
            <Icon name="sparkles" size={16} className="text-accent" /> {idea.riff ? "Riff again" : "Riff on this"}
          </button>
          <button
            onClick={async () => {
              commit();
              setBusy("Saving as a note");
              try {
                await onNote();
              } catch {
                setBusy(null);
                setErr("Couldn't save the note to Drive. Try again.");
              }
            }}
            disabled={!!busy || !token}
            className={btn}
          >
            <Icon name="doc" size={16} /> Make it a note
          </button>
          <button
            onClick={() => confirm("Delete this idea?") && onDelete()}
            className={`${btn} ml-auto text-muted hover:text-accent`}
            aria-label="Delete idea"
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
