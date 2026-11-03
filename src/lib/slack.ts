"use client";

// Slack Inbox: recent Slack messages that matter to you, with the actionables
// the AI picked out. The Slack token never reaches the browser; it stays in an
// encrypted cookie that only Little's server routes can read.

export type SlackMessage = {
  id: string;
  at: string;
  from: string;
  fromMe: boolean;
  where: string;
  dm: boolean;
  text: string;
  link?: string;
};

export type InboxItem = {
  /** Message id plus the action, so one message can hold two asks. */
  key: string;
  messageId: string;
  title: string;
  due?: string;
  /** Who asked (or "you" for your own promise). */
  who: string;
  where: string;
  at: string;
  quote: string;
  link?: string;
  mine: boolean;
};

export type SlackFeed =
  | { connected: false; configured: boolean; error?: string }
  | { connected: true; configured: true; team: string; messages: SlackMessage[] };

export async function fetchSlack(days = 2): Promise<SlackFeed> {
  const r = await fetch(`/api/slack/messages?days=${days}`, { cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Couldn't reach Slack. Try again.");
  return data as SlackFeed;
}

export async function disconnectSlack() {
  await fetch("/api/slack/disconnect", { method: "POST" });
  writeCache(null);
}

// ---- Local cache: what's been read, extracted and handled --------------------

const CACHE = "little:inbox";

export type InboxCache = {
  team: string;
  at: string;
  /** Message ids the AI has already looked at, so we only send new ones. */
  seen: string[];
  items: InboxItem[];
  /** Items added to to-dos or dismissed. */
  handled: string[];
};

export function readCache(): InboxCache | null {
  try {
    const raw = localStorage.getItem(CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeCache(c: InboxCache | null) {
  try {
    if (c) localStorage.setItem(CACHE, JSON.stringify(c));
    else localStorage.removeItem(CACHE);
    window.dispatchEvent(new Event("little:inbox"));
  } catch {
    /* private mode */
  }
}

/** How many Slack actionables are waiting, for badges elsewhere in the app. */
export function pendingCount(c: InboxCache | null = readCache()) {
  if (!c) return 0;
  const done = new Set(c.handled);
  return c.items.filter((i) => !done.has(i.key)).length;
}
