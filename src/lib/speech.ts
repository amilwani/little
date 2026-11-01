"use client";

// Live transcript using the browser's built-in speech recognition. Free and
// needs no API key. Works best in Chrome (desktop and Android); Safari on
// iPhone supports it but is less reliable. AI transcripts with the user's own
// Gemini or OpenAI key come in step 3.

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "./drive";

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useLiveTranscript(getElapsedSec: () => number) {
  const [supported, setSupported] = useState(true);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRunning = useRef(false);
  const langRef = useRef("en-IN");
  const elapsedRef = useRef(getElapsedSec);
  elapsedRef.current = getElapsedSec;

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (r.isFinal) {
          const startSec = Math.max(0, Math.round(elapsedRef.current()));
          setSegments((s) => [...s, { text, startSec }]);
        } else {
          interimText += `${text} `;
        }
      }
      setInterim(interimText.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed") wantRunning.current = false;
      setError(e.error);
    };
    // Browsers stop recognition after silence or ~60s; restart while recording.
    rec.onend = () => {
      setInterim("");
      if (wantRunning.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, []);

  const start = useCallback(
    (lang: string) => {
      langRef.current = lang;
      wantRunning.current = true;
      setError(null);
      startRecognition();
    },
    [startRecognition],
  );

  const stop = useCallback(() => {
    wantRunning.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setInterim("");
  }, []);

  /** Switch language mid-recording (English <-> Hindi). */
  const setLanguage = useCallback(
    (lang: string) => {
      langRef.current = lang;
      if (wantRunning.current && recRef.current) {
        const old = recRef.current;
        old.onend = null;
        old.stop();
        startRecognition();
      }
    },
    [startRecognition],
  );

  const reset = useCallback(() => {
    setSegments([]);
    setInterim("");
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { supported, segments, interim, error, start, stop, setLanguage, reset };
}
