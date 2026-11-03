"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

const KEY_PAGE = "https://aistudio.google.com/apikey";
const looksLikeKey = (k: string) => /^AIza[0-9A-Za-z_-]{30,}$/.test(k.trim());

/** Checks a Gemini key with a tiny, free request. */
async function checkKey(key: string): Promise<"ok" | "bad" | "offline"> {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": key },
    });
    return r.ok ? "ok" : "bad";
  } catch {
    return "offline";
  }
}

/**
 * Two steps to turn on AI: open Google AI Studio to make a free key, then paste it.
 * The key is checked, then saved to the user's Drive and this browser.
 */
export function GeminiKeySetup({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { token } = useAccessToken();
  const { settings, update } = useSettings(token);
  const [opened, setOpened] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "bad" | "offline" | "done">("idle");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const tryKey = async (raw: string) => {
    const k = raw.trim();
    setKey(k);
    if (!looksLikeKey(k)) {
      if (k) setState("bad");
      return;
    }
    setState("checking");
    const result = await checkKey(k);
    if (result !== "ok") return setState(result);
    const s = settingsRef.current;
    // Saved on this device at once; the copy in Drive finishes in the background.
    update({ ...s, aiProvider: "gemini", apiKeys: { ...s.apiKeys, gemini: k } }).catch(() => {});
    setState("done");
    onDone?.();
  };

  const paste = async () => {
    try {
      await tryKey(await navigator.clipboard.readText());
    } catch {
      document.getElementById("gemini-key")?.focus();
    }
  };

  // Back from AI Studio with the key copied: pick it up if the browser already allows clipboard reads.
  useEffect(() => {
    if (!opened || state === "done") return;
    const onFocus = async () => {
      try {
        const p = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        if (p.state !== "granted") return;
        const text = await navigator.clipboard.readText();
        if (looksLikeKey(text)) tryKey(text);
      } catch {
        /* not supported: the Paste button still works */
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, state]);

  if (state === "done") {
    return (
      <div role="status" className="toast flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white">
          <Icon name="check" size={16} />
        </span>
        <div className="text-sm">
          <p className="font-semibold">AI is on</p>
          <p className="text-muted">Your free Gemini key works. You can change it any time in Settings.</p>
        </div>
      </div>
    );
  }

  const step = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold";
  return (
    <div className={`rounded-2xl border border-border bg-card ${compact ? "p-4" : "p-5"}`}>
      <p className="font-semibold">Turn on AI in two steps</p>
      <p className="mt-0.5 text-[13px] text-muted">Free with your Google account. No card needed.</p>

      <ol className="mt-4 space-y-4">
        <li className="flex gap-3">
          <span className={`${step} ${opened ? "bg-accent text-white" : "bg-foreground text-background"}`}>
            {opened ? <Icon name="check" size={13} /> : 1}
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={KEY_PAGE}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpened(true)}
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 active:scale-[0.97]"
            >
              <Icon name="sparkles" size={15} /> Get free Gemini key <Icon name="external" size={13} />
            </a>
            <p className="mt-1.5 text-[12.5px] text-muted">
              In the page that opens, tap <b className="font-medium text-foreground">Create API key</b>, then{" "}
              <b className="font-medium text-foreground">Copy</b>.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className={`${step} ${opened ? "bg-foreground text-background" : "bg-subtle text-muted"}`}>2</span>
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <input
                id="gemini-key"
                type="password"
                autoComplete="off"
                placeholder="Paste your key here"
                aria-label="Gemini API key"
                value={key}
                onChange={(e) => tryKey(e.target.value)}
                className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 font-mono text-sm outline-none focus:border-foreground/30"
              />
              <button
                onClick={paste}
                disabled={state === "checking"}
                className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium transition hover:bg-subtle active:scale-[0.97] disabled:opacity-60"
              >
                {state === "checking" ? "Checking…" : "Paste"}
              </button>
            </div>
            {state === "bad" && (
              <p className="mt-1.5 text-[12.5px] text-accent">
                That doesn&apos;t look like a working Gemini key. It should start with &ldquo;AIza&rdquo;. Try copying it again.
              </p>
            )}
            {state === "offline" && (
              <p className="mt-1.5 text-[12.5px] text-accent">Couldn&apos;t reach Google to check the key. Check your connection.</p>
            )}
          </div>
        </li>
      </ol>
      <p className="mt-4 text-[12px] text-muted">
        The key is saved only in your Google Drive and this browser. Little never sees it.
      </p>
    </div>
  );
}
