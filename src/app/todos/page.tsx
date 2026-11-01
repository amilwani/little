"use client";

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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Mascot } from "@/components/Mascot";
import type { NoteIndex, Project } from "@/lib/drive";
import { loadIndex } from "@/lib/drive";
import { cache } from "@/lib/local";
import { loadTodos, newTodo, STATUSES, updateTodos, type Todo, type TodoStatus } from "@/lib/todos";
import { useAccessToken } from "@/lib/useAccessToken";

const LOCAL = "little:todos";

export default function TodosPage() {
  const router = useRouter();
  const { token, status } = useAccessToken();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [index, setIndex] = useState<NoteIndex | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [dragging, setDragging] = useState<Todo | null>(null);
  const [draft, setDraft] = useState("");
  const justDragged = useRef(false);

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

  const visible = (todos ?? []).filter((t) => !project || t.projectId === project);

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
    const todo = newTodo(title, { projectId: project ?? undefined });
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
      <AppHeader back="/" title="To-dos" wide />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-4">
        <form onSubmit={add} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a to-do"
            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-2.5 outline-none focus:border-accent"
          />
          <button type="submit" className="rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-50" disabled={!draft.trim()}>
            Add
          </button>
        </form>

        {projects.length > 0 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            <Chip active={!project} onClick={() => setProject(null)} label="All projects" />
            {projects.map((p) => (
              <Chip key={p.id} active={project === p.id} onClick={() => setProject(p.id)} label={p.name} color={p.color} />
            ))}
          </div>
        )}

        {error && <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">{error}</p>}

        {todos === null ? (
          <p className="mt-6 text-muted">Loading your to-dos…</p>
        ) : todos.length === 0 ? (
          <div className="mt-14 flex flex-col items-center gap-3 text-center">
            <Mascot size={100} mood="sleepy" />
            <p className="font-medium">Nothing to do yet</p>
            <p className="max-w-xs text-sm text-muted">
              Add one above. Or tap “Add to to-dos” next to an action item in a meeting’s AI notes.
            </p>
          </div>
        ) : (
          <div className="-mx-4 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
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
        <p className="mt-2 hidden text-xs text-muted md:block">Drag cards between columns. Click a card to edit it.</p>
        <p className="mt-2 text-xs text-muted md:hidden">Press and hold a card to drag it. Swipe sideways for more columns.</p>
      </main>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rotate-2 rounded-xl border border-accent bg-card px-3 py-2.5 text-sm shadow-xl">{dragging.title}</div>
        )}
      </DragOverlay>

      {editing && (
        <EditSheet
          todo={editing}
          projects={projects}
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

function Chip({ label, color, active, onClick }: { label: string; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
        active ? "border-accent bg-accent-soft font-medium" : "border-border bg-card"
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
      className={`flex w-[78vw] shrink-0 snap-start flex-col gap-2 rounded-2xl p-2 transition md:w-auto ${
        isOver ? "bg-accent-soft ring-2 ring-accent" : "bg-black/[0.03] dark:bg-white/[0.04]"
      }`}
    >
      <h2 className="flex items-center gap-2 px-1 pt-1 text-sm font-medium">
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: status.color }} aria-hidden />
          {status.name}
        </span>
        <span className="text-muted">{children.length}</span>
      </h2>
      {children}
      {children.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted">Drop here</p>}
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
  const overdue = todo.due && todo.status !== "done" && todo.due < new Date().toISOString().slice(0, 10);
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={`touch-manipulation select-none rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm shadow-sm transition hover:border-accent ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className={todo.status === "done" ? "text-muted line-through" : ""}>{todo.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {todo.urgent && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">Urgent</span>}
        {todo.owner && <span>👤 {todo.owner}</span>}
        {todo.due && <span className={overdue ? "text-accent" : ""}>📅 {new Date(`${todo.due}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
        {project && (
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: project.color }} aria-hidden />
            {project.name}
          </span>
        )}
        {noteTitle && <span className="truncate">🎙 {noteTitle}</span>}
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
  const field = "w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 md:items-center" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (t.title.trim()) onSave({ ...t, title: t.title.trim() });
        }}
        className="safe-bottom w-full max-w-md space-y-3 rounded-t-3xl bg-card p-5 shadow-xl md:rounded-3xl"
      >
        <textarea value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} rows={2} className={`${field} text-base font-medium`} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-muted">Status</span>
            <select value={t.status} onChange={(e) => setT({ ...t, status: e.target.value as TodoStatus })} className={field}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-muted">Due</span>
            <input type="date" value={t.due ?? ""} onChange={(e) => setT({ ...t, due: e.target.value || undefined })} className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Owner</span>
            <input value={t.owner ?? ""} onChange={(e) => setT({ ...t, owner: e.target.value || undefined })} placeholder="Who" className={field} />
          </label>
          <label className="space-y-1">
            <span className="text-muted">Project</span>
            <select value={t.projectId ?? ""} onChange={(e) => setT({ ...t, projectId: e.target.value || undefined })} className={field}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!t.urgent} onChange={(e) => setT({ ...t, urgent: e.target.checked })} /> Urgent
        </label>
        {t.noteId && (
          <Link href={`/notes/${t.noteId}`} className="block text-sm text-accent underline">
            From the meeting: {noteTitle ?? "open note"}
          </Link>
        )}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="rounded-full bg-accent px-5 py-2 font-semibold text-white">
            Save
          </button>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => confirm("Delete this to-do?") && onDelete()}
            className="ml-auto text-sm text-muted underline"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
