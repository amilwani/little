"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/lib/drive";
import { joinLink, listMembers, parseEmails, removeMember, shareProject, type Member } from "@/lib/sharing";

/** Who can see a project, and a box to add teammates by Google email. */
export function ShareProject({
  token,
  project,
  me,
  onShared,
}: {
  token: string;
  project: Project;
  me?: { name?: string | null; email?: string | null };
  onShared: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const isOwner = project.role !== "member";

  const refresh = useCallback(() => {
    listMembers(token, project)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [token, project]);

  useEffect(refresh, [refresh]);

  const share = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = parseEmails(emails);
    if (!list.length) return setNote("Add one or more Google email addresses.");
    setBusy(true);
    setNote(null);
    const { failed } = await shareProject(token, project, list, me?.name ?? me?.email ?? undefined);
    setBusy(false);
    setEmails(failed.join(", "));
    setNote(
      failed.length
        ? `Couldn't share with ${failed.join(", ")}. Check the addresses and try again.`
        : `Shared. ${list.length === 1 ? "They'll get" : "Each person gets"} an email with a link to join.`,
    );
    refresh();
    onShared();
  };

  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.email} from "${project.name}"?`)) return;
    try {
      await removeMember(token, project, m);
      refresh();
    } catch {
      setNote(`Couldn't remove ${m.email}.`);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(joinLink(project));
    setNote("Join link copied. Teammates need to be added here first.");
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">Team</h3>
      <p className="mt-0.5 text-xs text-muted">
        Everyone here can see and add notes and team tasks in this project. Their notes are saved in the project&apos;s
        folder in {isOwner ? "your" : "the owner's"} Google Drive.
      </p>
      <ul className="mt-2 space-y-1.5">
        {members === null ? (
          <li className="text-sm text-muted">Loading…</li>
        ) : (
          members.map((m) => (
            <li key={m.permissionId} className="flex items-center gap-2 text-sm">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold uppercase">
                {(m.name ?? m.email)[0]}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {m.name ?? m.email}
                {m.name && <span className="text-muted"> · {m.email}</span>}
              </span>
              {m.role === "owner" ? (
                <span className="text-xs text-muted">Owner</span>
              ) : isOwner ? (
                <button onClick={() => remove(m)} className="text-xs text-muted underline">
                  Remove
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
      {isOwner && (
        <form onSubmit={share} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="Add Google emails, separated by commas"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button disabled={busy} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Sharing…" : "Share"}
          </button>
        </form>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button onClick={copyLink} className="text-xs text-muted underline">
          Copy join link
        </button>
      </div>
      {note && <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs">{note}</p>}
    </div>
  );
}
