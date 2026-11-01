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
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { Mascot } from "./Mascot";
import { ShareProject } from "./ShareProject";
import { loadIndex, searchDrive, type NoteIndex, type NoteMeta, type Project } from "@/lib/drive";
import { cache, type PendingNote } from "@/lib/local";
import {
  createProject,
  deleteProject,
  leaveProject,
  moveNotes,
  patchNote,
  PROJECT_COLORS,
  syncPending,
  updateProject,
} from "@/lib/notes";
import { formatDuration } from "@/lib/recorder";
import { hasCalendar, listEvents, rememberEvent, type CalendarEvent } from "@/lib/calendar";
import { getTemplate } from "@/lib/templates";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

const NONE = "none";

export function NotesHome() {
  const { token, user, scope } = useAccessToken();
  const [nextMeeting, setNextMeeting] = useState<CalendarEvent | null>(null);
  const { settings } = useSettings(token);
  const router = useRouter();
  const params = useSearchParams();
  const projectFilter = params.get("p"); // a project id, "none", or null for all notes

  const [index, setIndex] = useState<NoteIndex | null>(null);
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [driveHits, setDriveHits] = useState<Set<string> | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<NoteMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      if ((await cache.listPending()).length) await syncPending(token, settings.saveAudio);
      const { index } = await loadIndex(token);
      setIndex(index);
      await cache.setIndex(index);
      setError(null);
    } catch {
      setError("Couldn't reach Google Drive. Showing what's saved on this device.");
    }
    setPending(await cache.listPending());
  }, [token, settings.saveAudio]);

  useEffect(() => {
    // Show the cached list instantly, then refresh from Drive.
    cache.getIndex().then((i) => i && setIndex((n) => n ?? i));
    cache.listPending().then(setPending);
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [refresh]);

  // The next meeting on the user's calendar, if they connected it.
  useEffect(() => {
    if (!token || !hasCalendar(scope)) return;
    const now = Date.now();
    listEvents(token, new Date(now - 15 * 60e3), new Date(now + 3 * 3600e3))
      .then((list) => setNextMeeting(list.find((e) => !e.allDay && new Date(e.end).getTime() > now) ?? null))
      .catch(() => {});
  }, [token, scope]);

  // Search inside notes, transcripts and AI notes with Drive's full-text search.
  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 2) {
      setDriveHits(null);
      return;
    }
    const t = setTimeout(() => {
      searchDrive(token, q)
        .then(setDriveHits)
        .catch(() => setDriveHits(null));
    }, 400);
    return () => clearTimeout(t);
  }, [query, token]);

  const projects = useMemo(() => index?.projects ?? [], [index]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const currentProject = projectFilter && projectFilter !== NONE ? projectById.get(projectFilter) : undefined;

  const allTags = useMemo(
    () => [...new Set((index?.notes ?? []).flatMap((n) => n.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [index],
  );

  const visible = useMemo(() => {
    let notes = index?.notes ?? [];
    if (projectFilter === NONE) notes = notes.filter((n) => !n.projectId);
    else if (projectFilter) notes = notes.filter((n) => n.projectId === projectFilter);
    if (tagFilter) notes = notes.filter((n) => n.tags?.includes(tagFilter));
    const q = query.trim().toLowerCase();
    if (q) {
      notes = notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q)) ||
          (n.projectId && projectById.get(n.projectId)?.name.toLowerCase().includes(q)) ||
          n.actions?.some((a) => a.text.toLowerCase().includes(q)) ||
          driveHits?.has(n.folderId),
      );
    }
    return notes;
  }, [index, projectFilter, tagFilter, query, driveHits, projectById]);

  const pinned = visible.filter((n) => n.pinned);
  const rest = visible.filter((n) => !n.pinned);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of index?.notes ?? []) c.set(n.projectId ?? NONE, (c.get(n.projectId ?? NONE) ?? 0) + 1);
    return c;
  }, [index]);

  const act = async (label: string, fn: () => Promise<NoteIndex | void>) => {
    if (!token) return;
    setBusy(label);
    try {
      const next = await fn();
      if (next) setIndex(next);
    } catch {
      setError("That didn't work. Check your connection and try again.");
    }
    setBusy(null);
  };

  const move = (ids: string[], projectId: string | null) => {
    if (!token || !ids.length) return;
    const name = projectId ? projectById.get(projectId)?.name : "No project";
    // Update the list right away, then save to Drive.
    setIndex((i) =>
      i ? { ...i, notes: i.notes.map((n) => (ids.includes(n.id) ? { ...n, projectId: projectId ?? undefined } : n)) } : i,
    );
    setSelected(new Set());
    setSelecting(false);
    return act(`Moving to ${name}`, () => moveNotes(token, ids, projectId));
  };

  const togglePin = (note: NoteMeta) => {
    if (!token) return;
    setIndex((i) => (i ? { ...i, notes: i.notes.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) } : i));
    act(note.pinned ? "Unpinning" : "Pinning", async () => (await patchNote(token, note.id, { pinned: !note.pinned })).index);
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // On phones, press and hold a note to pick it up.
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const justDragged = useRef(false);

  const onDragStart = (e: DragStartEvent) => {
    setDragging(index?.notes.find((n) => n.id === e.active.id) ?? null);
    navigator.vibrate?.(15);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 50);
    const over = e.over?.id ? String(e.over.id) : null;
    if (!over?.startsWith("project:")) return;
    const id = String(e.active.id);
    const ids = selected.has(id) ? [...selected] : [id];
    const target = over.slice("project:".length);
    move(ids, target === NONE ? null : target);
  };

  const setProjectFilter = (p: string | null) => {
    setEditingProject(false);
    router.replace(p ? `/?p=${p}` : "/", { scroll: false });
  };

  const firstName = user?.name?.split(" ")[0];
  const heading = currentProject?.name ?? (projectFilter === NONE ? "No project" : firstName ? `Hi ${firstName}` : "Your notes");
  const newHref = currentProject ? `/notes/new?p=${currentProject.id}` : "/notes/new";

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <AppHeader wide />
      <div className="mx-auto max-w-5xl px-4 pb-36 pt-4 md:flex md:gap-6">
        {/* Projects: a sidebar on large screens, a scrolling row on phones. Notes can be dropped on them. */}
        <nav aria-label="Projects" className="md:w-56 md:shrink-0">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:sticky md:top-20 md:mx-0 md:flex-col md:overflow-visible md:px-0">
            <ProjectChip label="All notes" count={index?.notes.length} active={!projectFilter} onClick={() => setProjectFilter(null)} />
            {projects.map((p) => (
              <ProjectChip
                key={p.id}
                dropId={`project:${p.id}`}
                label={`${p.name}${p.shared ? " 👥" : ""}${p.unavailable ? " (no access)" : ""}`}
                color={p.color}
                count={counts.get(p.id) ?? 0}
                active={projectFilter === p.id}
                onClick={() => setProjectFilter(p.id)}
              />
            ))}
            {projects.length > 0 && (
              <ProjectChip
                dropId={`project:${NONE}`}
                label="No project"
                count={counts.get(NONE) ?? 0}
                active={projectFilter === NONE}
                onClick={() => setProjectFilter(NONE)}
              />
            )}
            {creating ? (
              <ProjectForm
                onCancel={() => setCreating(false)}
                onSave={(name, color) => {
                  setCreating(false);
                  act("Creating project", async () => {
                    const r = await createProject(token!, name, color, user?.email ?? undefined);
                    setProjectFilter(r.project.id);
                    return r.index;
                  });
                }}
              />
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-border px-4 py-2 text-sm text-muted hover:border-accent md:rounded-xl md:text-left"
              >
                + New project
              </button>
            )}
            <Link
              href="/join"
              className="flex shrink-0 items-center whitespace-nowrap rounded-full px-4 py-2 text-sm text-muted hover:bg-accent-soft md:rounded-xl"
            >
              Join shared project
            </Link>
          </div>
          {dragging && (
            <p className="mt-1 text-xs text-muted md:mt-3">Drop on a project to move {selected.has(dragging.id) && selected.size > 1 ? `${selected.size} notes` : "it"}.</p>
          )}
        </nav>

        <main className="min-w-0 flex-1">
          <div className="mt-3 flex items-center gap-2 md:mt-0">
            {currentProject && (
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: currentProject.color }} aria-hidden />
            )}
            <h1 className="truncate text-2xl font-bold">{heading}</h1>
            {currentProject && (
              <button
                onClick={() => setEditingProject((v) => !v)}
                className="rounded-full px-2 py-1 text-sm text-muted hover:bg-accent-soft"
                aria-label="Share and edit project"
              >
                {currentProject.role === "member" ? "👥 Team" : "👥 Share"}
              </button>
            )}
          </div>

          {currentProject && editingProject && (
            <div className="mt-3 rounded-2xl border border-border bg-card p-3">
              <ProjectForm
                initial={currentProject}
                onCancel={() => setEditingProject(false)}
                onSave={(name, color) => {
                  setEditingProject(false);
                  act("Saving project", () => updateProject(token!, currentProject, { name, color }));
                }}
              />
              {token && <ShareProject token={token} project={currentProject} me={user} onShared={refresh} />}
              {currentProject.role === "member" ? (
                <button
                  onClick={() => {
                    if (!confirm(`Leave "${currentProject.name}"? It stays in the owner's Drive; you just won't see it here.`)) return;
                    setProjectFilter(null);
                    act("Leaving project", () => leaveProject(token!, currentProject));
                  }}
                  className="mt-3 text-sm text-muted underline"
                >
                  Leave project
                </button>
              ) : (
                <button
                  onClick={() => {
                    const msg = currentProject.shared
                      ? `Delete "${currentProject.name}" for everyone? Its notes are kept and moved to "No project" in your Drive, and teammates lose access.`
                      : `Delete the project "${currentProject.name}"? Its notes are kept and moved to "No project".`;
                    if (!confirm(msg)) return;
                    setProjectFilter(null);
                    act("Deleting project", () => deleteProject(token!, currentProject));
                  }}
                  className="mt-3 text-sm text-muted underline"
                >
                  Delete project
                </button>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes, transcripts, action items"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-2.5 outline-none focus:border-accent"
            />
            <button
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
              className={`shrink-0 rounded-xl border px-3 text-sm ${selecting ? "border-accent bg-accent-soft" : "border-border bg-card"}`}
            >
              {selecting ? "Done" : "Select"}
            </button>
          </div>

          {allTags.length > 0 && (
            <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter((c) => (c === t ? null : t))}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs ${tagFilter === t ? "bg-accent text-white" : "bg-accent-soft"}`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {nextMeeting && !index?.notes.some((n) => n.calendarEventId === nextMeeting.id) && (
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent bg-accent-soft px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted">
                  {new Date(nextMeeting.start).getTime() <= Date.now() ? "Happening now" : "Up next"} ·{" "}
                  {new Date(nextMeeting.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="truncate font-medium">{nextMeeting.title}</div>
              </div>
              <Link
                href={`/notes/new?event=${encodeURIComponent(nextMeeting.id)}`}
                onClick={() => rememberEvent(nextMeeting)}
                className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white"
              >
                ● Record
              </Link>
            </div>
          )}

          {error && <p className="mt-3 rounded-xl bg-accent-soft px-4 py-3 text-sm">{error}</p>}
          {busy && <p className="mt-3 text-sm text-muted">{busy}…</p>}

          {pending.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-muted">Waiting to upload</h2>
              <ul className="mt-2 space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-2xl border border-dashed border-border bg-card px-4 py-3">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-muted">Saved on this device. Uploads to Drive when you&apos;re online.</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-5">
            {index === null ? (
              <p className="text-muted">Loading your notes…</p>
            ) : index.notes.length === 0 && pending.length === 0 ? (
              <div className="mt-16 flex flex-col items-center gap-3 text-center">
                <Mascot size={110} mood="sleepy" />
                <p className="font-medium">No notes yet</p>
                <p className="max-w-xs text-sm text-muted">Tap the button below and I&apos;ll start listening.</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="mt-12 flex flex-col items-center gap-3 text-center">
                <Mascot size={90} mood="sleepy" />
                <p className="text-sm text-muted">
                  {query ? `Nothing matches "${query}".` : currentProject ? "No notes in this project yet. Drag some here, or record one." : "No notes here."}
                </p>
              </div>
            ) : (
              <>
                {pinned.length > 0 && (
                  <>
                    <h2 className="mb-2 text-sm font-medium text-muted">Pinned</h2>
                    <NoteList notes={pinned} />
                    {rest.length > 0 && <h2 className="mb-2 mt-5 text-sm font-medium text-muted">Notes</h2>}
                  </>
                )}
                <NoteList notes={rest} />
              </>
            )}
          </section>
        </main>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rotate-2 rounded-2xl border border-accent bg-card px-4 py-3 shadow-xl">
            <div className="font-medium">{dragging.title}</div>
            {selected.has(dragging.id) && selected.size > 1 && (
              <div className="text-xs text-muted">and {selected.size - 1} more</div>
            )}
          </div>
        )}
      </DragOverlay>

      <div className="safe-bottom fixed inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background to-transparent pt-8">
        {selecting ? (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-lg">
            <span className="px-2 text-sm">{selected.size} selected</span>
            <select
              aria-label="Move to project"
              disabled={!selected.size}
              value=""
              onChange={(e) => move([...selected], e.target.value === NONE ? null : e.target.value)}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <option value="" disabled>
                Move to…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={NONE}>No project</option>
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link
              href="/dictate"
              className="rounded-full border border-border bg-card px-5 py-4 text-lg font-semibold shadow-lg active:scale-[0.97]"
            >
              Dictate
            </Link>
            <Link
              href={newHref}
              className="flex items-center gap-2 whitespace-nowrap rounded-full bg-accent px-7 py-4 text-lg font-semibold text-white shadow-lg active:scale-[0.97]"
            >
              <span className="inline-block h-3 w-3 rounded-full bg-white" /> Record meeting
            </Link>
          </div>
        )}
      </div>
    </DndContext>
  );

  function NoteList({ notes }: { notes: NoteMeta[] }) {
    return (
      <ul className="space-y-2">
        {notes.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            project={n.projectId ? projectById.get(n.projectId) : undefined}
            showProject={!projectFilter}
            selecting={selecting}
            selected={selected.has(n.id)}
            onSelect={() =>
              setSelected((s) => {
                const next = new Set(s);
                if (next.has(n.id)) next.delete(n.id);
                else next.add(n.id);
                return next;
              })
            }
            onPin={() => togglePin(n)}
            blockClick={() => justDragged.current}
          />
        ))}
      </ul>
    );
  }
}

function ProjectChip({
  label,
  color,
  count,
  active,
  onClick,
  dropId,
}: {
  label: string;
  color?: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  dropId?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `static:${label}`, disabled: !dropId });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-sm transition md:rounded-xl ${
        isOver ? "scale-105 border-accent bg-accent-soft" : active ? "border-accent bg-accent-soft font-medium" : "border-border bg-card"
      }`}
    >
      {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />}
      <span className="truncate md:flex-1 md:text-left">{label}</span>
      {count !== undefined && <span className="text-xs text-muted">{count}</span>}
    </button>
  );
}

function ProjectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Project;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim(), color);
      }}
      className="flex shrink-0 flex-col gap-2 rounded-xl border border-accent bg-card p-2"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="w-48 rounded-lg bg-background px-3 py-1.5 text-sm outline-none md:w-full"
      />
      <div className="flex gap-1.5">
        {PROJECT_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            className={`h-5 w-5 rounded-full ${color === c ? "ring-2 ring-foreground ring-offset-1" : ""}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-white">
          {initial ? "Save" : "Create"}
        </button>
        <button type="button" onClick={onCancel} className="px-2 text-sm text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

function NoteCard({
  note,
  project,
  showProject,
  selecting,
  selected,
  onSelect,
  onPin,
  blockClick,
}: {
  note: NoteMeta;
  project?: Project;
  showProject: boolean;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onPin: () => void;
  blockClick: () => boolean;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: note.id });
  const open = note.actions?.filter((a) => !a.done).length ?? 0;
  const template = note.template && note.template !== "general" ? getTemplate(note.template) : null;

  const body = (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-medium">{note.title}</div>
        {!selecting && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPin();
            }}
            aria-label={note.pinned ? "Unpin" : "Pin"}
            className={`-mr-1 -mt-0.5 rounded-full px-1.5 text-sm ${note.pinned ? "" : "opacity-30 hover:opacity-80"}`}
          >
            📌
          </button>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        <span>
          {new Date(note.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
        </span>
        <span>· {formatDuration(note.durationSec * 1000)}</span>
        <span>· {note.language === "hi-IN" ? "हिंदी" : "English"}</span>
        {template && (
          <span>
            · {template.emoji} {template.name}
          </span>
        )}
        {open > 0 && <span>· ☐ {open} to do</span>}
      </div>
      {(showProject && project) || note.tags?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {showProject && project && (
            <span className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-[11px]">
              <span className="h-2 w-2 rounded-full" style={{ background: project.color }} aria-hidden />
              {project.name}
            </span>
          )}
          {note.tags?.map((t) => (
            <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px]">
              #{t}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );

  const cls = `block rounded-2xl border bg-card px-4 py-3 transition ${
    selected ? "border-accent bg-accent-soft" : "border-border hover:border-accent"
  } ${isDragging ? "opacity-40" : ""}`;

  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className="touch-manipulation select-none">
      {selecting ? (
        <button onClick={onSelect} className={`${cls} flex w-full items-start gap-3 text-left`}>
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${selected ? "border-accent bg-accent text-white" : "border-border"}`}
          >
            {selected ? "✓" : ""}
          </span>
          <span className="min-w-0 flex-1">{body}</span>
        </button>
      ) : (
        <Link
          href={`/notes/${note.id}`}
          onClick={(e) => blockClick() && e.preventDefault()}
          className={cls}
          draggable={false}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
