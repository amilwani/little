"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { KeyNeeded } from "@/components/KeyNeeded";
import { LanguageToggle, type Lang } from "@/components/LanguageToggle";
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
      <AppHeader back="/" title="Dictate" />
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 pb-40 pt-4">
        <div className="flex items-center justify-between gap-3">
          <LanguageToggle
            value={lang}
            onChange={(l) => {
              setLang(l);
              live.setLanguage(l);
            }}
          />
          {phase === "recording" && (
            <span className="font-mono text-lg tabular-nums">{formatDuration(recorder.elapsedMs)}</span>
          )}
        </div>

        {recorder.error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{recorder.error}</p>}

        {phase === "idle" && (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <Mascot size={120} />
            <p className="text-lg font-semibold">Talk, and I&apos;ll write it up</p>
            <p className="max-w-xs text-sm text-muted">
              Say it however it comes out. I&apos;ll remove the ums, fix the punctuation and give you clean text to
              paste anywhere.
            </p>
          </div>
        )}

        {phase === "recording" && (
          <div className="min-h-48 rounded-2xl border border-border bg-card p-4 leading-relaxed">
            {live.segments.map((s) => s.text).join(" ")} <span className="text-muted">{live.interim}</span>
            {!live.segments.length && !live.interim && <span className="text-muted">Listening…</span>}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-3 text-sm">
            <Mascot size={36} mood="listening" />
            <span>{busy}…</span>
          </div>
        )}
        {error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm">{error}</p>}

        {phase === "done" && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-56 w-full resize-y rounded-2xl border border-border bg-card p-4 leading-relaxed outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={copy} className="rounded-full bg-accent px-6 py-2.5 font-semibold text-white">
                {copied ? "Copied!" : "Copy"}
              </button>
              <button onClick={saveAsNote} className="rounded-full border border-border px-5 py-2.5 font-medium">
                Save as note
              </button>
              {raw && raw !== text && (
                <button onClick={() => setText(raw)} className="rounded-full px-4 py-2.5 text-sm text-muted underline">
                  Show what I heard
                </button>
              )}
            </div>
            {noKey && <KeyNeeded feature="dictation cleanup" />}
          </>
        )}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background to-transparent pt-8">
        {phase === "recording" ? (
          <button
            onClick={stop}
            className="flex items-center gap-2 rounded-full bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg active:scale-[0.97]"
          >
            <span className="inline-block h-3 w-3 rounded-sm bg-white" /> Done
          </button>
        ) : phase !== "working" ? (
          <button
            onClick={start}
            className="flex items-center gap-2 rounded-full bg-accent px-8 py-4 text-lg font-semibold text-white shadow-lg active:scale-[0.97]"
          >
            <span className="inline-block h-3 w-3 rounded-full bg-white" /> {phase === "done" ? "Dictate again" : "Start talking"}
          </button>
        ) : null}
      </div>
    </>
  );
}
