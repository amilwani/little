"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteMeta, Project } from "@/lib/drive";
import { cache } from "@/lib/local";
import { Icon, type IconName } from "./Icon";

// One box to jump anywhere: notes, projects and actions. Opens with Ctrl/⌘ K,
// "/", or the search button in the header. Single-key shortcuts (n, d, t, m,
// a, h) work anywhere you're not typing.

const OPEN_EVENT = "little:palette";
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

type Item = { id: string; label: string; hint?: string; icon: IconName; href: string; color?: string; group: string; kbd?: string };

const ACTIONS: Item[] = [
  { id: "a-rec", label: "Record a meeting", icon: "mic", href: "/notes/new", group: "Actions", kbd: "N" },
  { id: "a-write", label: "Write a note", icon: "doc", href: "/notes/write", group: "Actions", kbd: "W" },
  { id: "a-dict", label: "Dictate", icon: "pen", href: "/dictate", group: "Actions", kbd: "D" },
  { id: "a-task", label: "Add a to-do", icon: "plus", href: "/todos?new=1", group: "Actions" },
  { id: "a-ask", label: "Ask your notes", icon: "sparkles", href: "/ask", group: "Actions", kbd: "A" },
  { id: "a-idea", label: "Jot down an idea", icon: "bulb", href: "/ideas?new=1", group: "Actions" },
  { id: "g-home", label: "Home", icon: "home", href: "/", group: "Go to", kbd: "H" },
  { id: "g-notes", label: "All notes", icon: "notes", href: "/notes", group: "Go to", kbd: "O" },
  { id: "g-ideas", label: "Ideas", icon: "bulb", href: "/ideas", group: "Go to", kbd: "I" },
  { id: "g-meet", label: "Meetings", icon: "calendar", href: "/meetings", group: "Go to", kbd: "M" },
  { id: "g-todo", label: "To-dos", icon: "todo", href: "/todos", group: "Go to", kbd: "T" },
  { id: "g-dash", label: "To-do dashboard", icon: "chart", href: "/todos?view=dashboard", group: "Go to" },
  { id: "g-set", label: "Settings", icon: "settings", href: "/settings", group: "Go to" },
];

const SHORTCUTS: Record<string, string> = { n: "/notes/new", d: "/dictate", w: "/notes/write", t: "/todos", m: "/meetings", a: "/ask", h: "/", o: "/notes", i: "/ideas" };

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function CommandPalette() {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const signedIn = status === "authenticated";

  const show = useCallback(() => {
    setQ("");
    setActive(0);
    setOpen(true);
    cache.getIndex().then((i) => {
      if (!i) return;
      setNotes(i.notes);
      setProjects((i.projects ?? []).filter((p) => !p.unavailable));
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
        return;
      }
      if (open || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        show();
      } else if (SHORTCUTS[e.key]) {
        e.preventDefault();
        router.push(SHORTCUTS[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, [signedIn, open, show, router]);

  // Load the notes list ahead of time so the palette opens with it.
  useEffect(() => {
    if (!signedIn) return;
    cache.getIndex().then((i) => {
      if (!i) return;
      setNotes(i.notes);
      setProjects((i.projects ?? []).filter((p) => !p.unavailable));
    });
  }, [signedIn]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const match = (t: string) => !s || t.toLowerCase().includes(s);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const noteItems: Item[] = [...notes]
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.createdAt.localeCompare(a.createdAt))
      .filter((n) => match(n.title) || (n.tags ?? []).some((t) => match(t)) || (n.attendees ?? []).some((a) => match(a)))
      .slice(0, s ? 8 : 5)
      .map((n) => ({
        id: "n-" + n.id,
        label: n.title,
        hint: [n.projectId ? projectById.get(n.projectId)?.name : null, new Date(n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })]
          .filter(Boolean)
          .join(" · "),
        icon: n.pinned ? "pin" : "notes",
        href: `/notes/${n.id}`,
        group: s ? "Notes" : "Recent notes",
      }));
    const projectItems: Item[] = projects
      .filter((p) => match(p.name))
      .slice(0, 6)
      .map((p) => ({ id: "p-" + p.id, label: p.name, hint: "Project", icon: "folder", href: `/notes?p=${p.id}`, color: p.color, group: "Projects" }));
    const actionItems = ACTIONS.filter((a) => match(a.label));
    const out = s ? [...noteItems, ...projectItems, ...actionItems] : [...actionItems.slice(0, 4), ...noteItems, ...projectItems, ...actionItems.slice(4)];
    if (s)
      out.push({ id: "search", label: `Search inside every note for “${q.trim()}”`, icon: "search", href: `/notes?q=${encodeURIComponent(q.trim())}`, group: "Full-text search" });
    return out;
  }, [q, notes, projects]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const go = (it: Item) => {
    setOpen(false);
    router.push(it.href);
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-3 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Search and jump"
        className="animate-pop w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && items[active]) {
                e.preventDefault();
                go(items[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search notes, projects, or type a command…"
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
            aria-label="Search"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>
        <ul ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing found.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id}>
                {header && <div className="px-3 pb-1 pt-2.5 text-xs font-medium text-muted">{header}</div>}
                <button
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(it)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? "bg-subtle" : ""}`}
                >
                  {it.color ? (
                    <span className="flex w-[18px] justify-center">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
                    </span>
                  ) : (
                    <Icon name={it.icon} size={18} className="text-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 text-xs text-muted">{it.hint}</span>}
                  {it.kbd && <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[11px] text-muted sm:block">{it.kbd}</kbd>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted sm:flex">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span className="ml-auto">Shortcuts: N record · D dictate · T to-dos · M meetings</span>
        </div>
      </div>
    </div>
  );
}
