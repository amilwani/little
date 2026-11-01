/** Small date helpers shared across screens. Everything uses the user's local day, never UTC. */

export const DAY = 864e5;

/** YYYY-MM-DD for today (or today + offset days) in local time. */
export function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "10:14 AM" today, then "Yesterday", "Tue", "3 Nov". */
export function relTime(iso: string) {
  const t = new Date(iso);
  const days = Math.round((new Date(`${localDay()}T00:00`).getTime() - new Date(t.toDateString()).getTime()) / DAY);
  if (days <= 0)
    return t.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  if (days === 1) return "Yesterday";
  if (days < 7) return t.toLocaleDateString(undefined, { weekday: "short" });
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Label for a to-do due date: "2 days late", "Today", "Tomorrow", "Fri", "12 Nov". */
export function dueLabel(due: string): {
  text: string;
  late: boolean;
  soon?: boolean;
} {
  const today = localDay();
  if (due < today) {
    const days = Math.round((new Date(`${today}T00:00`).getTime() - new Date(`${due}T00:00`).getTime()) / DAY);
    return { text: days === 1 ? "Yesterday" : `${days} days late`, late: true };
  }
  if (due === today) return { text: "Today", late: false, soon: true };
  if (due === localDay(1)) return { text: "Tomorrow", late: false, soon: true };
  const d = new Date(`${due}T00:00`);
  const inWeek = d.getTime() - Date.now() < 6 * DAY;
  return {
    text: d.toLocaleDateString(undefined, inWeek ? { weekday: "short" } : { day: "numeric", month: "short" }),
    late: false,
  };
}

/** Default title for a new note, e.g. "Note 1 Nov, 5:40 PM". */
export function defaultNoteTitle() {
  return `Note ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
}
