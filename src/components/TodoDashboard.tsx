"use client";

import type { Project } from "@/lib/drive";
import { STATUSES, type Todo, type TodoStatus } from "@/lib/todos";

const today = () => new Date().toISOString().slice(0, 10);

function countBy(todos: Todo[]) {
  const c: Record<TodoStatus, number> = { todo: 0, doing: 0, review: 0, done: 0 };
  for (const t of todos) c[t.status]++;
  return c;
}

/** A thin bar split by status, with a 2px gap between segments. */
function StatusBar({ todos, height = 12 }: { todos: Todo[]; height?: number }) {
  const c = countBy(todos);
  const total = todos.length;
  if (!total) return <div className="rounded-full bg-border" style={{ height }} />;
  return (
    <div className="flex gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {STATUSES.filter((s) => c[s.id]).map((s) => (
        <div
          key={s.id}
          title={`${s.name}: ${c[s.id]} of ${total}`}
          style={{ width: `${(c[s.id] / total) * 100}%`, background: s.color }}
          className="min-w-[4px] transition-opacity hover:opacity-80"
        />
      ))}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function TodoDashboard({ todos, projects, showProjects }: { todos: Todo[]; projects: Project[]; showProjects: boolean }) {
  const c = countBy(todos);
  const total = todos.length;
  const open = todos.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.due && t.due < today());
  const urgent = open.filter((t) => t.urgent);
  const pct = total ? Math.round((c.done / total) * 100) : 0;

  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const dueSoon = open
    .filter((t) => t.due && t.due >= today() && t.due <= weekAhead)
    .sort((a, b) => a.due!.localeCompare(b.due!));

  const owners = new Map<string, Todo[]>();
  for (const t of todos) {
    const key = t.owner?.trim() || "Unassigned";
    owners.set(key, [...(owners.get(key) ?? []), t]);
  }
  const ownerRows = [...owners.entries()].sort((a, b) => b[1].length - a[1].length);

  const projectRows = projects
    .map((p) => ({ p, list: todos.filter((t) => t.projectId === p.id) }))
    .filter((r) => r.list.length);

  if (!total) {
    return <p className="mt-10 text-center text-sm text-muted">No tasks here yet, so there&apos;s nothing to chart.</p>;
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Complete" value={`${pct}%`} sub={`${c.done} of ${total} tasks`} />
        <Tile label="In review" value={c.review} />
        <Tile label="In progress" value={c.doing} />
        <Tile label="To do" value={c.todo} />
        <Tile label="Overdue" value={overdue.length} sub={overdue.length ? "past the due date" : "nothing late"} />
        <Tile label="Urgent" value={urgent.length} sub="still open" />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">All tasks by status</h2>
        <div className="mt-3">
          <StatusBar todos={todos} height={16} />
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {STATUSES.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.name} <span className="tabular-nums text-muted">{c[s.id]}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        {showProjects && projectRows.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">By project</h2>
            <ul className="mt-3 space-y-3">
              {projectRows.map(({ p, list }) => {
                const done = list.filter((t) => t.status === "done").length;
                return (
                  <li key={p.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {done} of {list.length} complete
                      </span>
                    </div>
                    <StatusBar todos={list} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">By person</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 font-normal">Owner</th>
                <th className="py-1 text-right font-normal">Open</th>
                <th className="py-1 text-right font-normal">In review</th>
                <th className="py-1 text-right font-normal">Complete</th>
                <th className="py-1 text-right font-normal">Overdue</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {ownerRows.map(([owner, list]) => (
                <tr key={owner} className="border-t border-border">
                  <td className="py-1.5">{owner}</td>
                  <td className="py-1.5 text-right">{list.filter((t) => t.status === "todo" || t.status === "doing").length}</td>
                  <td className="py-1.5 text-right">{list.filter((t) => t.status === "review").length}</td>
                  <td className="py-1.5 text-right">{list.filter((t) => t.status === "done").length}</td>
                  <td className="py-1.5 text-right">
                    {list.filter((t) => t.status !== "done" && t.due && t.due < today()).length || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Due in the next 7 days</h2>
          {dueSoon.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {dueSoon.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {t.title}
                    {t.owner && <span className="text-muted"> · {t.owner}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(`${t.due}T00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Nothing due this week.</p>
          )}
        </section>
      </div>
    </div>
  );
}
