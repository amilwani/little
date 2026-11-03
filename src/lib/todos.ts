"use client";

// The to-do board. Action items from AI meeting notes are added when the user
// taps "+ To-do"; users can add their own too.

import { findFileInFolder, getRootFolder, loadIndex, readText, saveFile, type NoteMeta, type Project } from "./drive";

export type TodoStatus = "todo" | "doing" | "review" | "done";

export const STATUSES: { id: TodoStatus; name: string; color: string }[] = [
  { id: "todo", name: "To do", color: "#9b5de5" },
  { id: "doing", name: "In progress", color: "#e9a23b" },
  { id: "review", name: "In review", color: "#4d96ff" },
  { id: "done", name: "Complete", color: "#2a9d8f" },
];

export type Todo = {
  id: string;
  title: string;
  status: TodoStatus;
  projectId?: string;
  /** The meeting note this came from, if any. */
  noteId?: string;
  owner?: string;
  due?: string; // yyyy-mm-dd
  urgent?: boolean;
  /** Where it came from outside Little, e.g. a Slack message link. */
  link?: string;
  /** Email of whoever added it. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type TodoFile = { version: 1; todos: Todo[] };

const NAME = "todos.json";
const PERSONAL = "personal";

// Personal to-dos (no project) are saved in Little/todos.json and only you can
// see them. A project's to-dos are saved in todos.json inside the project's
// folder, so everyone the project is shared with sees the same team board.

type Store = { key: string; folderId: string; fileId: string | null; raw: string | null };
type Loaded = { todos: Todo[]; stores: Store[] };

async function loadAll(token: string, projects?: Project[]): Promise<Loaded> {
  const root = await getRootFolder(token);
  const list = projects ?? (await loadIndex(token)).index.projects ?? [];
  const targets = [
    { key: PERSONAL, folderId: root },
    ...list.filter((p) => !p.unavailable).map((p) => ({ key: p.id, folderId: p.folderId })),
  ];
  const stores: Store[] = [];
  const todos: Todo[] = [];
  await Promise.all(
    targets.map(async (t) => {
      try {
        const fileId = await findFileInFolder(token, t.folderId, NAME);
        const raw = fileId ? await readText(token, fileId) : null;
        stores.push({ ...t, fileId, raw });
        const file: TodoFile = raw ? JSON.parse(raw) : { version: 1, todos: [] };
        const projectIds = new Set(targets.map((x) => x.key));
        for (const todo of file.todos) {
          // A to-do belongs to the file it's in. (Older personal to-dos tagged with a
          // project move into that project's file on the next save.)
          const projectId = t.key !== PERSONAL ? t.key : todo.projectId && projectIds.has(todo.projectId) ? todo.projectId : undefined;
          todos.push({ ...todo, projectId });
        }
      } catch {
        /* a project we can't read right now: leave it alone */
      }
    }),
  );
  todos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { todos, stores };
}

function storeJson(todos: Todo[], key: string) {
  const mine = todos.filter((t) => (t.projectId ?? PERSONAL) === key);
  return JSON.stringify({ version: 1, todos: mine } satisfies TodoFile, null, 2);
}

export async function loadTodos(token: string, projects?: Project[]): Promise<TodoFile> {
  const { todos } = await loadAll(token, projects);
  return { version: 1, todos };
}

let queue: Promise<unknown> = Promise.resolve();

/** Read-modify-write of every to-do file, writing only the ones that changed. */
export function updateTodos(token: string, change: (todos: Todo[]) => Todo[], projects?: Project[]) {
  const run = queue.then(async () => {
    const before = await loadAll(token, projects);
    const after = change(before.todos);
    await Promise.all(
      before.stores.map(async (st) => {
        const raw = storeJson(after, st.key);
        if (raw === (st.raw ?? storeJson([], st.key))) return;
        await saveFile(token, {
          name: NAME,
          mimeType: "application/json",
          body: raw,
          folderId: st.folderId,
          fileId: st.fileId ?? undefined,
        });
      }),
    );
    // Only to-dos whose file we could read are kept.
    const known = new Set(before.stores.map((st) => st.key));
    return after.filter((t) => known.has(t.projectId ?? PERSONAL));
  });
  queue = run.catch(() => {});
  return run;
}

export function newTodo(title: string, extra: Partial<Todo> = {}): Todo {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: title.trim(), status: "todo", createdAt: now, updatedAt: now, ...extra };
}

/** "**Priya**: send the deck by Friday" -> owner Priya, title "Send the deck by Friday". */
export function parseAction(text: string): { title: string; owner?: string } {
  const m = text.match(/^\*\*([^*]+)\*\*\s*[:\-–]\s*(.+)$/);
  const clean = (s: string) => s.replace(/\*\*/g, "").trim();
  if (!m) return { title: clean(text) };
  const title = clean(m[2]);
  return { owner: clean(m[1]), title: title.charAt(0).toUpperCase() + title.slice(1) };
}

/** Adds one action item from a meeting to the board (when the user taps "Add to to-dos"). */
export async function addActionToTodos(token: string, note: NoteMeta, actionText: string) {
  const { title, owner } = parseAction(actionText);
  const todo = newTodo(title, { owner, noteId: note.id, projectId: note.projectId });
  return updateTodos(token, (todos) =>
    todos.some((t) => t.noteId === note.id && t.title.toLowerCase() === title.toLowerCase()) ? todos : [todo, ...todos],
  );
}

/** Which of a note's action items are already on the board (by title). */
export function todoTitlesForNote(todos: Todo[], noteId: string) {
  return new Set(todos.filter((t) => t.noteId === noteId).map((t) => t.title.toLowerCase()));
}

/** True when a to-do's owner looks like this person (by name or email). */
export function isMine(todo: Todo, user?: { name?: string | null; email?: string | null }) {
  if (!todo.owner || !user) return false;
  const owner = todo.owner.trim().toLowerCase();
  const first = user.name?.split(" ")[0]?.toLowerCase();
  const email = user.email?.toLowerCase();
  return owner === first || owner === user.name?.toLowerCase() || owner === email || owner === email?.split("@")[0];
}
