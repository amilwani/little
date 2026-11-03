"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { CalendarError, connectCalendar, hasCalendar, listEvents, rememberEvent, type CalendarEvent } from "@/lib/calendar";
import { loadIndex, type NoteMeta } from "@/lib/drive";
import { cache } from "@/lib/local";
import { useAccessToken } from "@/lib/useAccessToken";

const DAY = 864e5;

function dayKey(iso: string) {
  return iso.length === 10 ? iso : new Date(iso).toLocaleDateString("en-CA");
}

function dayLabel(key: string) {
  const today = new Date().toLocaleDateString("en-CA");
  const tomorrow = new Date(Date.now() + DAY).toLocaleDateString("en-CA");
  const yesterday = new Date(Date.now() - DAY).toLocaleDateString("en-CA");
  if (key === today) return "Today";
  if (key === tomorrow) return "Tomorrow";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function timeRange(e: CalendarEvent) {
  if (e.allDay) return "All day";
  const f = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${f(e.start)} – ${f(e.end)}`;
}

export default function MeetingsPage() {
  const router = useRouter();
  const { token, status, scope } = useAccessToken();
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [range, setRange] = useState<"week" | "month">("week");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  const connected = hasCalendar(scope);

  useEffect(() => {
    cache.getIndex().then((i) => i && setNotes(i.notes));
    if (token)
      loadIndex(token)
        .then(({ index }) => setNotes(index.notes))
        .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || !connected) return;
    const days = range === "week" ? 7 : 30;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    listEvents(token, new Date(start.getTime() - days * DAY), new Date(start.getTime() + (days + 1) * DAY))
      .then((list) => {
        setEvents(list);
        setError(null);
      })
      .catch((e) => {
        if (e instanceof CalendarError && (e.status === 401 || e.status === 403)) setNeedsConnect(true);
        else setError("Couldn't reach Google Calendar. Check your connection.");
      });
  }, [token, connected, range]);

  const noteByEvent = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    for (const n of notes) if (n.calendarEventId) m.set(n.calendarEventId, n);
    return m;
  }, [notes]);

  const now = Date.now();
  const groups = useMemo(() => {
    const upcoming = new Map<string, CalendarEvent[]>();
    const past = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      const ended = new Date(e.end).getTime() < now;
      const target = ended ? past : upcoming;
      const k = dayKey(e.start);
      target.set(k, [...(target.get(k) ?? []), e]);
    }
    return {
      upcoming: [...upcoming.entries()],
      past: [...past.entries()].reverse().map(([k, list]) => [k, [...list].reverse()] as const),
    };
  }, [events, now]);

  return (
    <>
      <AppHeader />
      <main className="pb-nav mx-auto max-w-3xl px-4 pt-5 md:pt-8">
        {!connected || needsConnect ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <Mascot size={110} />
            <p className="text-lg font-semibold">See your meetings here</p>
            <p className="max-w-sm text-sm text-muted">
              Connect Google Calendar and I&apos;ll list your meetings, start notes with the right title and people, and
              link each note back to its meeting. I can only read your calendar, never change it.
            </p>
            <button onClick={() => connectCalendar()} className="mt-2 flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background">
              <Icon name="calendar" size={16} />
              Connect Google Calendar
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="font-display text-[36px] font-normal leading-[1.05] tracking-[-0.01em]">Meetings</h1>
                <p className="mt-0.5 text-sm text-muted">From your Google Calendar</p>
              </div>
              <div className="flex shrink-0 rounded-lg bg-subtle p-0.5 text-sm">
                {(["week", "month"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`whitespace-nowrap rounded-md px-3 py-1 font-medium ${range === r ? "bg-card shadow-sm" : "text-muted"}`}
                  >
                    {r === "week" ? "Week" : "Month"}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}
            {events === null ? (
              <div className="mt-6 space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-subtle" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <p className="mt-10 text-center text-sm text-muted">No meetings in this range.</p>
            ) : (
              <>
                <Section title="Coming up" groups={groups.upcoming} noteByEvent={noteByEvent} now={now} />
                <Section title="Earlier" groups={groups.past} noteByEvent={noteByEvent} now={now} />
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Section({
  title,
  groups,
  noteByEvent,
  now,
}: {
  title: string;
  groups: (readonly [string, CalendarEvent[]])[];
  noteByEvent: Map<string, NoteMeta>;
  now: number;
}) {
  if (!groups.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {groups.map(([day, list]) => (
        <div key={day} className="mt-4">
          <h3 className="mb-2 px-1 text-[13px] font-medium text-muted">{dayLabel(day)}</h3>
          <ul className="-mx-2 flex flex-col">
            {list.map((e) => (
              <EventRow key={e.id} event={e} note={noteByEvent.get(e.id)} now={now} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function EventRow({ event: e, note, now }: { event: CalendarEvent; note?: NoteMeta; now: number }) {
  const live = !e.allDay && new Date(e.start).getTime() - 10 * 60e3 <= now && new Date(e.end).getTime() >= now;
  const ended = new Date(e.end).getTime() < now;
  const others = e.attendees.filter((a) => !a.self);
  const time = e.allDay ? "All day" : new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <li className={`flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-subtle ${live ? "bg-accent-soft/60" : ""}`}>
      <div className="w-16 shrink-0 text-xs tabular-nums text-muted">
        {live ? (
          <span className="flex items-center gap-1.5 font-medium text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> Now
          </span>
        ) : (
          time
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[15px] font-medium ${ended && !note ? "text-muted" : ""}`}>{e.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-xs text-muted">
          <span>{timeRange(e)}</span>
          {others.length > 0 && (
            <span className="flex items-center gap-1" title={others.map((a) => a.name ?? a.email).join(", ")}>
              <Icon name="users" size={12} />
              {others.length === 1 ? (others[0].name ?? others[0].email) : `${others.length} people`}
            </span>
          )}
          {e.meetLink && (
            <a href={e.meetLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
              <Icon name="video" size={12} /> Join
            </a>
          )}
          <a href={e.htmlLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
            <Icon name="calendar" size={12} /> Open
          </a>
        </div>
      </div>
      {note ? (
        <Link
          href={`/notes/${note.id}`}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-foreground/30"
        >
          <Icon name="notes" size={15} /> Notes
        </Link>
      ) : (
        <Link
          href={`/notes/new?event=${encodeURIComponent(e.id)}`}
          onClick={() => rememberEvent(e)}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
            ended ? "text-muted hover:bg-subtle hover:text-foreground" : "bg-foreground text-background"
          }`}
        >
          {ended ? (
            <>
              <Icon name="plus" size={15} /> Notes
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-accent" /> Record
            </>
          )}
        </Link>
      )}
    </li>
  );
}
