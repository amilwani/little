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
import { Icon } from "./Icon";
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
import { langInfo } from "@/lib/languages";
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

  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const qParam = params.get("q");
  useEffect(() => {
    if (qParam !== null) setQuery(qParam);
  }, [qParam]);
  const [driveHits, setDriveHits] = useState<Set<string> | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<NoteMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  // The new-project form lives in the sidebar chips on phones and above the list on laptops.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // "Start a team project" from Home opens the new-project form.
  useEffect(() => {
    const open = () => setCreating(true);
    if (window.location.hash === "#new-project") {
      open();
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    window.addEventListener("little:new-project", open);
    return () => window.removeEventListener("little:new-project", open);
  }, []);

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
    router.replace(p ? `/notes?p=${p}` : "/notes", { scroll: false });
  };

  const heading = currentProject?.name ?? (projectFilter === NONE ? "No project" : "Notes");
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const subtitle = currentProject
    ? `${counts.get(currentProject.id) ?? 0} notes${currentProject.shared ? " · Shared with your team" : ""}`
    : projectFilter === NONE
      ? "Notes that aren't in a project"
      : index
        ? `${index.notes.length} note${index.notes.length === 1 ? "" : "s"}`
        : today;
  const meetingNow = nextMeeting && new Date(nextMeeting.start).getTime() <= Date.now();

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <AppHeader />
      <div className="pb-nav mx-auto max-w-3xl px-4 pt-4 md:pt-10">
        {/* Projects: a sidebar on large screens, a scrolling row on phones. Notes can be dropped on them. */}
        <nav aria-label="Projects" className="md:hidden">
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:sticky md:top-24 md:mx-0 md:flex-col md:gap-0.5 md:overflow-visible md:px-0">
            <ProjectChip label="All notes" icon="notes" count={index?.notes.length} active={!projectFilter} onClick={() => setProjectFilter(null)} />
            <div className="hidden items-center justify-between px-2.5 pb-1 pt-5 md:flex">
              <span className="text-xs font-medium text-muted">Projects</span>
            </div>
            {projects.map((p) => (
              <ProjectChip
                key={p.id}
                dropId={`project:${p.id}`}
                label={`${p.name}${p.unavailable ? " (no access)" : ""}`}
                shared={p.shared}
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
                quiet
              />
            )}
            {creating && !desktop ? (
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
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-border px-3.5 py-1.5 text-sm text-muted hover:text-foreground md:rounded-lg md:border-0 md:px-2.5 md:py-1.5"
              >
                <Icon name="plus" size={14} /> New project
              </button>
            )}
            <Link
              href="/join"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-muted hover:text-foreground md:rounded-lg md:px-2.5"
            >
              <Icon name="link" size={14} /> Join shared project
            </Link>
          </div>
          {dragging && (
            <p className="mt-2 text-xs text-muted md:mt-3 md:px-2.5">
              Drop on a project to move {selected.has(dragging.id) && selected.size > 1 ? `${selected.size} notes` : "it"}.
            </p>
          )}
        </nav>

        <main className="min-w-0">
          {creating && desktop && (
            <div className="animate-pop mb-6 rounded-xl border border-border p-4">
              <p className="mb-3 text-sm font-medium">New project</p>
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
            </div>
          )}
          <div className="mt-5 flex items-start gap-3 md:mt-0">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2.5 text-[26px] font-semibold leading-tight tracking-tight">
                {currentProject && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: currentProject.color }} aria-hidden />}
                <span className="truncate">{heading}</span>
              </h1>
              <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
            </div>
            {currentProject && (
              <button
                onClick={() => setEditingProject((v) => !v)}
                className={`mt-1 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${
                  editingProject ? "border-foreground" : "border-border bg-card hover:border-foreground/30"
                }`}
                aria-label="Share and edit project"
                aria-expanded={editingProject}
              >
                <Icon name="users" size={15} />
                {currentProject.role === "member" ? "Team" : "Share"}
              </button>
            )}
          </div>

          {currentProject && editingProject && (
            <div className="animate-pop mt-4 rounded-2xl border border-border bg-card p-4">
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
                  className="mt-4 text-sm text-muted hover:text-foreground"
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
                  className="mt-4 text-sm text-muted hover:text-accent"
                >
                  Delete project
                </button>
              )}
            </div>
          )}

          {nextMeeting && !index?.notes.some((n) => n.calendarEventId === nextMeeting.id) && (
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meetingNow ? "bg-accent-soft text-accent" : "bg-subtle text-muted"}`}>
                <Icon name="calendar" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  {meetingNow && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                  {meetingNow ? "Happening now" : "Up next"} ·{" "}
                  {new Date(nextMeeting.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="truncate font-medium">{nextMeeting.title}</div>
              </div>
              <Link
                href={`/notes/new?event=${encodeURIComponent(nextMeeting.id)}`}
                onClick={() => rememberEvent(nextMeeting)}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background"
              >
                <span className="h-2 w-2 rounded-full bg-accent" /> Record
              </Link>
            </div>
          )}

          <div className={`mt-5 flex items-center gap-2 ${index && index.notes.length === 0 ? "hidden" : ""}`}>
            <label className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 focus-within:border-foreground/30">
              <Icon name="search" size={17} className="text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes and transcripts"
                className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
              />
            </label>
            <button
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
              className={`h-10 shrink-0 rounded-xl border px-3.5 text-sm ${selecting ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:border-foreground/30"}`}
            >
              {selecting ? "Done" : "Select"}
            </button>
          </div>

          {allTags.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter((c) => (c === t ? null : t))}
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
                    tagFilter === t ? "border-foreground bg-foreground text-background" : "border-border text-muted hover:text-foreground"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          {error && <p className="mt-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}
          {busy && <p className="mt-3 text-sm text-muted">{busy}…</p>}

          {pending.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-[13px] font-medium text-muted">Waiting to upload</h2>
              <ul className="-mx-2 flex flex-col">
                {pending.map((p) => (
                  <li key={p.id} className="px-2 py-2.5">
                    <div className="font-medium">{p.title}</div>
                    <div className="text-xs text-muted">Saved on this device. Uploads to Drive when you&apos;re online.</div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6">
            {index === null ? (
              <div className="space-y-2" aria-label="Loading your notes">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-2xl bg-subtle" />
                ))}
              </div>
            ) : index.notes.length === 0 && pending.length === 0 ? (
              <div className="mt-2">
                <div className="flex items-center gap-3">
                  <Mascot size={44} />
                  <div>
                    <p className="font-medium">Welcome to Little</p>
                    <p className="text-sm text-muted">Here&apos;s how to get started.</p>
                  </div>
                </div>
                <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                  {[
                    { href: "/notes/new", icon: "mic" as const, title: "Record a meeting", body: "Live transcript now, AI notes after", primary: true },
                    { href: "/notes/write", icon: "doc" as const, title: "Write a note", body: "Type notes yourself, no recording" },
                    { href: "/dictate", icon: "pen" as const, title: "Dictate", body: "Talk, then paste clean text anywhere" },
                    ...(hasCalendar(scope)
                      ? []
                      : [{ href: "/meetings", icon: "calendar" as const, title: "Connect your calendar", body: "See meetings and record in one tap" }]),
                    ...(Object.values(settings.apiKeys ?? {}).some(Boolean)
                      ? []
                      : [{ href: "/settings", icon: "sparkles" as const, title: "Turn on AI notes", body: "Add a free Gemini key in a minute" }]),
                    { href: "#new-project", icon: "users" as const, title: "Start a team project", body: "Share notes and to-dos with your team" },
                  ].map((a) => (
                    <li key={a.title}>
                      <Link
                        href={a.href}
                        onClick={(e) => {
                          if (a.href === "#new-project") {
                            e.preventDefault();
                            setCreating(true);
                          }
                        }}
                        className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition hover:border-foreground/30"
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${a.primary ? "bg-accent text-white" : "bg-subtle"}`}
                        >
                          <Icon name={a.icon} size={19} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium">{a.title}</span>
                          <span className="block text-[13px] text-muted">{a.body}</span>
                        </span>
                        <Icon name="chevronRight" size={16} className="text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : visible.length === 0 ? (
              <div className="mt-12 flex flex-col items-center gap-3 text-center">
                <Mascot size={80} mood="sleepy" />
                <p className="text-sm text-muted">
                  {query ? `Nothing matches "${query}".` : currentProject ? "No notes in this project yet. Drag some here, or record one." : "No notes here."}
                </p>
              </div>
            ) : (
              <>
                {pinned.length > 0 && <NoteGroup title="Pinned" notes={pinned} />}
                {groupByDay(rest).map(([label, list]) => (
                  <NoteGroup key={label} title={label} notes={list} />
                ))}
              </>
            )}
          </section>
        </main>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="rotate-1 rounded-xl border border-border bg-card px-4 py-3 shadow-2xl">
            <div className="font-medium">{dragging.title}</div>
            {selected.has(dragging.id) && selected.size > 1 && (
              <div className="text-xs text-muted">and {selected.size - 1} more</div>
            )}
          </div>
        )}
      </DragOverlay>

      {selecting && (
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-8">
          <div className="animate-pop flex items-center gap-2 rounded-full bg-foreground py-1.5 pl-4 pr-1.5 text-background shadow-2xl">
            <span className="text-sm">{selected.size} selected</span>
            <select
              aria-label="Move to project"
              disabled={!selected.size}
              value=""
              onChange={(e) => move([...selected], e.target.value === NONE ? null : e.target.value)}
              className="rounded-full bg-background px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
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
        </div>
      )}
    </DndContext>
  );

  function NoteGroup({ title, notes }: { title: string; notes: NoteMeta[] }) {
    return (
      <div className="mb-6">
        <h2 className="mb-2 px-1 text-[13px] font-medium text-muted">{title}</h2>
        <NoteList notes={notes} />
      </div>
    );
  }

  function NoteList({ notes }: { notes: NoteMeta[] }) {
    return (
      <ul className="-mx-2 flex flex-col">
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
  icon,
  count,
  active,
  onClick,
  dropId,
  shared,
  quiet,
}: {
  label: string;
  color?: string;
  icon?: "notes";
  count?: number;
  active: boolean;
  onClick: () => void;
  dropId?: string;
  shared?: boolean;
  quiet?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `static:${label}`, disabled: !dropId });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition md:rounded-lg md:border-0 md:px-2.5 ${
        isOver
          ? "scale-[1.03] border-accent bg-accent-soft ring-2 ring-accent md:ring-2"
          : active
            ? "border-foreground bg-foreground text-background md:bg-subtle md:font-medium md:text-foreground"
            : `border-border bg-card md:bg-transparent md:hover:bg-subtle ${quiet ? "text-muted" : ""}`
      }`}
    >
      {color ? (
        <span className="flex w-4 justify-center">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
        </span>
      ) : icon ? (
        <Icon name="notes" size={16} className="hidden md:block" />
      ) : (
        <span className="hidden w-4 md:block" />
      )}
      <span className="truncate md:flex-1 md:text-left">{label}</span>
      {shared && <Icon name="users" size={13} className="opacity-60" />}
      {count !== undefined && <span className={`text-xs tabular-nums ${active ? "opacity-70" : "text-muted"}`}>{count}</span>}
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
      className="flex shrink-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-2.5 shadow-sm"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="w-48 rounded-lg border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-foreground/30 md:w-full"
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
        <button type="submit" className="rounded-lg bg-foreground px-3 py-1 text-sm font-medium text-background">
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
  const created = new Date(note.createdAt);
  const recent = Date.now() - created.getTime() < 6 * 864e5;
  const when = recent
    ? created.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : created.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const body = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{note.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
          <span>{when}</span>
          {note.kind !== "written" && (
            <>
              <span aria-hidden>·</span>
              <span>{formatDuration(note.durationSec * 1000)}</span>
            </>
          )}
          {template && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{template.name}</span>
            </>
          )}
          {!note.language.startsWith("en") && (
            <>
              <span aria-hidden>·</span>
              <span>{langInfo(note.language).native}</span>
            </>
          )}
          {note.tags?.map((t) => (
            <span key={t} className="hidden text-muted sm:inline">
              #{t}
            </span>
          ))}
        </div>
      </div>
      {open > 0 && (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-[11px] tabular-nums text-muted" title={`${open} open action items`}>
          <Icon name="todo" size={12} /> {open}
        </span>
      )}
      {showProject && project && (
        <span className="hidden max-w-[10rem] shrink-0 items-center gap-1.5 truncate text-xs text-muted sm:flex">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} aria-hidden />
          <span className="truncate">{project.name}</span>
        </span>
      )}
      {showProject && project && <span className="h-2 w-2 shrink-0 rounded-full sm:hidden" style={{ background: project.color }} aria-label={project.name} />}
      {!selecting && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPin();
          }}
          aria-label={note.pinned ? "Unpin" : "Pin"}
          className={`-mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-subtle ${
            note.pinned ? "text-accent" : "text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:hidden"
          }`}
        >
          <Icon name="pin" size={15} />
        </button>
      )}
    </div>
  );

  const cls = `group block rounded-lg px-2 py-2.5 transition-colors ${selected ? "bg-accent-soft" : "hover:bg-subtle"} ${isDragging ? "opacity-40" : ""}`;

  return (
    <li ref={setNodeRef} {...attributes} {...listeners} className="touch-manipulation select-none">
      {selecting ? (
        <button onClick={onSelect} className={`${cls} flex w-full items-center gap-3 text-left`}>
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-accent bg-accent text-white" : "border-border"}`}
          >
            {selected && <Icon name="check" size={13} strokeWidth={2.5} />}
          </span>
          <span className="min-w-0 flex-1">{body}</span>
        </button>
      ) : (
        <Link href={`/notes/${note.id}`} onClick={(e) => blockClick() && e.preventDefault()} className={cls} draggable={false}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** Today, Yesterday, This week, then by month. */
function groupByDay(notes: NoteMeta[]): [string, NoteMeta[]][] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const t0 = start.getTime();
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const t = new Date(n.createdAt).getTime();
    const label =
      t >= t0
        ? "Today"
        : t >= t0 - 864e5
          ? "Yesterday"
          : t >= t0 - 6 * 864e5
            ? "Earlier this week"
            : new Date(n.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups.entries()];
}
