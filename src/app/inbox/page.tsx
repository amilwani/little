"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { KeyNeeded } from "@/components/KeyNeeded";
import { Mascot } from "@/components/Mascot";
import { AiError, extractSlackActions, pickTextAi } from "@/lib/ai";
import { dueLabel, relTime } from "@/lib/dates";
import {
  disconnectSlack,
  fetchSlack,
  readCache,
  writeCache,
  type InboxCache,
  type InboxItem,
  type SlackMessage,
} from "@/lib/slack";
import { newTodo, updateTodos } from "@/lib/todos";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

const STALE_MS = 10 * 60 * 1000;
const KEEP_DAYS = 7;
const BATCH = 60;

const ERRORS: Record<string, string> = {
  setup: "Slack isn't set up for this copy of Little yet.",
  denied: "Slack wasn't connected. You can try again any time.",
  state: "That Slack sign-in expired. Please try again.",
  exchange: "Slack didn't finish connecting. Please try again.",
};

export default function InboxPage() {
  return (
    <Suspense>
      <Inbox />
    </Suspense>
  );
}

type Status = "loading" | "setup" | "connect" | "ready";

function Inbox() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, status: authStatus, user } = useAccessToken();
  const { settings, loaded: settingsLoaded } = useSettings(token);
  const ai = pickTextAi(settings);
  const [status, setStatus] = useState<Status>("loading");
  const [cache, setCache] = useState<InboxCache | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => ERRORS[params.get("error") ?? ""] ?? null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [needKey, setNeedKey] = useState(false);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/");
  }, [authStatus, router]);

  useEffect(() => {
    const c = readCache();
    if (c) {
      setCache(c);
      setStatus("ready");
    }
    if (params.get("connected")) setToast({ text: "Slack connected" });
    if (params.get("connected") || params.get("error")) router.replace("/inbox", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = (c: InboxCache) => {
    setCache(c);
    writeCache(c);
  };

  const refresh = useCallback(async () => {
    setError(null);
    setBusy("Checking Slack");
    try {
      const feed = await fetchSlack(2);
      if (!feed.connected) {
        setStatus(feed.configured ? "connect" : "setup");
        if (feed.error) setError(feed.error);
        writeCache(null);
        setCache(null);
        return;
      }
      setStatus("ready");
      const prev = readCache();
      const base: InboxCache = prev ?? { team: feed.team, at: "", seen: [], items: [], handled: [] };
      const seen = new Set(base.seen);
      const fresh = feed.messages.filter((m) => !seen.has(m.id));
      let items = base.items;
      if (fresh.length && ai) {
        setNeedKey(false);
        const found: InboxItem[] = [];
        for (let i = 0; i < fresh.length; i += BATCH) {
          const batch = fresh.slice(i, i + BATCH);
          setBusy(`Reading ${fresh.length} new message${fresh.length === 1 ? "" : "s"}`);
          const actions = await extractSlackActions(ai, batch);
          for (const a of actions) found.push(toItem(batch[a.ref - 1], a));
          batch.forEach((m) => seen.add(m.id));
        }
        const keys = new Set(items.map((x) => x.key));
        items = [...found.filter((x) => !keys.has(x.key)), ...items];
      } else if (fresh.length) {
        setNeedKey(true);
      }
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      items = items.filter((x) => new Date(x.at).getTime() > cutoff).sort((a, b) => b.at.localeCompare(a.at));
      const live = new Set(items.map((x) => x.key));
      save({
        team: feed.team,
        at: new Date().toISOString(),
        seen: [...seen].slice(-1500),
        items,
        handled: base.handled.filter((k) => live.has(k)),
      });
    } catch (e) {
      setError(e instanceof AiError || e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setStatus((s) => (s === "loading" ? "connect" : s));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai?.provider, ai?.apiKey]);

  // A key was just added: read the messages that were waiting for it.
  useEffect(() => {
    if (needKey && ai) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needKey, !!ai]);

  // Check Slack on open, unless we looked a moment ago.
  useEffect(() => {
    if (authStatus !== "authenticated" || !settingsLoaded) return;
    const c = readCache();
    if (!c || Date.now() - new Date(c.at).getTime() > STALE_MS || params.get("connected")) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, settingsLoaded]);

  const setHandled = (key: string, on: boolean) => {
    const c = readCache();
    if (!c) return;
    const handled = new Set(c.handled);
    if (on) handled.add(key);
    else handled.delete(key);
    save({ ...c, handled: [...handled] });
  };

  const addTodo = async (item: InboxItem) => {
    if (!token) return;
    setHandled(item.key, true);
    try {
      const todo = newTodo(item.title, { due: item.due, link: item.link, createdBy: user?.email ?? undefined });
      await updateTodos(token, (list) => [todo, ...list]);
      setToast({ text: "Added to My tasks" });
    } catch {
      setHandled(item.key, false);
      setError("Couldn't save the to-do to Google Drive. Try again.");
    }
  };

  const dismiss = (item: InboxItem) => {
    setHandled(item.key, true);
    setToast({ text: "Dismissed", undo: () => setHandled(item.key, false) });
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Slack? Little will forget your Slack sign-in on this device.")) return;
    await disconnectSlack();
    setCache(null);
    setStatus("connect");
  };

  const handled = new Set(cache?.handled ?? []);
  const open = (cache?.items ?? []).filter((i) => !handled.has(i.key));

  return (
    <>
      <AppHeader
        actions={
          status === "ready" ? (
            <button
              onClick={refresh}
              disabled={!!busy}
              aria-label="Refresh"
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-foreground disabled:opacity-50"
            >
              <Icon name="refresh" size={16} className={busy ? "animate-spin" : ""} />
            </button>
          ) : undefined
        }
      />
      <main className="pb-nav mx-auto max-w-3xl px-4 pt-5 md:px-8 md:pt-8">
        <h1 className="font-display text-[36px] font-normal leading-[1.05] tracking-[-0.01em]">Slack inbox</h1>
        <p className="mt-1 text-sm text-muted">
          Things people asked of you in Slack, and things you promised. From your DMs and @mentions in the last 2 days.
        </p>

        {error && <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">{error}</p>}

        {status === "loading" ? (
          <div className="mt-6 space-y-3" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : status === "setup" ? (
          <SetupNeeded />
        ) : status === "connect" ? (
          <Connect />
        ) : (
          <>
            <div className="mt-5 flex items-center gap-2 text-[13px] text-muted">
              <SlackMark size={14} />
              <span className="truncate">{cache?.team ?? "Slack"}</span>
              {cache?.at && <span>· checked {relTime(cache.at)}</span>}
              <span className="flex-1" />
              <button onClick={disconnect} className="hover:text-foreground hover:underline">
                Disconnect
              </button>
            </div>

            {busy && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
                <Mascot size={28} mood="listening" />
                <span>{busy}…</span>
              </div>
            )}

            {needKey && !ai && (
              <div className="mt-4">
                <KeyNeeded feature="Slack inbox" />
              </div>
            )}

            {open.length > 0 ? (
              <ul className="stagger mt-4 space-y-3">
                {open.map((item) => (
                  <InboxCard key={item.key} item={item} onAdd={() => addTodo(item)} onDismiss={() => dismiss(item)} />
                ))}
              </ul>
            ) : (
              !busy && (
                <div className="mt-14 flex flex-col items-center text-center">
                  <Mascot size={72} />
                  <p className="mt-4 font-display text-[26px] leading-tight">You&apos;re all caught up</p>
                  <p className="mt-1 max-w-xs text-sm text-muted">
                    Nothing in Slack is waiting on you. New asks and promises show up here.
                  </p>
                </div>
              )
            )}
          </>
        )}
      </main>

      {toast && (
        <div className="toast fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-8">
          <div
            role="status"
            className="flex items-center gap-3 rounded-full bg-foreground py-2 pl-4 pr-2 text-sm text-background shadow-2xl"
          >
            <Icon name="check" size={15} />
            <span>{toast.text}</span>
            {toast.undo ? (
              <button
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
                className="rounded-full bg-background/15 px-3 py-1 font-medium"
              >
                Undo
              </button>
            ) : toast.text.startsWith("Added") ? (
              <Link href="/todos?tab=mine" className="rounded-full bg-background/15 px-3 py-1 font-medium">
                View
              </Link>
            ) : (
              <span className="w-1" />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function toItem(m: SlackMessage, a: { title: string; due?: string; who: string }): InboxItem {
  const slug = a.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const mine = a.who.toLowerCase() === "you" || (m.fromMe && a.who.toLowerCase() !== m.from.toLowerCase());
  return {
    key: `${m.id}:${slug}`,
    messageId: m.id,
    title: a.title,
    due: a.due,
    who: mine ? "you" : a.who,
    where: m.where,
    at: m.at,
    quote: m.text,
    link: m.link,
    mine,
  };
}

function InboxCard({ item, onAdd, onDismiss }: { item: InboxItem; onAdd: () => void; onDismiss: () => void }) {
  const due = item.due ? dueLabel(item.due) : null;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 transition hover:border-foreground/20">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-subtle">
          <SlackMark size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-snug">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            <span>{item.mine ? "You promised" : `${item.who} asked`}</span>
            <span>·</span>
            <span>{item.where}</span>
            <span>·</span>
            <span>{relTime(item.at)}</span>
            {due && (
              <span
                className={`flex items-center gap-1 ${due.late ? "text-accent" : due.soon ? "text-foreground" : ""}`}
              >
                <Icon name="clock" size={12} /> {due.text}
              </span>
            )}
          </p>
          <blockquote className="mt-2 line-clamp-2 border-l-2 border-border pl-3 text-[13px] leading-relaxed text-foreground/60">
            {item.quote}
          </blockquote>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onAdd}
              className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-[13px] font-medium text-background transition hover:opacity-90 active:scale-[0.97]"
            >
              <Icon name="plus" size={14} /> Add to to-dos
            </button>
            <button
              onClick={onDismiss}
              className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium transition hover:bg-subtle active:scale-[0.97]"
            >
              Dismiss
            </button>
            {item.link && (
              <a
                href={item.link}
                target="_blank"
                rel="noreferrer"
                className="ml-auto flex items-center gap-1 text-[13px] text-muted hover:text-foreground"
              >
                Open in Slack <Icon name="external" size={13} />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Connect() {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <SlackMark size={30} />
      </span>
      <p className="mt-5 font-display text-[28px] leading-tight">Never miss an ask in Slack</p>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Little reads your DMs and the messages that @mention you, picks out what you need to do, and lets you add it to
        your to-dos in one tap.
      </p>
      <a
        href="/api/slack/connect"
        className="mt-6 flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background shadow-sm transition hover:opacity-90 active:scale-[0.97]"
      >
        <SlackMark size={16} /> Connect Slack
      </a>
      <ul className="mt-6 space-y-1.5 text-left text-[13px] text-muted">
        <li className="flex items-center gap-2">
          <Icon name="shield" size={14} /> Read-only. Little can never post or change anything.
        </li>
        <li className="flex items-center gap-2">
          <Icon name="shield" size={14} /> Messages go straight to your own AI key, never stored by Little.
        </li>
        <li className="flex items-center gap-2">
          <Icon name="shield" size={14} /> Disconnect any time.
        </li>
      </ul>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="mt-10 flex flex-col items-center text-center">
      <Mascot size={64} mood="sleepy" />
      <p className="mt-4 font-display text-[24px] leading-tight">Slack isn&apos;t set up yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted">
        Whoever runs this copy of Little needs to add a Slack app ID and secret. Once that&apos;s done, you can connect
        here.
      </p>
    </div>
  );
}

/** Slack's four-colour mark. */
function SlackMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 122.8 122.8" aria-hidden>
      <path
        fill="#e01e5a"
        d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9zm6.5 0a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 1 1-25.8 0z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9zm0 6.5a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 1 1 0-25.8z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97zm-6.5 0a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 1 1 25.8 0z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97zm0-6.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 1 1 0 25.8z"
      />
    </svg>
  );
}
