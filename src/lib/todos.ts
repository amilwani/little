"use client";

// To-dos live in Little/todos.json in the user's Drive. Action items from AI
// meeting notes are added when the user taps "Add to to-dos"; users can add their own too.

import { findFileInFolder, getRootFolder, readJson, saveFile, type NoteMeta } from "./drive";

export type TodoStatus = "todo" | "doing" | "waiting" | "done";

export const STATUSES: { id: TodoStatus; name: string; color: string }[] = [
  { id: "todo", name: "To do", color: "#9b5de5" },
  { id: "doing", name: "In progress", color: "#e9a23b" },
  { id: "waiting", name: "Waiting", color: "#4d96ff" },
  { id: "done", name: "Done", color: "#2a9d8f" },
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
  createdAt: string;
  updatedAt: string;
};

export type TodoFile = { version: 1; todos: Todo[] };

const NAME = "todos.json";
let fileIdCache: string | null = null;

async function fileId(token: string) {
  if (fileIdCache) return fileIdCache;
  const root = await getRootFolder(token);
  fileIdCache = await findFileInFolder(token, root, NAME);
  return fileIdCache;
}

export async function loadTodos(token: string): Promise<TodoFile> {
  const id = await fileId(token);
  if (!id) return { version: 1, todos: [] };
  return readJson<TodoFile>(token, id);
}

async function saveTodos(token: string, data: TodoFile) {
  const root = await getRootFolder(token);
  fileIdCache = await saveFile(token, {
    name: NAME,
    mimeType: "application/json",
    body: JSON.stringify(data, null, 2),
    folderId: root,
    fileId: (await fileId(token)) ?? undefined,
  });
}

/** Read-modify-write of todos.json. */
export async function updateTodos(token: string, change: (todos: Todo[]) => Todo[]) {
  const data = await loadTodos(token);
  data.todos = change(data.todos);
  await saveTodos(token, data);
  return data.todos;
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
