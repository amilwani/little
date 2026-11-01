"use client";

// AI features run in the browser with the user's own API key, so the key goes
// straight from their device to Google, OpenAI or Anthropic and never touches
// Little's server.

import type Anthropic from "@anthropic-ai/sdk";
import { getTemplate, type Template } from "./templates";
import type { AiProvider, Settings, Transcript, TranscriptSegment } from "./drive";

export const MODELS = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-5-mini",
  openaiTranscribe: "whisper-1",
  anthropic: "claude-opus-5-5",
} as const;

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  anthropic: "Claude",
};

export type AiConfig = { provider: AiProvider; apiKey: string };

export class AiError extends Error {}

const ORDER: AiProvider[] = ["gemini", "openai", "anthropic"];

/** The provider to use for text tasks: the chosen one if it has a key, else any with a key. */
export function pickTextAi(settings: Settings): AiConfig | null {
  const keys = settings.apiKeys;
  if (settings.aiProvider && keys[settings.aiProvider]) {
    return { provider: settings.aiProvider, apiKey: keys[settings.aiProvider]! };
  }
  const p = ORDER.find((x) => keys[x]);
  return p ? { provider: p, apiKey: keys[p]! } : null;
}

/** The provider to use for audio transcription. Claude can't take audio, so only Gemini or OpenAI. */
export function pickTranscriber(settings: Settings): AiConfig | null {
  const keys = settings.apiKeys;
  const preferred = settings.aiProvider === "openai" ? ["openai", "gemini"] : ["gemini", "openai"];
  const p = (preferred as AiProvider[]).find((x) => keys[x]);
  return p ? { provider: p, apiKey: keys[p]! } : null;
}

function languageName(lang: string) {
  return lang.startsWith("hi") ? "Hindi" : "English";
}

function friendlyError(provider: AiProvider, status: number, body: string): AiError {
  const name = PROVIDER_NAMES[provider];
  if (status === 401 || status === 403) return new AiError(`Your ${name} key was rejected. Check it in Settings.`);
  if (status === 429) return new AiError(`${name} says you've hit a usage or rate limit. Try again in a minute.`);
  if (status === 413) return new AiError("This recording is too large for the AI service.");
  return new AiError(`${name} returned an error (${status}). ${body.slice(0, 200)}`);
}

// ---- Low-level calls ---------------------------------------------------------

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function gemini(apiKey: string, system: string, parts: Part[], json = false): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts }],
        generationConfig: json ? { responseMimeType: "application/json" } : undefined,
      }),
    },
  );
  if (!res.ok) throw friendlyError("gemini", res.status, await res.text());
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new AiError("Gemini returned an empty answer. Try again.");
  return text;
}

async function openaiChat(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELS.openai,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw friendlyError("openai", res.status, await res.text());
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new AiError("OpenAI returned an empty answer. Try again.");
  return text;
}

async function claude(apiKey: string, system: string, user: string): Promise<string> {
  // Loaded only when someone actually uses Claude, to keep the app light.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.create({
      model: MODELS.anthropic,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // If Claude declines on a safety classifier, the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
    });
    if (response.stop_reason === "refusal") {
      throw new AiError("Claude declined to process this text.");
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new AiError("Claude returned an empty answer. Try again.");
    return text;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new AiError("Your Claude key was rejected. Check it in Settings.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiError("Claude says you've hit a usage or rate limit. Try again in a minute.");
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiError(`Claude returned an error (${error.status}). ${error.message.slice(0, 200)}`);
    }
    throw new AiError("Couldn't reach Claude. Check your connection.");
  }
}

async function complete(cfg: AiConfig, system: string, user: string): Promise<string> {
  try {
    if (cfg.provider === "gemini") return await gemini(cfg.apiKey, system, [{ text: user }]);
    if (cfg.provider === "openai") return await openaiChat(cfg.apiKey, system, user);
    return await claude(cfg.apiKey, system, user);
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError(`Couldn't reach ${PROVIDER_NAMES[cfg.provider]}. Check your connection.`);
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function stripFences(s: string) {
  return s.replace(/^```[a-z]*\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// ---- Features ---------------------------------------------------------------

function transcriptText(t: Transcript) {
  return t.segments
    .map((s) => `[${Math.floor(s.startSec / 60)}:${String(s.startSec % 60).padStart(2, "0")}] ${s.text}`)
    .join("\n");
}

function notesSystem(template: Template) {
  return `You write meeting notes from a transcript and the attendee's own rough notes. This was a "${template.name}" meeting.
Return Markdown only, with these sections in this order:
${template.aiSections}

Rules: use only what the transcript and notes say; never invent names, numbers or dates. The attendee's notes show what they cared about, so give those points weight. Write in the language the meeting mostly used: Hindi in Devanagari script, or English. Keep the section headings in English so the app can find them. Keep it concise.`;
}

export async function generateNotes(
  cfg: AiConfig,
  input: { title: string; language: string; transcript: Transcript; notes: string; template?: string },
): Promise<string> {
  if (!input.transcript.segments.length && !input.notes.trim()) {
    throw new AiError("There's no transcript or notes to work from yet.");
  }
  const user = `Meeting title: ${input.title}
Main language: ${languageName(input.language)}

Attendee's own notes:
${input.notes.trim() || "(none)"}

Transcript:
${transcriptText(input.transcript) || "(empty)"}`;
  return stripFences(await complete(cfg, notesSystem(getTemplate(input.template)), user));
}

const CLEANUP_SYSTEM = `You turn raw dictation into clean, ready-to-send text.
Remove filler words (um, uh, like, you know, matlab, haan), false starts and repeated words. Fix punctuation, capitalization and paragraph breaks. Apply spoken corrections such as "no wait, make that Friday". Format lists as lists when the speaker lists things.
Keep the speaker's meaning, tone and language: keep Hindi in Devanagari, English in English, and mixed Hinglish as it was spoken. Do not add anything new, do not answer questions in the text, and do not add a preamble.
Return only the cleaned text.`;

export async function cleanupDictation(cfg: AiConfig, text: string): Promise<string> {
  if (!text.trim()) throw new AiError("I didn't catch any words. Try again a little closer to the mic.");
  return stripFences(await complete(cfg, CLEANUP_SYSTEM, text));
}

const TRANSCRIBE_SYSTEM = `Transcribe this audio recording accurately.
Return JSON only: an array of objects {"startSec": number, "text": string}, one per sentence or short group of sentences, in order, where startSec is when it starts in whole seconds.
Write Hindi in Devanagari script and English in Latin script; keep mixed Hinglish exactly as spoken. Do not translate, summarize or add anything. Return [] if nobody speaks.`;

// Gemini accepts up to ~20 MB per request including base64 overhead.
const GEMINI_MAX_BYTES = 14 * 1024 * 1024;
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(cfg: AiConfig, audio: Blob, language: string): Promise<Transcript> {
  if (cfg.provider === "anthropic") throw new AiError("Claude can't transcribe audio. Add a Gemini or OpenAI key.");
  const mimeType = (audio.type || "audio/webm").split(";")[0];

  if (cfg.provider === "gemini") {
    if (audio.size > GEMINI_MAX_BYTES) {
      throw new AiError("This recording is too long for an AI transcript (about 50 minutes max). The live transcript is kept.");
    }
    let raw: string;
    try {
      raw = await gemini(
        cfg.apiKey,
        TRANSCRIBE_SYSTEM,
        [
          { inlineData: { mimeType, data: await blobToBase64(audio) } },
          { text: `Main language: ${languageName(language)}.` },
        ],
        true,
      );
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError("Couldn't reach Gemini. Check your connection.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch {
      throw new AiError("Gemini's transcript came back in an unexpected format. Try again.");
    }
    const list = Array.isArray(parsed) ? parsed : [];
    const segments: TranscriptSegment[] = list
      .map((s: { startSec?: unknown; text?: unknown }) => ({
        startSec: Math.max(0, Math.round(Number(s.startSec) || 0)),
        text: String(s.text ?? "").trim(),
      }))
      .filter((s) => s.text);
    return { language, source: "gemini", segments };
  }

  // OpenAI
  if (audio.size > OPENAI_MAX_BYTES) {
    throw new AiError("This recording is too long for an AI transcript (about 90 minutes max). The live transcript is kept.");
  }
  const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([audio], `audio.${ext}`, { type: mimeType }));
  form.append("model", MODELS.openaiTranscribe);
  form.append("response_format", "verbose_json");
  form.append("language", language.startsWith("hi") ? "hi" : "en");
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
  } catch {
    throw new AiError("Couldn't reach OpenAI. Check your connection.");
  }
  if (!res.ok) throw friendlyError("openai", res.status, await res.text());
  const data = (await res.json()) as { text?: string; segments?: { start: number; text: string }[] };
  const segments: TranscriptSegment[] = data.segments?.length
    ? data.segments.map((s) => ({ startSec: Math.round(s.start), text: s.text.trim() })).filter((s) => s.text)
    : data.text
      ? [{ startSec: 0, text: data.text.trim() }]
      : [];
  return { language, source: "openai", segments };
}
