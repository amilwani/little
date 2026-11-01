"use client";

// Reads the user's Google Calendar (read-only) straight from the browser.

import { signIn } from "next-auth/react";
import { BASE_SCOPES, CALENDAR_SCOPE } from "./scopes";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string; // ISO date-time, or yyyy-mm-dd for all-day
  end: string;
  allDay: boolean;
  attendees: { email: string; name?: string; self?: boolean }[];
  meetLink?: string;
  htmlLink: string;
  description?: string;
};

export class CalendarError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function hasCalendar(scope?: string) {
  return !!scope?.split(" ").includes(CALENDAR_SCOPE);
}

/** Sends the user to Google to allow read-only calendar access, then back to the Meetings page. */
export function connectCalendar() {
  return signIn("google", { callbackUrl: "/meetings" }, { scope: `${BASE_SCOPES} ${CALENDAR_SCOPE}` });
}

type ApiEvent = {
  id: string;
  summary?: string;
  status?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean }[];
  hangoutLink?: string;
  htmlLink: string;
  description?: string;
  eventType?: string;
};

export async function listEvents(token: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new CalendarError(`Calendar request failed (${res.status})`, res.status);
  const data = (await res.json()) as { items: ApiEvent[] };
  return data.items
    .filter((e) => e.status !== "cancelled" && e.eventType !== "workingLocation" && e.eventType !== "outOfOffice")
    .map((e) => ({
      id: e.id,
      title: e.summary?.trim() || "(No title)",
      start: e.start.dateTime ?? e.start.date!,
      end: e.end.dateTime ?? e.end.date!,
      allDay: !e.start.dateTime,
      attendees: (e.attendees ?? [])
        .filter((a) => !a.resource)
        .map((a) => ({ email: a.email, name: a.displayName, self: a.self })),
      meetLink: e.hangoutLink,
      htmlLink: e.htmlLink,
      description: e.description,
    }));
}

/** Picks a template from the meeting's title and size. */
export function guessTemplate(e: { title: string; attendees: unknown[] }) {
  const t = e.title.toLowerCase();
  if (/\b1[:\-/ ]?on[:\-/ ]?1\b|\b1:1\b|one[- ]on[- ]one/.test(t) || e.attendees.length === 2) return "one-on-one";
  if (/review|retro|qbr|status|weekly|monthly/.test(t)) return "review";
  if (/brainstorm|ideation|ideas/.test(t)) return "brainstorm";
  if (/decision|decide|approval|go\/no/.test(t)) return "decision";
  if (/walkthrough|walk-through|demo|training|onboarding|how to/.test(t)) return "walkthrough";
  return "general";
}

/** Hands a calendar event to the recording page. */
export function rememberEvent(e: CalendarEvent) {
  try {
    sessionStorage.setItem(`little:event:${e.id}`, JSON.stringify(e));
  } catch {
    /* private mode: the recording page falls back to a blank title */
  }
}

export function recallEvent(id: string): CalendarEvent | null {
  try {
    const raw = sessionStorage.getItem(`little:event:${id}`);
    return raw ? (JSON.parse(raw) as CalendarEvent) : null;
  } catch {
    return null;
  }
}
