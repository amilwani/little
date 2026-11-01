import { Icon } from "@/components/Icon";
import type { NoteMeta, Project } from "@/lib/drive";

/** Small tile tinted with the note's project colour: a mic for recordings, a page for written notes. */
export function NoteIcon({ note, project }: { note: NoteMeta; project?: Project }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] transition group-hover:scale-105"
      style={{
        background: project ? `color-mix(in srgb, ${project.color} 14%, transparent)` : "var(--subtle)",
        color: project?.color ?? "var(--muted)",
      }}
    >
      <Icon name={note.kind === "written" ? "doc" : "mic"} size={16} strokeWidth={2} />
    </span>
  );
}
