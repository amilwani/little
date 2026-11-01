"use client";

import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LanguageToggle } from "@/components/LanguageToggle";
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

  return (
    <>
      <AppHeader back="/" title="Settings" />
      <main className="mx-auto max-w-2xl space-y-8 px-4 pb-24 pt-6">
        {saved && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{saved}</p>}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Recording</h2>
          <label className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
            <span>
              <span className="block font-medium">Save audio recordings</span>
              <span className="text-sm text-muted">Keeps the audio in Drive next to the transcript and notes.</span>
            </span>
            <input
              type="checkbox"
              checked={draft.saveAudio}
              onChange={(e) => save({ ...draft, saveAudio: e.target.checked })}
              className="h-5 w-5 accent-[var(--accent)]"
            />
          </label>
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
            <span className="font-medium">Default language</span>
            <LanguageToggle value={draft.defaultLanguage} onChange={(l) => save({ ...draft, defaultLanguage: l })} />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <Mascot size={48} />
            <div>
              <h2 className="text-lg font-semibold">AI features</h2>
              <p className="text-sm text-muted">
                Recording and notes are free and need no key. AI notes and dictation cleanup use your own API key,
                so you pay your AI provider directly. Your key is stored only in your Google Drive and this browser.
              </p>
            </div>
          </div>

          {PROVIDERS.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="radio"
                    name="provider"
                    checked={draft.aiProvider === p.id}
                    onChange={() => setDraft((d) => ({ ...d, aiProvider: p.id }))}
                    className="accent-[var(--accent)]"
                  />
                  {p.name}
                </label>
                <a href={p.getKey} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
                  Get a key
                </a>
              </div>
              <p className="mt-1 text-xs text-muted">{p.note}</p>
              <input
                type="password"
                autoComplete="off"
                placeholder="Paste your API key"
                value={draft.apiKeys[p.id] ?? ""}
                onChange={(e) => setKey(p.id, e.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-accent"
              />
            </div>
          ))}
          <button
            onClick={() => save(draft)}
            className="w-full rounded-2xl bg-accent px-5 py-3 font-semibold text-white active:scale-[0.99]"
          >
            Save AI settings
          </button>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Account</h2>
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-3">
            <span className="truncate text-sm">{user?.email}</span>
            <button
              onClick={async () => {
                await cache.clear();
                try {
                  localStorage.removeItem("little:settings");
                } catch {}
                signOut({ redirectTo: "/" });
              }}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium"
            >
              Sign out
            </button>
          </div>
          <p className="text-xs text-muted">
            Everything Little saves is in the &ldquo;Little&rdquo; folder of your Google Drive. Signing out clears this
            device&apos;s copy only.
          </p>
        </section>
      </main>
    </>
  );
}
