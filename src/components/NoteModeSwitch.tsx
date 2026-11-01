"use client";

import Link from "next/link";
import { Icon } from "./Icon";

/** Record or type: the two ways to start a note, one tap apart. */
export function NoteModeSwitch({ mode, projectId }: { mode: "record" | "type"; projectId?: string }) {
  const q = projectId ? `?p=${encodeURIComponent(projectId)}` : "";
  const seg = (on: boolean) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${on ? "bg-card text-foreground shadow-sm" : "text-muted hover:text-foreground"}`;
  return (
    <div className="inline-flex self-start rounded-lg bg-subtle p-0.5" role="tablist" aria-label="How to take this note">
      <Link href={`/notes/new${q}`} replace role="tab" aria-selected={mode === "record"} className={seg(mode === "record")}>
        <Icon name="mic" size={14} /> Record
      </Link>
      <Link href={`/notes/write${q}`} replace role="tab" aria-selected={mode === "type"} className={seg(mode === "type")}>
        <Icon name="doc" size={14} /> Type
      </Link>
    </div>
  );
}
