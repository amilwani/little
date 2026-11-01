"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LanguageToggle, type Lang } from "@/components/LanguageToggle";
import { Mascot } from "@/components/Mascot";
import { TranscriptView } from "@/components/TranscriptView";
import { cache, type PendingNote } from "@/lib/local";
import { saveNoteToDrive } from "@/lib/notes";
import { formatDuration, useRecorder } from "@/lib/recorder";
import { useLiveTranscript } from "@/lib/speech";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

function defaultTitle() {
  return `Note ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
}

export default function NewRecording() {
  const router = useRouter();
  const { token, status } = useAccessToken();
  const { settings } = useSettings(token);
  const recorder = useRecorder();
  const live = useLiveTranscript(() => recorder.getElapsedMs() / 1000);

  const [lang, setLang] = useState<Lang>("en-IN");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const idRef = useRef<string>("");
  const createdAtRef = useRef<string>("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => setLang(settings.defaultLanguage), [settings.defaultLanguage]);

  // Warn before closing the tab mid-recording.
  useEffect(() => {
    if (recorder.state !== "recording" && recorder.state !== "paused") return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [recorder.state]);

  const start = async () => {
    idRef.current = crypto.randomUUID();
    createdAtRef.current = new Date().toISOString();
    live.reset();
    if (await recorder.start()) live.start(lang);
  };

  const pause = () => {
    recorder.pause();
    live.stop();
  };

  const resume = () => {
    recorder.resume();
    live.start(lang);
  };

  const stop = () => {
    live.stop();
    recorder.stop();
  };

  const changeLang = (l: Lang) => {
    setLang(l);
    live.setLanguage(l);
  };

  // Once the recorder hands over the audio, save locally first, then to Drive.
  useEffect(() => {
    if (recorder.state !== "stopped" || !recorder.blob || savedRef.current) return;
    savedRef.current = true;
    const note: PendingNote = {
      id: idRef.current,
      title: title.trim() || defaultTitle(),
      createdAt: createdAtRef.current,
      durationSec: Math.round(recorder.elapsedMs / 1000),
      language: lang,
      notes,
      transcript: { language: lang, source: "browser", segments: live.segments },
      audio: recorder.blob,
    };
    (async () => {
      setSaving("Saving on this device");
      await cache.savePending(note);
      if (!token) {
        setSaving(null);
        setSaveError("You're signed out. The note is saved on this device and will upload after you sign in.");
        return;
      }
      try {
        await saveNoteToDrive(token, note, { saveAudio: settings.saveAudio, onProgress: setSaving });
        router.replace(`/notes/${note.id}`);
      } catch {
        setSaving(null);
        setSaveError("Couldn't upload to Google Drive. Your note is safe on this device and will upload automatically later.");
      }
    })();
  }, [recorder.state, recorder.blob, recorder.elapsedMs, title, notes, lang, live.segments, token, settings.saveAudio, router]);

  const active = recorder.state === "recording" || recorder.state === "paused";

  return (
    <>
      <AppHeader back="/" title="New recording" />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-40 pt-4">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-lg font-medium outline-none focus:border-accent"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <LanguageToggle value={lang} onChange={changeLang} />
          {!live.supported && (
            <span className="text-xs text-muted">Live transcript isn&apos;t available in this browser. Try Chrome.</span>
          )}
        </div>

        {recorder.error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{recorder.error}</p>}
        {live.error && live.error !== "network" && (
          <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">Transcript paused ({live.error}). Recording continues.</p>
        )}

        {recorder.state === "idle" ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <Mascot size={120} />
            <p className="max-w-xs text-muted">
              Ready when you are. Keep this screen open while recording, especially on iPhone.
            </p>
          </div>
        ) : (
          <>
            {/* Phones: tabs. Larger screens: side by side. */}
            <div className="flex gap-2 md:hidden">
              {(["transcript", "notes"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-xl py-2 text-sm font-medium ${tab === t ? "bg-accent-soft" : "text-muted"}`}
                >
                  {t === "transcript" ? "Transcript" : "My notes"}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <section className={`${tab === "transcript" ? "" : "hidden"} min-h-64 rounded-2xl border border-border bg-card p-4 md:block`}>
                <h2 className="mb-3 hidden text-sm font-medium text-muted md:block">Transcript</h2>
                <TranscriptView segments={live.segments} interim={live.interim} />
              </section>
              <section className={`${tab === "notes" ? "" : "hidden"} rounded-2xl border border-border bg-card p-4 md:block`}>
                <h2 className="mb-3 hidden text-sm font-medium text-muted md:block">My notes</h2>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Jot down anything important…"
                  className="min-h-64 w-full resize-y bg-transparent leading-relaxed outline-none"
                />
              </section>
            </div>
          </>
        )}

        {saving && <p className="text-center text-sm text-muted">{saving}…</p>}
        {saveError && (
          <div className="rounded-xl bg-accent-soft px-4 py-3 text-sm">
            {saveError}{" "}
            <button className="font-semibold underline" onClick={() => router.replace("/")}>
              Back to notes
            </button>
          </div>
        )}
      </main>

      {recorder.state !== "stopped" && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 border-t border-border bg-background/95 pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6">
            <div className="flex items-center gap-2">
              {active && <Mascot size={40} mood={recorder.state === "recording" ? "listening" : "sleepy"} />}
              <span className="font-mono text-xl tabular-nums">{formatDuration(recorder.elapsedMs)}</span>
            </div>
            <div className="flex items-center gap-3">
              {recorder.state === "idle" && (
                <button onClick={start} className="rounded-full bg-accent px-7 py-3.5 font-semibold text-white shadow active:scale-[0.97]">
                  Start recording
                </button>
              )}
              {recorder.state === "recording" && (
                <button onClick={pause} className="rounded-full border border-border px-5 py-3 font-medium">
                  Pause
                </button>
              )}
              {recorder.state === "paused" && (
                <button onClick={resume} className="rounded-full border border-border px-5 py-3 font-medium">
                  Resume
                </button>
              )}
              {active && (
                <button onClick={stop} className="whitespace-nowrap rounded-full bg-accent px-6 py-3 font-semibold text-white shadow active:scale-[0.97]">
                  Stop &amp; save
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
