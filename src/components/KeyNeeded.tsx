"use client";

import Link from "next/link";
import { GeminiKeySetup } from "./GeminiKeySetup";

/** Shown when someone uses an AI feature without a key: the two-step setup, right where they are. */
export function KeyNeeded({ feature, audio = false, onDone }: { feature: string; audio?: boolean; onDone?: () => void }) {
  return (
    <div className="space-y-2">
      <p className="px-1 text-sm">
        <span className="font-medium">{feature}</span> uses AI. Turn it on once and it works everywhere in Little.
      </p>
      <GeminiKeySetup compact onDone={onDone} />
      <p className="px-1 text-[12px] text-muted">
        {audio ? "Prefer OpenAI? " : "Prefer OpenAI or Claude? "}
        <Link href="/settings" className="underline hover:text-foreground">
          Add another key in Settings
        </Link>
      </p>
    </div>
  );
}
