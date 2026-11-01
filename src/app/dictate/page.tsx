"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { LanguageToggle, type Lang } from "@/components/LanguageToggle";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { AiError, cleanupDictation, pickTextAi, pickTranscriber, PROVIDER_NAMES, transcribeAudio } from "@/lib/ai";
import { cache, type PendingNote } from "@/lib/local";
import { saveNoteToDrive } from "@/lib/notes";
import { formatDuration, useRecorder } from "@/lib/recorder";
import { useLiveTranscript } from "@/lib/speech";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

type Phase = "idle" | "recording" | "working" | "done";

export default function Dictate() {
  const router = useRouter();
  const { token, status } = useAccessToken();
  const { settings } = useSettings(token);
  const recorder = useRecorder();
  const live = useLiveTranscript(() => recorder.getElapsedMs() / 1000);

  const [lang, setLang] = useState<Lang>("en-IN");
  const [phase, setPhase] = useState<Phase>("idle");
  const [raw, setRaw] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);
  useEffect(() => setLang(settings.defaultLanguage), [settings.defaultLanguage]);

  const start = async () => {
    setError(null);
    setText("");
    setRaw("");
    setNoKey(false);
    handled.current = false;
    live.reset();
    if (await recorder.start()) {
      live.start(lang);
      setPhase("recording");
    }
  };

  const stop = () => {
    live.stop();
    recorder.stop();
    setPhase("working");
  };

  // When the audio is ready: optionally re-transcribe with AI, then clean up.
  useEffect(() => {
    if (phase !== "working" || !recorder.blob || handled.current) return;
    handled.current = true;
    (async () => {
      let words = live.segments.map((s) => s.text).join(" ");
      const transcriber = pickTranscriber(settings);
      const textAi = pickTextAi(settings);
      try {
        if (transcriber && recorder.blob) {
          setBusy(`Listening again with ${PROVIDER_NAMES[transcriber.provider]}`);
          try {
            const t = await transcribeAudio(transcriber, recorder.blob, lang);
            const better = t.segments.map((s) => s.text).join(" ");
            if (better.trim()) words = better;
          } catch {
            /* fall back to the live transcript */
          }
        }
        setRaw(words);
        if (!textAi) {
          setText(words);
          setNoKey(true);
        } else {
          setBusy(`Polishing with ${PROVIDER_NAMES[textAi.provider]}`);
          setText(await cleanupDictation(textAi, words));
        }
      } catch (e) {
        setText(words);
        setError(e instanceof AiError ? e.message : "Couldn't clean up the text. Showing what I heard.");
      }
      setBusy(null);
      setPhase("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recorder.blob]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveAsNote = async () => {
    if (!token) return;
    const createdAt = new Date().toISOString();
    const note: PendingNote = {
      id: crypto.randomUUID(),
      title: `Dictation ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`,
      createdAt,
      durationSec: Math.round(recorder.elapsedMs / 1000),
      language: lang,
      notes: text,
      transcript: { language: lang, source: "browser", segments: raw ? [{ startSec: 0, text: raw }] : [] },
      audio: recorder.blob,
    };
    setBusy("Saving to your Drive");
    await cache.savePending(note);
    try {
      await saveNoteToDrive(token, note, { saveAudio: settings.saveAudio });
      router.push(`/notes/${note.id}`);
    } catch {
      setError("Couldn't upload to Drive. It's saved on this device and will upload later.");
    }
    setBusy(null);
  };

  return (
    <>
      <AppHeader back="/" title="Dictate" focus />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-44 pt-6 md:pt-10">
        <div className="flex items-center justify-between gap-3">
          <LanguageToggle
            value={lang}
            onChange={(l) => {
              setLang(l);
              live.setLanguage(l);
            }}
          />
          {phase === "recording" && (
            <span className="flex items-center gap-2 text-lg font-medium tabular-nums">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
              {formatDuration(recorder.elapsedMs)}
            </span>
          )}
        </div>

        {recorder.error && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{recorder.error}</p>}

        {phase === "idle" && (
          <div className="mt-12 flex flex-col items-center gap-3 text-center">
            <Mascot size={96} />
            <p className="font-display text-[28px] leading-tight">Talk, and I&apos;ll write it up</p>
            <p className="max-w-xs text-sm text-muted">
              Say it however it comes out. I&apos;ll remove the ums, fix the punctuation and give you clean text to paste
              anywhere.
            </p>
          </div>
        )}

        {phase === "recording" && (
          <div className="min-h-48 text-xl leading-relaxed">
            {live.segments.map((s) => s.text).join(" ")} <span className="text-muted">{live.interim}</span>
            {!live.segments.length && !live.interim && <span className="text-muted">Listening…</span>}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
            <Mascot size={32} mood="listening" />
            <span>{busy}…</span>
          </div>
        )}
        {error && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}

        {phase === "done" && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Your text"
              className="min-h-56 w-full resize-y rounded-2xl border border-border bg-card p-4 text-[17px] leading-relaxed outline-none focus:border-foreground/30"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={copy} className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
                <Icon name={copied ? "check" : "copy"} size={16} /> {copied ? "Copied" : "Copy"}
              </button>
              <button onClick={saveAsNote} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-foreground/30">
                <Icon name="notes" size={16} /> Save as note
              </button>
              {raw && raw !== text && (
                <button onClick={() => setText(raw)} className="ml-auto text-sm text-muted hover:text-foreground">
                  Show what I heard
                </button>
              )}
            </div>
            {noKey && <KeyNeeded feature="dictation cleanup" />}
          </>
        )}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-gradient-to-t from-background via-background to-transparent pt-10">
        {phase === "recording" ? (
          <button
            onClick={stop}
            aria-label="Done"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground text-background shadow-xl active:scale-95"
          >
            <span className="h-5 w-5 rounded-[5px] bg-accent" />
          </button>
        ) : phase !== "working" ? (
          <button
            onClick={start}
            aria-label={phase === "done" ? "Dictate again" : "Start talking"}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_24px_-8px_rgba(220,90,69,0.8)] active:scale-95"
          >
            <Icon name="mic" size={28} strokeWidth={2} />
          </button>
        ) : null}
        <span className="text-xs text-muted">
          {phase === "recording" ? "Tap when you're done" : phase === "done" ? "Dictate again" : phase === "idle" ? "Tap to start talking" : ""}
        </span>
      </div>
    </>
  );
}
