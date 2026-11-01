"use client";

import { NoteModeSwitch } from "@/components/NoteModeSwitch";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Icon } from "@/components/Icon";
import { cache, type PendingNote } from "@/lib/local";
import { saveNoteToDrive } from "@/lib/notes";
import type { Project } from "@/lib/drive";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";

function defaultTitle() {
  return `Note ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`;
}

export default function WriteNotePage() {
  return (
    <Suspense>
      <WriteNote />
    </Suspense>
  );
}

/** A note typed by hand: no recording, no transcript. */
function WriteNote() {
  const router = useRouter();
  const params = useSearchParams();
  const { token, status } = useAccessToken();
  const { settings } = useSettings(token);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState(params.get("p") ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    cache.getIndex().then((i) => setProjects((i?.projects ?? []).filter((p) => !p.unavailable)));
  }, []);

  const empty = !title.trim() && !body.trim();

  // Don't lose typing if the tab is closed.
  useEffect(() => {
    if (empty || saving) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [empty, saving]);

  const save = async () => {
    if (empty || saving) return;
    setError(null);
    const note: PendingNote = {
      id: crypto.randomUUID(),
      title: title.trim() || body.trim().split("\n")[0].slice(0, 60) || defaultTitle(),
      createdAt: new Date().toISOString(),
      durationSec: 0,
      kind: "written",
      language: settings.defaultLanguage,
      notes: body,
      transcript: { language: settings.defaultLanguage, source: "browser", segments: [] },
      audio: null,
      projectId: projectId || undefined,
    };
    setSaving("Saving");
    await cache.savePending(note);
    if (!token) {
      setSaving(null);
      setError("You're signed out. The note is saved on this device and will upload after you sign in.");
      return;
    }
    try {
      await saveNoteToDrive(token, note, { saveAudio: false });
      router.replace(`/notes/${note.id}`);
    } catch {
      setSaving(null);
      setError("Couldn't upload to Google Drive. Your note is safe on this device and will upload automatically later.");
    }
  };
  saveRef.current = save;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <>
      <AppHeader
        back={projectId ? `/notes?p=${projectId}` : "/notes"}
        title="New note"
        focus
        actions={
          <button
            onClick={save}
            disabled={empty || !!saving}
            className="h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background disabled:opacity-30"
          >
            {saving ? `${saving}…` : "Save"}
          </button>
        }
      />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pb-24 pt-6 md:pt-10">
        <NoteModeSwitch mode="type" projectId={projectId || undefined} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          placeholder="Untitled note"
          aria-label="Title"
          autoFocus
          className="w-full bg-transparent font-display text-[38px] font-normal leading-[1.05] tracking-[-0.01em] outline-none placeholder:text-foreground/25"
        />
        <div className="-mt-1 flex flex-wrap items-center gap-2">
          {projects.length > 0 && (
            <label className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[13px] hover:border-foreground/30">
              {currentProject ? (
                <span className="h-2 w-2 rounded-full" style={{ background: currentProject.color }} />
              ) : (
                <Icon name="folder" size={14} className="text-muted" />
              )}
              <select
                aria-label="Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-full cursor-pointer appearance-none bg-transparent outline-none"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={13} className="pointer-events-none text-muted" />
            </label>
          )}
        </div>

        {error && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">{error}</p>}

        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Note"
          placeholder="Start writing…"
          className="min-h-[55dvh] w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-muted/70"
        />
        <p className="hidden text-xs text-muted md:block">⌘S to save. Saved to your Google Drive.</p>
      </main>
    </>
  );
}
