"use client";

// Ideas: a private scratch space. Saved as Little/ideas.json in the user's
// Drive, never shared with project teams.

import { findFileInFolder, getRootFolder, readText, saveFile } from "./drive";

export const IDEA_COLORS = ["plain", "sun", "peach", "rose", "lilac", "sky", "mint"] as const;
export type IdeaColor = (typeof IDEA_COLORS)[number];

export type Idea = {
  id: string;
  text: string;
  color: IdeaColor;
  pinned?: boolean;
  /** The AI's take on the idea, in Markdown. */
  riff?: string;
  createdAt: string;
  updatedAt: string;
};

type IdeaFile = { version: 1; ideas: Idea[] };
const NAME = "ideas.json";
const KEY = "little:ideas";

/** Last copy seen, so the page opens instantly. */
export function cachedIdeas(): Idea[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Idea[]) : null;
  } catch {
    return null;
  }
}

function remember(ideas: Idea[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ideas));
  } catch {
    /* storage full or blocked */
  }
}

async function load(token: string) {
  const root = await getRootFolder(token);
  const fileId = await findFileInFolder(token, root, NAME);
  const file: IdeaFile = fileId ? JSON.parse(await readText(token, fileId)) : { version: 1, ideas: [] };
  return { root, fileId, ideas: file.ideas ?? [] };
}

export async function loadIdeas(token: string): Promise<Idea[]> {
  const { ideas } = await load(token);
  remember(ideas);
  return ideas;
}

let queue: Promise<unknown> = Promise.resolve();

/** Read-modify-write, one at a time, so quick edits never overwrite each other. */
export function updateIdeas(token: string, change: (ideas: Idea[]) => Idea[]): Promise<Idea[]> {
  const run = queue.then(async () => {
    const { root, fileId, ideas } = await load(token);
    const next = change(ideas);
    await saveFile(token, {
      name: NAME,
      mimeType: "application/json",
      body: JSON.stringify({ version: 1, ideas: next } satisfies IdeaFile, null, 2),
      folderId: root,
      fileId: fileId ?? undefined,
    });
    remember(next);
    return next;
  });
  queue = run.catch(() => {});
  return run;
}

export function newIdea(text: string, color: IdeaColor = "plain"): Idea {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), text: text.trim(), color, createdAt: now, updatedAt: now };
}

/** Prompts for when the page is empty or you're stuck. */
export const SPARKS = [
  "What's something you keep meaning to try?",
  "What annoyed you this week that someone should fix?",
  "If you had a free Saturday to build anything, what would it be?",
  "What would make your team's week 10x easier?",
  "What do you know that most people don't?",
  "Which small habit would change the most if you started it?",
  "What would you make if it didn't have to be good?",
  "कौन सा काम आप हमेशा टालते हैं, और क्यों?",
];
