// A small Markdown renderer for AI notes: headings, bullet and task lists,
// numbered lists, bold and italics. Renders text only (no HTML), so model
// output can't inject markup.

import { Icon } from "./Icon";

import { Fragment } from "react";

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Markdown({
  source,
  onToggleTask,
  taskExtra,
}: {
  source: string;
  /** Called with the task's position (0-based) when its checkbox is tapped. */
  onToggleTask?: (n: number, done: boolean) => void;
  /** Extra controls shown after a task, such as "Add to to-dos". */
  taskExtra?: (text: string, n: number) => React.ReactNode;
}) {
  let taskN = -1;
  const lines = source.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: React.ReactNode[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={`list-${out.length}`} className={`${list.ordered ? "list-decimal" : "list-none"} mb-3 space-y-1.5 pl-1`}>
        {list.items}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (h) {
      flush();
      out.push(
        <h3 key={i} className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wide text-muted first:mt-0">
          {inline(h[2])}
        </h3>,
      );
    } else if (task || bullet) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(
        <li key={i} className="flex gap-2 leading-relaxed">
          {task ? (
            <TaskBox n={++taskN} done={task[1] !== " "} onToggle={onToggleTask} />
          ) : (
            <span aria-hidden className="mt-[11px] inline-block h-1 w-1 shrink-0 rounded-full bg-foreground/50" />
          )}
          <span className={`flex-1 ${task && task[1] !== " " ? "text-muted line-through" : ""}`}>
            {inline(task ? task[2] : bullet![1])}
          </span>
          {task && taskExtra?.(task[2], taskN)}
        </li>,
      );
    } else if (num) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(
        <li key={i} className="ml-5 leading-relaxed">
          {inline(num[1])}
        </li>,
      );
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      out.push(
        <p key={i} className="mb-3 leading-relaxed">
          {inline(line)}
        </p>,
      );
    }
  });
  flush();
  return <div>{out}</div>;
}

function TaskBox({ n, done, onToggle }: { n: number; done: boolean; onToggle?: (n: number, done: boolean) => void }) {
  const cls = `mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
    done ? "border-foreground bg-foreground text-background" : "border-foreground/25 hover:border-foreground/60"
  }`;
  const tick = done ? <Icon name="check" size={12} strokeWidth={3} /> : null;
  if (!onToggle) return <span aria-hidden className={cls}>{tick}</span>;
  return (
    <button onClick={() => onToggle(n, !done)} aria-label={done ? "Mark as not done" : "Mark as done"} className={cls}>
      {tick}
    </button>
  );
}
