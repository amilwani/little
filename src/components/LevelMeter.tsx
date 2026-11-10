"use client";

import { useEffect, useRef } from "react";

/**
 * A row of bars that move with the microphone, so you can see Little is hearing
 * you. Draws straight to the DOM (no re-renders) and goes flat while paused.
 */
export function LevelMeter({ stream, active, bars = 28, className = "" }: { stream: MediaStream | null; active: boolean; bars?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream || !active) {
      el?.querySelectorAll<HTMLSpanElement>("span").forEach((b) => (b.style.transform = "scaleY(0.12)"));
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Some browsers start an AudioContext suspended until asked.
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const spans = [...el.querySelectorAll<HTMLSpanElement>("span")];
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      // Voices live in the lower bins; mirror them so the bars peak in the middle.
      const half = Math.ceil(spans.length / 2);
      for (let i = 0; i < spans.length; i++) {
        const k = Math.abs(i - (spans.length - 1) / 2);
        const bin = Math.min(data.length - 1, Math.floor((k / half) * 48) + 2);
        const v = data[bin] / 255;
        spans[i].style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.25))})`;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream, active]);

  return (
    <div ref={ref} aria-hidden className={`flex h-10 items-center justify-center gap-[3px] ${className}`}>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="h-full w-[3px] origin-center rounded-full bg-current transition-transform duration-75" style={{ transform: "scaleY(0.12)" }} />
      ))}
    </div>
  );
}
