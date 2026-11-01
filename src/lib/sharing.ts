"use client";

// Sharing a project = sharing its Drive folder. Teammates get edit access to
// the folder; their notes for the project are saved into it, and the
// project's to-do board (todos.json in the folder) is shared too.

import { DriveError, findFileInFolder, readJson, updateIndex, type Project } from "./drive";
import { cache } from "./local";

const API = "https://www.googleapis.com/drive/v3";

export type Member = {
  permissionId: string;
  email: string;
  name?: string;
  role: "owner" | "writer" | "reader" | string;
  photo?: string;
};

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new DriveError(`Drive request failed (${res.status}): ${await res.text()}`, res.status);
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export async function listMembers(token: string, project: Project): Promise<Member[]> {
  const data = await call<{
    permissions: { id: string; emailAddress?: string; displayName?: string; role: string; type: string; photoLink?: string }[];
  }>(token, `${API}/files/${project.folderId}/permissions?fields=permissions(id,emailAddress,displayName,role,type,photoLink)`);
  return data.permissions
    .filter((p) => p.type === "user" && p.emailAddress)
    .map((p) => ({ permissionId: p.id, email: p.emailAddress!, name: p.displayName, role: p.role, photo: p.photoLink }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.email.localeCompare(b.email)));
}

export function parseEmails(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()))].filter((e) =>
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e),
  );
}

export function joinLink(project: Project) {
  return `${window.location.origin}/join?folder=${encodeURIComponent(project.folderId)}`;
}

/** Gives each email edit access to the project's folder and emails them a join link. */
export async function shareProject(token: string, project: Project, emails: string[], inviter?: string) {
  const message = `${inviter ?? "A teammate"} shared the project "${project.name}" with you in Little, the meeting notes app. Open this link and sign in with this Google account to join: ${joinLink(project)}`;
  const failed: string[] = [];
  for (const email of emails) {
    const params = new URLSearchParams({ sendNotificationEmail: "true", emailMessage: message, fields: "id" });
    try {
      await call(token, `${API}/files/${project.folderId}/permissions?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role: "writer", emailAddress: email }),
      });
    } catch {
      failed.push(email);
    }
  }
  if (!project.shared && failed.length < emails.length) {
    const index = await updateIndex(token, (idx) => {
      idx.projects = idx.projects?.map((p) => (p.id === project.id ? { ...p, shared: true } : p));
    });
    await cache.setIndex(index);
  }
  return { failed };
}

export async function removeMember(token: string, project: Project, member: Member) {
  await call(token, `${API}/files/${project.folderId}/permissions/${member.permissionId}`, { method: "DELETE" });
}

type ProjectFileHead = { project: { id: string; name: string; color: string; createdAt: string; owner?: string } };

/**
 * Adds a project someone shared with you. Works once Little can read the
 * folder: either straight away, or after you pick it in Google's file picker.
 */
export async function joinProject(token: string, folderId: string) {
  const fileId = await findFileInFolder(token, folderId, "project.json");
  if (!fileId) throw new DriveError("No project.json in this folder", 404);
  const { project } = await readJson<ProjectFileHead>(token, fileId);
  const index = await updateIndex(token, (idx) => {
    if (idx.projects?.some((p) => p.id === project.id)) return;
    idx.projects = [...(idx.projects ?? []), { ...project, folderId, shared: true, role: "member" }];
  });
  await cache.setIndex(index);
  return { index, project };
}
