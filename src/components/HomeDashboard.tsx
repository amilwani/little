"use client";

import { NoteIcon } from "@/components/NoteIcon";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader, RecordLink } from "./AppHeader";
import { Icon, type IconName } from "./Icon";
import { loadIndex, readText, type NoteIndex, type NoteMeta, type Project } from "@/lib/drive";
import { cache, type PendingNote } from "@/lib/local";
import { syncPending } from "@/lib/notes";
import { connectCalendar, hasCalendar, listEvents, rememberEvent, type CalendarEvent } from "@/lib/calendar";
import { cachedIdeas, loadIdeas, type Idea } from "@/lib/ideas";
import { isMine, loadTodos, updateTodos, type Todo } from "@/lib/todos";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";
import { DAY, dueLabel, localDay, relTime } from "@/lib/dates";
import { pendingCount } from "@/lib/slack";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Sort: overdue and soonest due first, then urgent, then newest. */
function byUrgency(a: Todo, b: Todo) {
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  if (!!a.urgent !== !!b.urgent) return a.urgent ? -1 : 1;
  return b.createdAt.localeCompare(a.createdAt);
}

export function HomeDashboard() {
  const router = useRouter();
  const { token, user, scope } = useAccessToken();
  const { settings } = useSettings(token);
  const [index, setIndex] = useState<NoteIndex | null>(null);
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [slackWaiting, setSlackWaiting] = useState(0);
  useEffect(() => {
    const update = () => setSlackWaiting(pendingCount());
    update();
    window.addEventListener("little:inbox", update);
    return () => window.removeEventListener("little:inbox", update);
  }, []);
  const [justDone, setJustDone] = useState<Set<string>>(new Set());
  const calendar = hasCalendar(scope);

  useEffect(() => {
    cache.getIndex().then((i) => i && setIndex((n) => n ?? i));
    cache.listPending().then(setPending);
    setIdeas((x) => x ?? cachedIdeas());
  }, []);

  useEffect(() => {
    if (token) loadIdeas(token).then(setIdeas).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        if ((await cache.listPending()).length) await syncPending(token, settings.saveAudio);
        const { index } = await loadIndex(token);
        if (!live) return;
        setIndex(index);
        cache.setIndex(index);
        setError(null);
        loadTodos(token, index.projects)
          .then((d) => live && setTodos(d.todos))
          .catch(() => live && setTodos([]));
      } catch {
        if (live) setError("Couldn't reach Google Drive. Showing what's saved on this device.");
        if (live) setTodos((t) => t ?? []);
      }
      if (live) setPending(await cache.listPending());
    })();
    return () => {
      live = false;
    };
  }, [token, settings.saveAudio]);

  // The rest of today's meetings.
  useEffect(() => {
    if (!token || !calendar) return;
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    listEvents(token, new Date(now.getTime() - 15 * 60e3), end)
      .then((list) => setEvents(list.filter((e) => !e.allDay && new Date(e.end).getTime() > Date.now())))
      .catch(() => setEvents([]));
  }, [token, calendar]);

  const notes = useMemo(() => index?.notes ?? [], [index]);
  const projects = useMemo(() => (index?.projects ?? []).filter((p) => !p.unavailable), [index]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const myOpen = useMemo(
    () =>
      (todos ?? [])
        .filter((t) => (t.status !== "done" || justDone.has(t.id)) && (!t.projectId || isMine(t, user) || t.createdBy === user?.email))
        .sort(byUrgency),
    [todos, user, justDone],
  );
  const topTodos = myOpen.slice(0, 5);
  const lateCount = myOpen.filter((t) => t.due && t.due < localDay() && !justDone.has(t.id)).length;

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY;
    const week = notes.filter((n) => new Date(n.createdAt).getTime() > weekAgo);
    const sec = week.reduce((s, n) => s + (n.durationSec || 0), 0);
    const doneWeek = (todos ?? []).filter((t) => t.status === "done" && new Date(t.updatedAt).getTime() > weekAgo).length;
    return { notes: week.length, sec, done: doneWeek, open: myOpen.filter((t) => !justDone.has(t.id)).length };
  }, [notes, todos, myOpen, justDone]);

  const latest = notes.slice(0, 5);

  // A one-line preview of what each recent note says.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!token) return;
    let live = true;
    for (const n of latest) {
      const file = n.aiNotesFileId ?? n.notesFileId;
      if (!file) continue;
      const key = `little:preview:${n.id}:${n.updatedAt}`;
      let hit: string | null = null;
      try {
        hit = localStorage.getItem(key);
      } catch {
        /* storage blocked */
      }
      if (hit !== null) {
        setPreviews((p) => (p[n.id] === hit ? p : { ...p, [n.id]: hit! }));
        continue;
      }
      readText(token, file)
        .then((md) => {
          const line = firstLine(n.aiNotesFileId ? md : md.replace(/^# .*\n/, ""));
          try {
            localStorage.setItem(key, line);
          } catch {
            /* storage full */
          }
          if (live) setPreviews((p) => ({ ...p, [n.id]: line }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, latest.map((n) => n.id + n.updatedAt).join()]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const complete = (todo: Todo) => {
    if (!token) return;
    const left = myOpen.filter((t) => !justDone.has(t.id) && t.id !== todo.id).length;
    setToast(left === 0 ? "All done. Enjoy the quiet ✨" : `Nice! ${left} to go`);
    navigator.vibrate?.(12);
    setJustDone((s) => new Set(s).add(todo.id));
    setTodos((list) => list?.map((t) => (t.id === todo.id ? { ...t, status: "done" } : t)) ?? list);
    updateTodos(
      token,
      (all) => all.map((t) => (t.id === todo.id ? { ...t, status: "done", updatedAt: new Date().toISOString() } : t)),
      index?.projects,
    ).catch(() => {
      setError("Couldn't save that to Drive. Try again.");
      setTodos((list) => list?.map((t) => (t.id === todo.id ? todo : t)) ?? list);
      setJustDone((s) => {
        const n = new Set(s);
        n.delete(todo.id);
        return n;
      });
    });
  };

  const firstName = user?.name?.split(" ")[0];
  // Worked out in the browser, so the greeting follows the user's own clock.
  const [hello, setHello] = useState<{ greeting: string; today: string; period: string } | null>(null);
  useEffect(() => {
    const h = new Date().getHours();
    setHello({
      period: h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening",
      greeting: greeting(),
      today: new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }),
    });
  }, []);
  const isNewUser = index !== null && notes.length === 0 && pending.length === 0;
  const hasKey = Object.values(settings.apiKeys ?? {}).some(Boolean);

  const ideaList = [...(ideas ?? [])]
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const meetingsLeft = events?.filter((e) => !notes.some((n) => n.calendarEventId === e.id)).length ?? 0;
  const open = myOpen.filter((t) => !justDone.has(t.id)).length;

  // One calm line instead of a stats grid.
  const parts =
    todos === null
      ? null
      : [
          open ? `${open} open to-do${open === 1 ? "" : "s"}${lateCount ? ` (${lateCount} late)` : ""}` : null,
          calendar && events && meetingsLeft ? `${meetingsLeft} meeting${meetingsLeft === 1 ? "" : "s"} left today` : null,
          stats.notes ? `${stats.notes} note${stats.notes === 1 ? "" : "s"} this week` : null,
        ].filter(Boolean);
  const summary =
    parts === null
      ? null
      : parts.length
        ? `You have ${parts.join(", ")}.`
        : stats.done
          ? "You're all caught up. Enjoy the quiet."
          : notes.length
            ? "Nothing waiting on you. A good moment to think."
            : "A fresh page. What's on your mind today?";

  return (
    <>
      <AppHeader hideRecord />
      <div className={`aurora aurora-${hello?.period ?? "morning"}`} aria-hidden />
      <main className="pb-nav relative mx-auto max-w-[760px] px-4 pt-8 md:px-8 md:pt-16">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="h-5 text-sm font-medium text-foreground/60">{hello?.today}</p>
            <h1 className="mt-1 font-display text-[42px] leading-[1.02] tracking-[-0.015em] md:text-[56px]">
              {hello?.greeting ?? "Hello"}
              {firstName ? (
                <>
                  , <em className="italic">{firstName}</em>
                </>
              ) : null}
            </h1>
            {summary && <p className="mt-2 text-[15px] leading-relaxed text-foreground/65">{summary}</p>}
          </div>
          {todos !== null && stats.done + open > 0 && <ProgressRing done={stats.done} total={stats.done + open} />}
        </div>

        {/* Start something */}
        <div className="mt-6 grid grid-cols-4 gap-2 md:flex md:gap-1.5">
          <RecordLink className="flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-foreground text-[13px] md:h-10 md:flex-row md:gap-2.5 md:rounded-full md:pl-3.5 md:pr-4 md:text-sm text-sm font-medium text-background shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] transition hover:-translate-y-px hover:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.55)] active:scale-[0.97]">
            <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-accent" /> Record
          </RecordLink>
          <QuickAction href="/notes/write" icon="doc" label="Write" />
          <QuickAction href="/dictate" icon="pen" label="Dictate" />
          <QuickAction href="/ideas?new=1" icon="bulb" label="Idea" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(ask.trim() ? `/ask?q=${encodeURIComponent(ask.trim())}` : "/ask");
          }}
          className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border bg-background/80 px-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur transition focus-within:border-foreground/25 focus-within:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]"
        >
          <Icon name="sparkles" size={16} className="shrink-0 text-accent" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Ask anything about your notes"
            aria-label="Ask your notes"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          {ask.trim() && (
            <button aria-label="Ask" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
              <Icon name="chevronRight" size={15} />
            </button>
          )}
        </form>

        {error && <p className="mt-4 rounded-lg bg-subtle px-4 py-3 text-sm text-muted">{error}</p>}
        {pending.length > 0 && (
          <Link href="/notes" className="mt-4 flex items-center gap-2 rounded-lg bg-subtle px-3.5 py-2.5 text-sm">
            <Icon name="refresh" size={15} className="text-muted" />
            {pending.length} note{pending.length === 1 ? "" : "s"} saved on this device, waiting to upload
          </Link>
        )}

        {slackWaiting > 0 && (
          <Link
            href="/inbox"
            className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm shadow-sm transition hover:border-foreground/30"
          >
            <Icon name="inbox" size={16} className="text-accent" />
            <span className="flex-1">
              {slackWaiting} thing{slackWaiting === 1 ? "" : "s"} from Slack to review
            </span>
            <Icon name="chevronRight" size={15} className="text-muted" />
          </Link>
        )}

        {isNewUser ? (
          <GettingStarted calendar={calendar} hasKey={hasKey} />
        ) : (
          <div className="stagger mt-10 flex flex-col gap-10">
            {calendar ? (
              events && events.length > 0 ? (
                <Section title="Today" href="/meetings" more="Calendar">
                  <ul className="-mx-2 flex flex-col">
                    {events.slice(0, 3).map((e) => (
                      <MeetingRow key={e.id} event={e} recorded={notes.some((n) => n.calendarEventId === e.id)} />
                    ))}
                  </ul>
                </Section>
              ) : null
            ) : (
              <button onClick={() => connectCalendar()} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-subtle hover:text-foreground">
                <Icon name="calendar" size={16} /> Connect your calendar to see today&apos;s meetings here
              </button>
            )}

            <Section title="Due soon" href="/todos?tab=mine" more="All to-dos">
              {todos === null ? (
                <Skeleton rows={3} />
              ) : topTodos.length === 0 ? (
                <p className="text-sm text-muted">
                  You&apos;re all caught up.{" "}
                  <Link href="/todos?new=1" className="underline-offset-2 hover:text-foreground hover:underline">
                    Add a to-do
                  </Link>
                </p>
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {topTodos.map((t) => (
                    <TodoRow
                      key={t.id}
                      todo={t}
                      done={justDone.has(t.id)}
                      project={t.projectId ? projectById.get(t.projectId) : undefined}
                      onDone={() => complete(t)}
                    />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Recent notes" href="/notes" more="All notes">
              {index === null ? (
                <Skeleton rows={4} />
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {latest.map((n) => (
                    <NoteRow key={n.id} note={n} preview={previews[n.id]} project={n.projectId ? projectById.get(n.projectId) : undefined} />
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Ideas" href="/ideas" more="All ideas">
              <div className="flex flex-wrap gap-1.5">
                {ideaList.map((i) => (
                  <Link
                    key={i.id}
                    href="/ideas"
                    className={`idea-${i.color} bg-idea flex max-w-full items-center gap-2 rounded-full border border-black/[0.04] py-1.5 pl-3 pr-3.5 text-sm transition hover:-translate-y-px hover:shadow-sm`}
                  >
                    <span className="bg-idea-dot h-2 w-2 shrink-0 rounded-full" />
                    <span className="max-w-[16rem] truncate">{i.text.split("\n")[0]}</span>
                  </Link>
                ))}
                <Link
                  href="/ideas?new=1"
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted hover:bg-subtle hover:text-foreground"
                >
                  <Icon name="plus" size={14} /> New idea
                </Link>
              </div>
            </Section>
          </div>
        )}
      </main>
      {toast && (
        <div role="status" className="toast fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-2xl md:bottom-8 md:left-[calc(50%+7.5rem)]">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
          {toast}
        </div>
      )}
    </>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <RecordLink
      href={href}
      className="flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-background/70 text-[13px] text-foreground/85 backdrop-blur md:h-10 md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm transition hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm active:scale-[0.97]"
    >
      <Icon name={icon} size={16} className="text-muted" />
      {label}
    </RecordLink>
  );
}

function Section({ title, href, more, children }: { title: string; href?: string; more?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="font-display text-[24px] leading-none tracking-[-0.01em]">{title}</h2>
        {href && (
          <Link href={href} className="flex items-center gap-0.5 text-xs text-muted hover:text-foreground">
            {more ?? "See all"} <Icon name="chevronRight" size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-8 w-8 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3.5 rounded" style={{ width: `${70 - i * 12}%` }} />
            <div className="skeleton h-3 w-1/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NoteRow({ note, project, preview }: { note: NoteMeta; project?: Project; preview?: string }) {
  return (
    <li>
      <Link href={`/notes/${note.id}`} className="group flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-subtle">
        <NoteIcon note={note} project={project} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{note.title}</span>
          {preview && <span className="mt-0.5 block truncate text-[13px] text-muted">{preview}</span>}
          {project && (
            <span className="mt-1 flex items-center gap-1.5 text-xs text-muted md:hidden">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
              {project.name}
            </span>
          )}
        </span>
        {project && (
          <span className="mt-0.5 hidden max-w-[10rem] shrink-0 items-center gap-1.5 truncate rounded px-1.5 py-0.5 text-xs text-muted md:flex">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: project.color }} />
            <span className="truncate">{project.name}</span>
          </span>
        )}
        <span className="mt-[3px] w-16 shrink-0 text-right text-xs tabular-nums text-muted">{relTime(note.createdAt)}</span>
      </Link>
    </li>
  );
}

/** First real sentence of a note's AI summary (or its own text), for the list. */
function firstLine(md: string) {
  for (const raw of md.split("\n")) {
    const line = raw
      .replace(/^#+\s.*$/, "")
      .replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/\*\*|__|`/g, "")
      .trim();
    if (line && !/^(summary|सारांश)$/i.test(line)) return line.slice(0, 160);
  }
  return "";
}

function TodoRow({ todo, project, done, onDone }: { todo: Todo; project?: Project; done: boolean; onDone: () => void }) {
  const due = todo.due ? dueLabel(todo.due) : null;
  return (
    <li className={`flex items-start gap-3 rounded-lg px-2 py-2 transition-all duration-500 hover:bg-subtle ${done ? "opacity-60" : ""}`}>
      <button
        onClick={onDone}
        disabled={done}
        aria-label={`Mark "${todo.title}" complete`}
        className={`relative mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all duration-200 ${
          done
            ? "scale-110 border-accent bg-accent text-white"
            : "border-foreground/25 hover:scale-110 hover:border-accent hover:bg-accent-soft active:scale-90"
        }`}
      >
        {done && (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="check-draw">
              <path d="M5 12l4.5 4.5L19 7" />
            </svg>
            <Burst />
          </>
        )}
      </button>
      <Link href={todo.projectId ? `/todos?p=${todo.projectId}` : "/todos?tab=mine"} className="min-w-0 flex-1">
        <span className={`block text-[15px] leading-snug transition-colors ${done ? "text-muted line-through decoration-accent/60" : ""}`}>{todo.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {due && (
            <span className={`flex items-center gap-1 ${due.late ? "font-medium text-accent" : due.soon ? "font-medium text-foreground" : ""}`}>
              <Icon name="clock" size={12} />
              {due.text}
            </span>
          )}
          {todo.urgent && (
            <span className="flex items-center gap-1 font-medium text-accent">
              <Icon name="flag" size={12} /> Urgent
            </span>
          )}
          {project ? (
            <span className="flex min-w-0 items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: project.color }} />
              <span className="truncate">{project.name}</span>
            </span>
          ) : (
            <span>Personal</span>
          )}
        </span>
      </Link>
    </li>
  );
}

const BURST_COLORS = ["#dc5a45", "#e9c33b", "#4d96ff", "#4fb384", "#9b7ee6", "#ef9a62"];

/** A tiny confetti pop when a to-do is ticked off. */
function Burst() {
  return (
    <span className="burst pointer-events-none absolute inset-0" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        const d = 18 + (i % 3) * 6;
        return (
          <i
            key={i}
            style={
              {
                background: BURST_COLORS[i % BURST_COLORS.length],
                "--dx": `${Math.cos(a) * d}px`,
                "--dy": `${Math.sin(a) * d}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

/** This week's to-dos, done out of total, as a ring. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <Link href="/todos?tab=mine" className="group hidden shrink-0 flex-col items-center gap-1 pt-6 sm:flex" title="To-dos done this week">
      <span className="relative flex h-16 w-16 items-center justify-center">
        <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-foreground/[0.07]" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)" }}
          />
        </svg>
        <span className="absolute text-sm font-semibold tabular-nums">
          {done}/{total}
        </span>
      </span>
      <span className="text-[11px] text-muted group-hover:text-foreground">done this week</span>
    </Link>
  );
}

function MeetingRow({ event, recorded }: { event: CalendarEvent; recorded: boolean }) {
  const start = new Date(event.start);
  const now = start.getTime() <= Date.now();
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-subtle">
      <div className="w-14 shrink-0 text-sm tabular-nums">
        {now ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" /> Now
          </span>
        ) : (
          start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{event.title}</div>
        {event.attendees.length > 1 && (
          <div className="truncate text-xs text-muted">
            {event.attendees
              .filter((a) => !a.self)
              .map((a) => a.name ?? a.email.split("@")[0])
              .slice(0, 3)
              .join(", ")}
          </div>
        )}
      </div>
      {recorded ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          <Icon name="check" size={13} /> Recorded
        </span>
      ) : (
        <Link
          href={`/notes/new?event=${encodeURIComponent(event.id)}`}
          onClick={() => rememberEvent(event)}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
            now ? "bg-foreground text-background" : "border border-border hover:border-foreground/30"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Record
        </Link>
      )}
    </li>
  );
}

function GettingStarted({ calendar, hasKey }: { calendar: boolean; hasKey: boolean }) {
  const steps: { href: string; icon: IconName; title: string; body: string; onClick?: () => void }[] = [
    { href: "/notes/new", icon: "mic", title: "Record your first meeting", body: "Live transcript now, AI notes after" },
    { href: "/notes/write", icon: "doc", title: "Or write a note", body: "Type it yourself, no recording" },
    { href: "/ideas", icon: "bulb", title: "Jot down an idea", body: "Half-formed is fine. AI can riff on it" },
    ...(calendar ? [] : [{ href: "#", icon: "calendar" as const, title: "Connect your calendar", body: "See meetings and record in one tap", onClick: () => connectCalendar() }]),
    ...(hasKey ? [] : [{ href: "/settings", icon: "sparkles" as const, title: "Turn on AI notes", body: "Add a free Gemini key in a minute" }]),
    { href: "/notes#new-project", icon: "users", title: "Start a team project", body: "Share notes and to-dos with your team" },
    { href: "/inbox", icon: "inbox", title: "Connect Slack", body: "Asks from DMs and @mentions become to-dos" },
  ];
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-b border-border pb-2 font-display text-[24px] leading-none">Get started</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.title}>
            <Link
              href={s.href}
              onClick={(e) => {
                if (s.onClick) {
                  e.preventDefault();
                  s.onClick();
                }
              }}
              className="flex items-center gap-3 rounded-xl bg-subtle/60 px-4 py-3.5 hover:bg-subtle"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-subtle">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-muted">{s.body}</span>
              </span>
              <Icon name="chevronRight" size={16} className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
