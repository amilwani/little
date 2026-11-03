"use client";

import { localDay } from "@/lib/dates";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { pendingCount } from "@/lib/slack";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { TodoDashboard } from "@/components/TodoDashboard";
import type { NoteIndex, Project } from "@/lib/drive";
import { loadIndex } from "@/lib/drive";
import { cache } from "@/lib/local";
import { isMine, loadTodos, newTodo, STATUSES, updateTodos, type Todo, type TodoStatus } from "@/lib/todos";
import { useAccessToken } from "@/lib/useAccessToken";

const LOCAL = "little:todos";

export default function TodosPage() {
  return (
    <Suspense>
      <Todos />
    </Suspense>
  );
}

const PREFS = "little:todos-view";

function Todos() {
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { token, status, user } = useAccessToken();
  const [view, setView] = useState<"team" | "mine" | null>(null);
  const [showDashboard, setShowDashboard] = useState(params.get("view") === "dashboard");
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [index, setIndex] = useState<NoteIndex | null>(null);
  const [projectPick, setProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [dragging, setDragging] = useState<Todo | null>(null);
  const [draft, setDraft] = useState("");
  const justDragged = useRef(false);

  // Remember the last tab, view and project filter.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}");
      if (p.view) setView(p.view);
      if (p.project) setProject(p.project);
      if (p.dashboard && !params.get("view")) setShowDashboard(true);
    } catch {
      /* ignore */
    }
    const tabParam = params.get("tab");
    const pParam = params.get("p");
    if (pParam) {
      setView("team");
      setProject(pParam);
    } else if (tabParam === "mine" || tabParam === "team") setView(tabParam);
    if (params.get("new")) setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS, JSON.stringify({ view, project: projectPick, dashboard: showDashboard }));
    } catch {
      /* ignore */
    }
  }, [view, projectPick, showDashboard]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL);
      if (saved) setTodos((t) => t ?? JSON.parse(saved));
    } catch {
      /* ignore */
    }
    cache.getIndex().then((i) => i && setIndex((x) => x ?? i));
  }, []);

  const show = (list: Todo[]) => {
    setTodos(list);
    try {
      localStorage.setItem(LOCAL, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!token) return;
    loadTodos(token)
      .then((d) => show(d.todos))
      .catch(() => setError("Couldn't reach Google Drive. Showing what's saved on this device."));
    loadIndex(token)
      .then(({ index }) => setIndex(index))
      .catch(() => {});
  }, [token]);

  /** Updates the board right away, then saves the same change to Drive. */
  const change = useCallback(
    (fn: (list: Todo[]) => Todo[]) => {
      setTodos((current) => {
        const next = fn(current ?? []);
        try {
          localStorage.setItem(LOCAL, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      if (!token) return;
      updateTodos(token, fn)
        .then(show)
        .catch(() => setError("Couldn't save to Google Drive. Try again in a moment."));
    },
    [token],
  );

  const projects = useMemo(() => index?.projects ?? [], [index]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const noteTitles = useMemo(() => new Map((index?.notes ?? []).map((n) => [n.id, n.title])), [index]);

  const activeProjects = projects.filter((p) => !p.unavailable);
  // A remembered project filter can point at a project that was removed or unshared.
  const project = projectPick && activeProjects.some((p) => p.id === projectPick) ? projectPick : null;
  // Team tasks first when there are projects; otherwise your own list.
  const tab = view ?? (activeProjects.length ? "team" : "mine");
  const visible = (todos ?? []).filter((t) =>
    tab === "team" ? !!t.projectId && (!project || t.projectId === project) : !t.projectId || isMine(t, user),
  );
  const addTarget = tab === "team" ? (project ?? activeProjects[0]?.id) : undefined;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 50);
    const to = e.over?.id as TodoStatus | undefined;
    const id = String(e.active.id);
    if (!to) return;
    const now = new Date().toISOString();
    change((list) => list.map((t) => (t.id === id && t.status !== to ? { ...t, status: to, updatedAt: now } : t)));
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    if (tab === "team" && !addTarget) return;
    const todo = newTodo(title, { projectId: addTarget, createdBy: user?.email ?? undefined });
    change((list) => [todo, ...list.filter((t) => t.id !== todo.id)]);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => {
        setDragging(todos?.find((t) => t.id === e.active.id) ?? null);
        navigator.vibrate?.(15);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <AppHeader />
      <main className="pb-nav mx-auto max-w-6xl px-4 pt-5 md:pt-8">
        <h1 className="mb-4 font-display text-[36px] font-normal leading-[1.05] tracking-[-0.01em]">To-dos</h1>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg bg-subtle p-0.5" role="tablist" aria-label="Whose tasks">
            {(
              [
                ["team", "Team tasks", "users"],
                ["mine", "My tasks", "user"],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === id ? "bg-card shadow-sm" : "text-muted hover:text-foreground"}`}
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/inbox"
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 transition hover:bg-subtle"
            >
              <Icon name="inbox" size={15} />
              <span className="hidden sm:inline">Slack inbox</span>
              <SlackCount />
            </Link>
            <div className="flex rounded-lg bg-subtle p-0.5" role="tablist" aria-label="View">
              {(
                [
                  [false, "Board", "board"],
                  [true, "Dashboard", "chart"],
                ] as const
              ).map(([dash, label, icon]) => (
                <button
                  key={label}
                  role="tab"
                  aria-selected={showDashboard === dash}
                  onClick={() => setShowDashboard(dash)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${showDashboard === dash ? "bg-card shadow-sm" : "text-muted hover:text-foreground"}`}
                >
                  <Icon name={icon} size={15} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          {tab === "team"
            ? "Tasks in your projects. Everyone a project is shared with sees them."
            : "Your private to-dos, plus team tasks assigned to you. Private ones are only visible to you."}
        </p>

        {tab === "team" && activeProjects.length > 0 && (
          <div className="no-scrollbar -mx-4 mt-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
            <Chip active={!project} onClick={() => setProject(null)} label="All projects" />
            {activeProjects.map((p) => (
              <Chip
                key={p.id}
                active={project === p.id}
                onClick={() => setProject(p.id)}
                label={p.name}
                color={p.color}
              />
            ))}
          </div>
        )}

        {!showDashboard && (
          <form
            onSubmit={add}
            className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-card pl-3.5 pr-1.5 focus-within:border-foreground/30"
          >
            <Icon name="plus" size={17} className="text-muted" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                tab === "team"
                  ? addTarget
                    ? `Add a task to ${projectById.get(addTarget)?.name}`
                    : "Create a project first to add team tasks"
                  : "Add a private to-do"
              }
              disabled={tab === "team" && !addTarget}
              className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              className="h-8 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background transition disabled:opacity-0"
              disabled={!draft.trim()}
            >
              Add
            </button>
          </form>
        )}

        {error && <p className="mt-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}

        {todos === null ? (
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-2xl bg-subtle" />
            ))}
          </div>
        ) : tab === "team" && !activeProjects.length ? (
          <div className="mt-14 flex flex-col items-center gap-3 text-center">
            <Mascot size={100} mood="sleepy" />
            <p className="font-display text-[24px] leading-tight">No team projects yet</p>
            <p className="max-w-xs text-sm text-muted">
              Create a project and share it with your team. Its tasks show up here for everyone.
            </p>
            <Link
              href="/notes#new-project"
              className="mt-1 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              New project
            </Link>
          </div>
        ) : visible.length === 0 && todos.length === 0 ? (
          <div className="mt-14 flex flex-col items-center gap-3 text-center">
            <Mascot size={100} mood="sleepy" />
            <p className="font-display text-[24px] leading-tight">Nothing to do yet</p>
            <p className="max-w-xs text-sm text-muted">
              Add one above, or press “To-do” next to an action item in a meeting’s AI notes.
            </p>
          </div>
        ) : showDashboard ? (
          <TodoDashboard todos={visible} projects={activeProjects} showProjects={tab === "team" && !project} />
        ) : (
          <div className="no-scrollbar -mx-4 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
            {STATUSES.map((s) => (
              <Column key={s.id} status={s}>
                {visible
                  .filter((t) => t.status === s.id)
                  .map((t) => (
                    <Card
                      key={t.id}
                      todo={t}
                      project={t.projectId ? projectById.get(t.projectId) : undefined}
                      noteTitle={t.noteId ? noteTitles.get(t.noteId) : undefined}
                      onOpen={() => !justDragged.current && setEditing(t)}
                    />
                  ))}
              </Column>
            ))}
          </div>
        )}
        {!showDashboard && visible.length > 0 && (
          <>
            <p className="mt-1 hidden text-xs text-muted md:block">
              Drag cards between columns. Click a card to edit it.
            </p>
            <p className="mt-1 text-xs text-muted md:hidden">
              Press and hold a card to drag it. Swipe sideways for more columns.
            </p>
          </>
        )}
      </main>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rotate-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm shadow-2xl">
            {dragging.title}
          </div>
        )}
      </DragOverlay>

      {editing && (
        <EditSheet
          todo={editing}
          projects={activeProjects}
          noteTitle={editing.noteId ? noteTitles.get(editing.noteId) : undefined}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            setEditing(null);
            change((list) => list.map((x) => (x.id === t.id ? { ...t, updatedAt: new Date().toISOString() } : x)));
          }}
          onDelete={() => {
            setEditing(null);
            change((list) => list.filter((x) => x.id !== editing.id));
          }}
        />
      )}
    </DndContext>
  );
}

function Chip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition ${
        active ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground/30"
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />}
      {label}
    </button>
  );
}

function Column({ status, children }: { status: (typeof STATUSES)[number]; children: React.ReactNode[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-48 w-[80vw] shrink-0 snap-start flex-col gap-2 rounded-2xl p-2 transition md:w-auto ${
        isOver ? "bg-accent-soft ring-2 ring-accent/60" : "bg-subtle/70"
      }`}
    >
      <h2 className="flex items-center gap-2 px-2 pb-1 pt-1.5 text-[13px] font-medium">
        <span className="h-2 w-2 rounded-full" style={{ background: status.color }} aria-hidden />
        {status.name}
        <span className="ml-auto text-xs tabular-nums text-muted">{children.length}</span>
      </h2>
      {children}
      {children.length === 0 && (
        <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-2 py-6 text-center text-xs text-muted">
          Drop here
        </p>
      )}
    </section>
  );
}

function Card({
  todo,
  project,
  noteTitle,
  onOpen,
}: {
  todo: Todo;
  project?: Project;
  noteTitle?: string;
  onOpen: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: todo.id });
  const overdue = todo.due && todo.status !== "done" && todo.due < localDay();
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={`touch-manipulation select-none rounded-xl border border-border/80 bg-card px-3 py-2.5 text-left text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-foreground/20 hover:shadow-sm ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className={`leading-snug ${todo.status === "done" ? "text-muted line-through" : ""}`}>{todo.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
        {todo.urgent && (
          <span className="flex items-center gap-1 font-medium text-accent">
            <Icon name="flag" size={11} /> Urgent
          </span>
        )}
        {todo.owner && (
          <span className="flex items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-subtle text-[9px] font-semibold text-foreground">
              {todo.owner.slice(0, 1).toUpperCase()}
            </span>
            {todo.owner}
          </span>
        )}
        {todo.due && (
          <span className={`flex items-center gap-1 ${overdue ? "font-medium text-accent" : ""}`}>
            <Icon name="clock" size={11} />
            {new Date(`${todo.due}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        )}
        {project && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} aria-hidden />
            {project.name}
          </span>
        )}
        {noteTitle && (
          <span className="flex min-w-0 items-center gap-1">
            <Icon name="mic" size={11} />
            <span className="truncate">{noteTitle}</span>
          </span>
        )}
      </div>
    </button>
  );
}

function EditSheet({
  todo,
  projects,
  noteTitle,
  onClose,
  onSave,
  onDelete,
}: {
  todo: Todo;
  projects: Project[];
  noteTitle?: string;
  onClose: () => void;
  onSave: (t: Todo) => void;
  onDelete: () => void;
}) {
  const [t, setT] = useState(todo);
  const field =
    "w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-foreground/30";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 backdrop-blur-[2px] md:items-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (t.title.trim()) onSave({ ...t, title: t.title.trim() });
        }}
        className="safe-bottom animate-pop w-full max-w-md space-y-4 rounded-t-2xl border border-border bg-card p-5 shadow-2xl md:rounded-2xl"
      >
        <textarea
          value={t.title}
          onChange={(e) => setT({ ...t, title: e.target.value })}
          rows={2}
          aria-label="Task"
          className="w-full resize-none bg-transparent text-lg font-medium leading-snug outline-none"
        />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-muted">Status</span>
            <select
              value={t.status}
              onChange={(e) => setT({ ...t, status: e.target.value as TodoStatus })}
              className={field}
            >
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted">Due</span>
            <input
              type="date"
              value={t.due ?? ""}
              onChange={(e) => setT({ ...t, due: e.target.value || undefined })}
              className={field}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Owner</span>
            <input
              value={t.owner ?? ""}
              onChange={(e) => setT({ ...t, owner: e.target.value || undefined })}
              placeholder="Who"
              className={field}
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Project</span>
            <select
              value={t.projectId ?? ""}
              onChange={(e) => setT({ ...t, projectId: e.target.value || undefined })}
              className={field}
            >
              <option value="">Private (only me)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!t.urgent} onChange={(e) => setT({ ...t, urgent: e.target.checked })} />{" "}
          Urgent
        </label>
        {t.noteId && (
          <Link
            href={`/notes/${t.noteId}`}
            className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm hover:bg-border/60"
          >
            <Icon name="mic" size={15} className="text-muted" />
            <span className="min-w-0 flex-1 truncate">From: {noteTitle ?? "open note"}</span>
            <Icon name="chevronRight" size={15} className="text-muted" />
          </Link>
        )}
        {t.link && (
          <a
            href={t.link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2 text-sm hover:bg-border/60"
          >
            <Icon name="inbox" size={15} className="text-muted" />
            <span className="min-w-0 flex-1 truncate">From Slack: open the message</span>
            <Icon name="external" size={15} className="text-muted" />
          </a>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
            Save
          </button>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => confirm("Delete this to-do?") && onDelete()}
            className="ml-auto flex items-center gap-1.5 text-sm text-muted hover:text-accent"
          >
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      </form>
    </div>
  );
}

function SlackCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const update = () => setN(pendingCount());
    update();
    window.addEventListener("little:inbox", update);
    return () => window.removeEventListener("little:inbox", update);
  }, []);
  return n ? (
    <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-white">{n}</span>
  ) : null;
}
