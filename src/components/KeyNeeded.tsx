import Link from "next/link";
import { Mascot } from "./Mascot";

/** Shown the first time someone uses an AI feature without a key. */
export function KeyNeeded({ feature, audio = false }: { feature: string; audio?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
      <Mascot size={44} />
      <div className="text-sm">
        <p className="font-semibold">Add an AI key to use {feature}</p>
        <p className="mt-1 text-muted">
          {audio
            ? "AI transcripts need a Gemini or OpenAI key."
            : "Use a Gemini, OpenAI or Claude key."}{" "}
          You pay your AI provider directly, and the key stays in your Drive and this browser. A free Gemini key takes
          about a minute.
        </p>
        <Link href="/settings" className="mt-3 inline-block rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
          Add a key
        </Link>
      </div>
    </div>
  );
}
