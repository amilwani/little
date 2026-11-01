"use client";

// Records microphone audio with MediaRecorder and keeps the screen awake while
// recording (phones can otherwise stop a web page's recording when they lock).

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "paused" | "stopped";

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  if (typeof MediaRecorder === "undefined") return "";
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

type WakeLockSentinelLike = { release: () => Promise<void> };

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wakeRef = useRef<WakeLockSentinelLike | null>(null);
  // Elapsed-time bookkeeping that survives pauses.
  const accumulatedRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);

  const getElapsedMs = useCallback(
    () => accumulatedRef.current + (startedAtRef.current ? Date.now() - startedAtRef.current : 0),
    [],
  );

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setElapsedMs(getElapsedMs()), 250);
    return () => clearInterval(t);
  }, [state, getElapsedMs]);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
      wakeRef.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* not supported or denied: recording still works */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
  }, []);

  // Wake locks are dropped when the tab is hidden; take it again on return.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && state === "recording") requestWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, requestWakeLock]);

  const start = useCallback(async () => {
    setError(null);
    setBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start(1000);
      mediaRef.current = rec;
      accumulatedRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setState("recording");
      requestWakeLock();
      return true;
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow the mic in your browser settings and try again."
          : "Could not start the microphone.",
      );
      return false;
    }
  }, [requestWakeLock]);

  const pause = useCallback(() => {
    if (mediaRef.current?.state !== "recording") return;
    mediaRef.current.pause();
    accumulatedRef.current = getElapsedMs();
    startedAtRef.current = null;
    setElapsedMs(accumulatedRef.current);
    setState("paused");
  }, [getElapsedMs]);

  const resume = useCallback(() => {
    if (mediaRef.current?.state !== "paused") return;
    mediaRef.current.resume();
    startedAtRef.current = Date.now();
    setState("recording");
  }, []);

  const stop = useCallback(() => {
    const rec = mediaRef.current;
    if (!rec || rec.state === "inactive") return;
    accumulatedRef.current = getElapsedMs();
    startedAtRef.current = null;
    setElapsedMs(accumulatedRef.current);
    rec.stop();
    releaseWakeLock();
    setState("stopped");
  }, [getElapsedMs, releaseWakeLock]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      releaseWakeLock();
    },
    [releaseWakeLock],
  );

  return { state, elapsedMs, getElapsedMs, error, blob, start, pause, resume, stop };
}

export function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
