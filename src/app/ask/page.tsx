"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { AiError, askNotes, pickTextAi, PROVIDER_NAMES, type AskSource } from "@/lib/ai";
import { loadIndex, readText, searchDrive, type NoteIndex, type NoteMeta } from "@/lib/drive";
import { cache } from "@/lib/local";
import { loadNoteBody, transcriptToText } from "@/lib/notes";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

const MAX_NOTES = 60;
const TRANSCRIPT_CHARS = 12000;

const EXAMPLES = [
  "What did we decide about the launch date?",
  "What did I promise to do this week?",
  "Summarise everything Priya raised last month",
  "पिछली मीटिंग में क्या तय हुआ?",
];

/** AI notes + own notes for one meeting, cached on this device. */
async function noteText(token: string, n: NoteMeta) {
  const cached = await cache.getText(n.id);
  if (cached && cached.updatedAt === n.updatedAt) return cached.text;
  const [ai, body] = await Promise.all([
    n.aiNotesFileId ? readText(token, n.aiNotesFileId).catch(() => "") : Promise.resolve(""),
    n.notesFileId ? loadNoteBody(token, { ...n, transcriptFileId: undefined }).then((b) => b.notes).catch(() => "") : "",
  ]);
  const text = [ai && `AI notes:\n${ai}`, body.trim() && `Own notes:\n${body}`].filter(Boolean).join("\n\n");
  await cache.setText(n.id, n.updatedAt, text);
  return text;
}

type Answer = { question: string; text: string; sources: (AskSource & { id: string })[] };

export default function AskPage() {
  const router = useRouter();
  const { token, status } = useAccessToken();
  const { settings, loaded: settingsLoaded } = useSettings(token);
  const [index, setIndex] = useState<NoteIndex | null>(null);
  const [project, setProject] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [needKey, setNeedKey] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    cache.getIndex().then((i) => i && setIndex((x) => x ?? i));
    if (token)
      loadIndex(token)
        .then(({ index }) => setIndex(index))
        .catch(() => {});
  }, [token]);

  const ai = pickTextAi(settings);
  // A question typed on Home arrives as ?q=.
  const autoAsk = useRef<string | null | undefined>(undefined);

  const projects = useMemo(() => (index?.projects ?? []).filter((p) => !p.unavailable), [index]);

  const ask = async (q: string) => {
    if (!token || !index || !q.trim()) return;
    if (!ai) return setNeedKey(true);
    setError(null);
    setQuestion("");
    try {
      const pool = index.notes.filter((n) => !project || n.projectId === project).slice(0, MAX_NOTES);
      setBusy(`Reading ${pool.length} meeting${pool.length === 1 ? "" : "s"}`);

      // Transcripts are long, so include them only for meetings that mention the question's words.
      const words = q
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 3)
        .slice(0, 4);
      const hits = new Set<string>();
      for (const w of words) for (const f of await searchDrive(token, w).catch(() => new Set<string>())) hits.add(f);

      const sources: Answer["sources"] = [];
      // Fetch in small batches so a long history doesn't open dozens of requests at once.
      for (let start = 0; start < pool.length; start += 8) {
        const batch = await Promise.all(
          pool.slice(start, start + 8).map(async (n, j) => {
            let text = await noteText(token, n);
            if (hits.has(n.folderId) && n.transcriptFileId) {
              const body = await loadNoteBody(token, n).catch(() => null);
              if (body) text += `\n\nTranscript:\n${transcriptToText(body.transcript).slice(0, TRANSCRIPT_CHARS)}`;
            }
            return { n, i: start + j, text };
          }),
        );
        for (const { n, i, text } of batch) {
          if (!text.trim()) continue;
          sources.push({
            id: n.id,
            n: i + 1,
            title: n.title,
            date: new Date(n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
            text,
          });
        }
      }
      if (!sources.length) throw new AiError("Your meetings don't have notes or AI notes yet. Write AI notes first, then ask.");

      setBusy(`Thinking with ${PROVIDER_NAMES[ai.provider]}`);
      const text = await askNotes(ai, q, sources);
      const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
      setAnswers((a) => [{ question: q, text, sources: sources.filter((s) => cited.has(s.n)) }, ...a]);
    } catch (e) {
      setError(e instanceof AiError ? e.message : "Something went wrong. Please try again.");
    }
    setBusy(null);
  };

  useEffect(() => {
    if (autoAsk.current === undefined) autoAsk.current = new URLSearchParams(window.location.search).get("q");
    const q = autoAsk.current;
    if (!q || !token || !index || !settingsLoaded) return;
    autoAsk.current = null;
    window.history.replaceState(null, "", "/ask");
    ask(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, index, settingsLoaded]);

  return (
    <>
      <AppHeader />
      <main className="pb-nav mx-auto max-w-2xl px-4 pt-5 md:pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Ask your notes</h1>
        <p className="mt-0.5 text-sm text-muted">Answers come from your meetings, with links to the ones I used.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="mt-5 rounded-2xl border border-border bg-card p-1.5 shadow-sm focus-within:border-foreground/30"
        >
          <div className="flex items-center gap-2 pl-2.5">
            <Icon name="sparkles" size={18} className="text-accent" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What did we decide about…"
              autoFocus
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            <button
              disabled={!!busy || !question.trim()}
              aria-label="Ask"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background transition disabled:opacity-30"
            >
              <Icon name="back" size={18} strokeWidth={2.25} className="rotate-180" />
            </button>
          </div>
          {projects.length > 0 && (
            <div className="mt-1 flex border-t border-border px-1.5 pt-1.5">
              <label className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-subtle">
                <Icon name="folder" size={13} />
                <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Which notes" className="cursor-pointer appearance-none bg-transparent outline-none">
                  <option value="">All my meetings</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      Only {p.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevronDown" size={12} />
              </label>
            </div>
          )}
        </form>

        {needKey && !ai && (
          <div className="mt-4">
            <KeyNeeded feature="Ask your notes" />
          </div>
        )}
        {busy && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
            <Mascot size={32} mood="listening" />
            <span>{busy}…</span>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}

        {answers.length === 0 && !busy ? (
          <div className="mt-8">
            <p className="mb-2 px-1 text-[13px] font-medium text-muted">Try asking</p>
            <ul className="-mx-2 flex flex-col">
              {EXAMPLES.map((q) => (
                <li key={q}>
                  <button onClick={() => ask(q)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-subtle">
                    <Icon name="search" size={15} className="text-muted" />
                    <span className="flex-1">{q}</span>
                    <Icon name="chevronRight" size={15} className="text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {answers.map((a, i) => (
              <article key={i}>
                <p className="mb-3 text-[17px] font-semibold">{a.question}</p>
                <Markdown source={a.text} />
                {a.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.sources.map((s) => (
                      <Link
                        key={s.n}
                        href={`/notes/${s.id}`}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground/30"
                      >
                        <span className="text-muted">{s.n}</span>
                        <span className="max-w-[14rem] truncate font-medium">{s.title}</span>
                        <span className="text-muted">{s.date}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
