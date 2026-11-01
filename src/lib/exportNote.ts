"use client";

// Sharing a note: as plain text (WhatsApp, email, any app) or as a Google Doc
// saved next to the note in the user's Drive.

import type { NoteMeta, Transcript } from "./drive";
import { formatDuration } from "./recorder";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inlineHtml = (s: string) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>");

/** The small Markdown subset Little writes, as HTML for Google Docs. */
export function markdownToHtml(md: string) {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) {
      close();
      out.push(`<h${h[1].length + 1}>${inlineHtml(h[2])}</h${h[1].length + 1}>`);
    } else if (task || bullet) {
      if (list !== "ul") {
        close();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${task ? (task[1] === " " ? "☐ " : "☑ ") + inlineHtml(task[2]) : inlineHtml(bullet![1])}</li>`);
    } else if (num) {
      if (list !== "ol") {
        close();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inlineHtml(num[1])}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inlineHtml(line)}</p>`);
    }
  }
  close();
  return out.join("\n");
}

/** Markdown as readable plain text for chat apps and email. */
export function markdownToText(md: string) {
  return md
    .replace(/^#{1,3}\s+(.*)$/gm, (_, t: string) => t.toUpperCase())
    .replace(/^(\s*)[-*]\s+\[ \]\s+/gm, "$1☐ ")
    .replace(/^(\s*)[-*]\s+\[[xX]\]\s+/gm, "$1☑ ")
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function header(meta: NoteMeta) {
  const when = new Date(meta.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${when}${meta.kind === "written" ? "" : ` · ${formatDuration(meta.durationSec * 1000)}`}${meta.attendees?.length ? ` · With ${meta.attendees.join(", ")}` : ""}`;
}

export function noteAsText(meta: NoteMeta, aiNotes: string | null, notes: string) {
  const parts = [meta.title, header(meta), ""];
  if (aiNotes) parts.push(markdownToText(aiNotes), "");
  if (notes.trim()) parts.push("MY NOTES", markdownToText(notes), "");
  parts.push("— Written with Little");
  return parts.join("\n");
}

export function noteAsHtml(meta: NoteMeta, aiNotes: string | null, notes: string, transcript: Transcript | null) {
  const parts = [`<h1>${esc(meta.title)}</h1>`, `<p><i>${esc(header(meta))}</i></p>`];
  if (aiNotes) parts.push(markdownToHtml(aiNotes));
  if (notes.trim()) parts.push("<h2>My notes</h2>", markdownToHtml(notes));
  if (transcript?.segments.length) {
    parts.push("<h2>Transcript</h2>");
    for (const s of transcript.segments) {
      parts.push(
        `<p><span style="color:#888">${formatDuration(s.startSec * 1000)}</span> ${s.speaker ? `<b>${esc(s.speaker)}:</b> ` : ""}${esc(s.text)}</p>`,
      );
    }
  }
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${parts.join("\n")}</body></html>`;
}

/** Saves the note as a Google Doc in the note's Drive folder and returns its link. */
export async function exportToGoogleDocs(token: string, meta: NoteMeta, html: string) {
  const boundary = `little-${crypto.randomUUID()}`;
  const metadata = { name: meta.title, mimeType: "application/vnd.google-apps.document", parents: [meta.folderId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n`,
    html,
    `\r\n--${boundary}--`,
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const data = (await res.json()) as { id: string; webViewLink?: string };
  return data.webViewLink ?? `https://docs.google.com/document/d/${data.id}/edit`;
}
