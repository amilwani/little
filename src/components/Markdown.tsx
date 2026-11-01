// A small Markdown renderer for AI notes: headings, bullet and task lists,
// numbered lists, bold and italics. Renders text only (no HTML), so model
// output can't inject markup.

import { Fragment } from "react";

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: React.ReactNode[] = [];
  let list: { ordered: boolean; items: React.ReactNode[] } | null = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={out.length} className={`${list.ordered ? "list-decimal" : "list-none"} mb-3 space-y-1.5 pl-1`}>
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
        <h3 key={i} className="mb-2 mt-5 text-base font-semibold first:mt-0">
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
            <span aria-hidden className="mt-1 inline-block h-4 w-4 shrink-0 rounded border border-accent" />
          ) : (
            <span aria-hidden className="mt-2.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          )}
          <span>{inline(task ? task[2] : bullet![1])}</span>
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
