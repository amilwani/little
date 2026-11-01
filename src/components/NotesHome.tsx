"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "./AppHeader";
import { Mascot } from "./Mascot";
import { loadIndex, type NoteMeta } from "@/lib/drive";
import { cache, type PendingNote } from "@/lib/local";
import { syncPending } from "@/lib/notes";
import { formatDuration } from "@/lib/recorder";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

export function NotesHome() {
  const { token, user } = useAccessToken();
  const { settings } = useSettings(token);
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      if ((await cache.listPending()).length) await syncPending(token, settings.saveAudio);
      const { index } = await loadIndex(token);
      setNotes(index.notes);
      await cache.setIndex(index);
      setError(null);
    } catch {
      setError("Couldn't reach Google Drive. Showing what's saved on this device.");
    }
    setPending(await cache.listPending());
  }, [token, settings.saveAudio]);

  useEffect(() => {
    // Show the cached list instantly, then refresh from Drive.
    cache.getIndex().then((i) => i && setNotes((n) => n ?? i.notes));
    cache.listPending().then(setPending);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);

  const firstName = user?.name?.split(" ")[0];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pb-32 pt-6">
        <h1 className="text-2xl font-bold">{firstName ? `Hi ${firstName}` : "Your notes"}</h1>
        {error && <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">{error}</p>}

        {pending.length > 0 && (
          <section className="mt-6">
            <h2 className="text-sm font-medium text-muted">Waiting to upload</h2>
            <ul className="mt-2 space-y-2">
              {pending.map((p) => (
                <li key={p.id} className="rounded-2xl border border-dashed border-border bg-card px-4 py-3">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted">Saved on this device. Uploads to Drive when you&apos;re online.</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6">
          {notes === null ? (
            <p className="text-muted">Loading your notes…</p>
          ) : notes.length === 0 && pending.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <Mascot size={110} mood="sleepy" />
              <p className="font-medium">No notes yet</p>
              <p className="max-w-xs text-sm text-muted">Tap the button below and I&apos;ll start listening.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/notes/${n.id}`}
                    className="block rounded-2xl border border-border bg-card px-4 py-3 transition hover:border-accent"
                  >
                    <div className="font-medium">{n.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {new Date(n.createdAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {formatDuration(n.durationSec * 1000)}
                      {" · "}
                      {n.language === "hi-IN" ? "हिंदी" : "English"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background to-transparent pt-8">
        <Link
          href="/notes/new"
          className="flex items-center gap-2 rounded-full bg-accent px-7 py-4 text-lg font-semibold text-white shadow-lg active:scale-[0.97]"
        >
          <span className="inline-block h-3 w-3 rounded-full bg-white" /> New recording
        </Link>
      </div>
    </>
  );
}
