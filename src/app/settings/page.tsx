"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import type { AiProvider, Settings } from "@/lib/drive";
import { cache } from "@/lib/local";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

const PROVIDERS: { id: AiProvider; name: string; getKey: string; note: string }[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    getKey: "https://aistudio.google.com/apikey",
    note: "Recommended. Sign in with the same Google account and create a key in about a minute.",
  },
  {
    id: "openai",
    name: "OpenAI",
    getKey: "https://platform.openai.com/api-keys",
    note: "Works for AI notes and transcripts.",
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    getKey: "https://console.anthropic.com/settings/keys",
    note: "Works for AI notes. Transcripts still use your browser, since Claude can't process audio.",
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const { token, status, user } = useAccessToken();
  const { settings, update } = useSettings(token);
  const [draft, setDraft] = useState<Settings>(settings);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  const save = async (next: Settings) => {
    setDraft(next);
    try {
      await update(next);
      setSaved("Saved to your Google Drive.");
    } catch {
      setSaved("Saved on this device. Couldn't reach Google Drive.");
    }
    setTimeout(() => setSaved(null), 2500);
  };

  const setKey = (p: AiProvider, key: string) =>
    setDraft((d) => ({ ...d, apiKeys: { ...d.apiKeys, [p]: key.trim() || undefined } }));

  const row = "flex items-center justify-between gap-4 px-4 py-3.5";
  const group = "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card";
  const label = "mb-2 px-1 text-[13px] font-medium text-muted";

  return (
    <>
      <AppHeader back="/" title="Settings" />
      <main className="pb-nav mx-auto max-w-2xl space-y-8 px-4 pt-6 md:pt-10">
        <h1 className="hidden text-[26px] font-semibold leading-tight tracking-tight md:block">Settings</h1>
        {saved && (
          <p role="status" className="animate-pop fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            {saved}
          </p>
        )}

        <section>
          <h2 className={label}>Recording</h2>
          <div className={group}>
            <label className={`${row} cursor-pointer`}>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">Save audio recordings</span>
                <span className="block text-[13px] text-muted">Keeps the audio in Drive next to the transcript and notes.</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={draft.saveAudio}
                onChange={(e) => save({ ...draft, saveAudio: e.target.checked })}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="relative h-6 w-10 shrink-0 rounded-full bg-border transition peer-checked:bg-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"
              />
            </label>
            <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-[15px] font-medium">Default language</span>
              <LanguageToggle value={draft.defaultLanguage} onChange={(l) => save({ ...draft, defaultLanguage: l })} />
            </div>
          </div>
        </section>

        <section>
          <h2 className={label}>AI features</h2>
          <p className="mb-3 px-1 text-[13px] leading-relaxed text-muted">
            Recording and notes are free and need no key. AI notes, Ask and dictation cleanup use your own API key, so you
            pay your AI provider directly. Your key is stored only in your Google Drive and this browser.
          </p>
          <div className={group}>
            {PROVIDERS.map((p) => {
              const on = draft.aiProvider === p.id;
              return (
                <div key={p.id} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex cursor-pointer items-center gap-2.5 text-[15px] font-medium">
                      <input
                        type="radio"
                        name="provider"
                        checked={on}
                        onChange={() => setDraft((d) => ({ ...d, aiProvider: p.id }))}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? "border-foreground bg-foreground" : "border-foreground/25"}`}
                      >
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-background" />}
                      </span>
                      {p.name}
                      {draft.apiKeys[p.id] && <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] font-normal text-muted">Key added</span>}
                    </label>
                    <a href={p.getKey} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
                      Get a key <Icon name="chevronRight" size={13} />
                    </a>
                  </div>
                  <p className="mt-1 pl-7 text-[13px] text-muted">{p.note}</p>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="Paste your API key"
                    aria-label={`${p.name} API key`}
                    value={draft.apiKeys[p.id] ?? ""}
                    onChange={(e) => setKey(p.id, e.target.value)}
                    className="mt-2.5 ml-7 w-[calc(100%-1.75rem)] rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-foreground/30"
                  />
                </div>
              );
            })}
          </div>
          <button onClick={() => save(draft)} className="mt-3 w-full rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background active:scale-[0.99]">
            Save AI settings
          </button>
        </section>

        <section className="hidden md:block">
          <h2 className={label}>Keyboard shortcuts</h2>
          <div className={`${group} grid grid-cols-2 divide-y-0 text-sm`}>
            {[
              ["⌘ K", "Search and jump"],
              ["/", "Search"],
              ["N", "Record a meeting"],
              ["W", "Write a note"],
              ["D", "Dictate"],
              ["H", "Home"],
              ["O", "All notes"],
              ["I", "Ideas"],
              ["T", "To-dos"],
              ["M", "Meetings"],
              ["A", "Ask your notes"],
              ["⌘ S", "Save a note"],
            ].map(([k, what]) => (
              <div key={k} className="flex items-center gap-3 border-b border-border px-4 py-2.5 odd:border-r">
                <kbd className="min-w-9 rounded border border-border bg-background px-1.5 py-0.5 text-center text-xs">{k}</kbd>
                <span className="text-muted">{what}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className={label}>Account</h2>
          <div className={group}>
            <div className={row}>
              <span className="flex min-w-0 items-center gap-3">
                <Mascot size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{user?.name}</span>
                  <span className="block truncate text-[13px] text-muted">{user?.email}</span>
                </span>
              </span>
              <button
                onClick={async () => {
                  await cache.clear();
                  try {
                    localStorage.removeItem("little:settings");
                  } catch {}
                  signOut({ redirectTo: "/" });
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-foreground/30"
              >
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>
          </div>
          <p className="mt-2 px-1 text-xs text-muted">
            Everything Little saves is in the &ldquo;Little&rdquo; folder of your Google Drive. Signing out clears this device&apos;s copy only.
          </p>
        </section>
      </main>
    </>
  );
}
