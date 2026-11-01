"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Markdown } from "@/components/Markdown";
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
  const { settings } = useSettings(token);
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

  return (
    <>
      <AppHeader back="/" title="Ask your notes" />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex flex-col gap-2"
        >
          <div className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about your meetings"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-3 outline-none focus:border-accent"
            />
            <button disabled={!!busy || !question.trim()} className="rounded-xl bg-accent px-5 font-semibold text-white disabled:opacity-50">
              Ask
            </button>
          </div>
          {projects.length > 0 && (
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="Which notes"
              className="self-start rounded-full border border-border bg-card px-3 py-1.5 text-sm"
            >
              <option value="">All my meetings</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  Only {p.name}
                </option>
              ))}
            </select>
          )}
        </form>

        {needKey && !ai && (
          <div className="mt-4">
            <KeyNeeded feature="Ask your notes" />
          </div>
        )}
        {busy && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
            <Mascot size={36} mood="listening" />
            <span>{busy}…</span>
          </div>
        )}
        {error && <p className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm">{error}</p>}

        {answers.length === 0 && !busy ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <Mascot size={96} />
            <p className="max-w-sm text-sm text-muted">
              I&apos;ll look through your meeting notes and answer, with links to the meetings I used. Try:
            </p>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <button key={q} onClick={() => ask(q)} className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:border-accent">
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {answers.map((a, i) => (
              <article key={i} className="rounded-2xl border border-border bg-card p-4">
                <p className="mb-3 font-semibold">{a.question}</p>
                <Markdown source={a.text} />
                {a.sources.length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1.5 text-xs text-muted">From these meetings</p>
                    <ul className="space-y-1 text-sm">
                      {a.sources.map((s) => (
                        <li key={s.n}>
                          <Link href={`/notes/${s.id}`} className="underline">
                            [{s.n}] {s.title}
                          </Link>{" "}
                          <span className="text-xs text-muted">· {s.date}</span>
                        </li>
                      ))}
                    </ul>
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
