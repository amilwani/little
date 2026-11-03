"use client";

import { useLeaveGuard } from "@/lib/useLeaveGuard";
import { NoteModeSwitch } from "@/components/NoteModeSwitch";
import { defaultNoteTitle } from "@/lib/dates";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LanguageToggle, type Lang } from "@/components/LanguageToggle";
import { Icon } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { TranscriptView } from "@/components/TranscriptView";
import { cache, type PendingNote } from "@/lib/local";
import { saveNoteToDrive } from "@/lib/notes";
import { langInfo } from "@/lib/languages";
import { formatDuration, useRecorder } from "@/lib/recorder";
import { useLiveTranscript } from "@/lib/speech";
import { useAccessToken } from "@/lib/useAccessToken";
import { useSettings } from "@/lib/useSettings";
import { cache as localCache } from "@/lib/local";
import { TEMPLATES, getTemplate, type TemplateId } from "@/lib/templates";
import type { Project } from "@/lib/drive";
import { guessTemplate, recallEvent } from "@/lib/calendar";

export default function NewRecordingPage() {
  return (
    <Suspense>
      <NewRecording />
    </Suspense>
  );
}

function NewRecording() {
  const router = useRouter();
  const { token, status } = useAccessToken();
  const { settings } = useSettings(token);
  const recorder = useRecorder();
  const live = useLiveTranscript(() => recorder.getElapsedMs() / 1000);

  const params = useSearchParams();
  const [lang, setLang] = useState<Lang>("en-IN");
  const [template, setTemplate] = useState<TemplateId>("general");
  const [projectId, setProjectId] = useState<string>(params.get("p") ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const eventId = params.get("event");
  const [attendees, setAttendees] = useState<string[] | undefined>();

  // Started from a calendar meeting: use its title, people and a matching template.
  useEffect(() => {
    if (!eventId) return;
    const e = recallEvent(eventId);
    if (!e) return;
    setTitle(e.title);
    setAttendees(e.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email));
    const t = guessTemplate(e) as TemplateId;
    setTemplate(t);
    setNotes(getTemplate(t).outline);
  }, [eventId]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef(false);
  const idRef = useRef<string>("");
  const createdAtRef = useRef<string>("");

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => setLang(settings.defaultLanguage), [settings.defaultLanguage]);

  useEffect(() => {
    localCache.getIndex().then((i) => setProjects(i?.projects ?? []));
  }, []);

  const pickTemplate = (id: TemplateId) => {
    // Swap the outline in "My notes" unless the user has typed their own notes.
    const old = getTemplate(template).outline;
    if (!notes.trim() || notes === old) setNotes(getTemplate(id).outline);
    setTemplate(id);
  };

  // Mid-recording, a tapped link offers to stop and save first instead of dropping the audio.
  useLeaveGuard(recorder.state === "recording" || recorder.state === "paused", () => {
    if (confirm("Stop and save this recording before leaving?")) stopRef.current();
    return false;
  });

  const start = async () => {
    idRef.current = crypto.randomUUID();
    createdAtRef.current = new Date().toISOString();
    live.reset();
    if (await recorder.start()) live.start(lang);
  };

  const pause = () => {
    recorder.pause();
    live.stop();
  };

  const resume = () => {
    recorder.resume();
    live.start(lang);
  };

  const stop = () => {
    live.stop();
    recorder.stop();
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const changeLang = (l: Lang) => {
    setLang(l);
    live.setLanguage(l);
  };

  // Once the recorder hands over the audio, save locally first, then to Drive.
  useEffect(() => {
    if (recorder.state !== "stopped" || !recorder.blob || savedRef.current) return;
    savedRef.current = true;
    const note: PendingNote = {
      id: idRef.current,
      title: title.trim() || defaultNoteTitle(),
      createdAt: createdAtRef.current,
      durationSec: Math.round(recorder.elapsedMs / 1000),
      language: lang,
      notes,
      transcript: { language: lang, source: "browser", segments: live.segments },
      audio: recorder.blob,
      projectId: projectId || undefined,
      template,
      calendarEventId: eventId ?? undefined,
      attendees,
    };
    (async () => {
      setSaving("Saving on this device");
      await cache.savePending(note);
      if (!token) {
        setSaving(null);
        setSaveError("You're signed out. The note is saved on this device and will upload after you sign in.");
        return;
      }
      try {
        await saveNoteToDrive(token, note, { saveAudio: settings.saveAudio, onProgress: setSaving });
        router.replace(`/notes/${note.id}?new=1`);
      } catch {
        setSaving(null);
        setSaveError("Couldn't upload to Google Drive. Your note is safe on this device and will upload automatically later.");
      }
    })();
  }, [recorder.state, recorder.blob, recorder.elapsedMs, title, notes, lang, live.segments, token, settings.saveAudio, router, projectId, template, eventId, attendees]);

  const active = recorder.state === "recording" || recorder.state === "paused";

  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <>
      <AppHeader back="/" title={active ? "Recording" : "New recording"} focus />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-44 pt-6 md:pt-10">
        {recorder.state === "idle" && !eventId && <NoteModeSwitch mode="record" projectId={projectId || undefined} />}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled meeting"
          aria-label="Title"
          className="w-full bg-transparent font-display text-[38px] font-normal leading-[1.05] tracking-[-0.01em] outline-none placeholder:text-foreground/25"
        />

        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <LanguageToggle value={lang} onChange={changeLang} />
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
          {!live.supported && <span className="text-xs text-muted">Live transcript needs Chrome or Safari.</span>}
        </div>

        {recorder.error && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{recorder.error}</p>}
        {live.error && live.error !== "network" && (
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted">Transcript paused ({live.error}). Recording continues.</p>
        )}

        {recorder.state === "idle" ? (
          <section className="mt-2">
            <h2 className="mb-2.5 text-[13px] font-medium text-muted">Meeting type</h2>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {TEMPLATES.map((t) => {
                const on = template === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => pickTemplate(t.id)}
                    aria-pressed={on}
                    className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                      on ? "border-foreground bg-card ring-1 ring-foreground" : "border-border bg-card hover:border-foreground/30"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-foreground bg-foreground" : "border-foreground/25"}`}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-background" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{t.name}</span>
                      <span className="mt-0.5 block text-xs leading-snug text-muted">{t.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-5 text-center text-xs text-muted">Keep this screen open while recording, especially on iPhone.</p>
          </section>
        ) : (
          <>
            {/* Phones: tabs. Larger screens: side by side. */}
            <div className="flex rounded-lg bg-subtle p-0.5 md:hidden">
              {(["transcript", "notes"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium ${tab === t ? "bg-card shadow-sm" : "text-muted"}`}
                >
                  {t === "transcript" ? "Transcript" : "My notes"}
                </button>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <section className={`${tab === "transcript" ? "" : "hidden"} min-h-64 rounded-2xl border border-border bg-card p-4 md:block`}>
                <h2 className="mb-3 hidden text-[13px] font-medium text-muted md:block">Live transcript</h2>
                <TranscriptView segments={live.segments} interim={live.interim} />
              </section>
              <section className={`${tab === "notes" ? "" : "hidden"} rounded-2xl border border-border bg-card p-4 md:block`}>
                <h2 className="mb-3 hidden text-[13px] font-medium text-muted md:block">My notes</h2>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Jot down anything important…"
                  className="min-h-64 w-full resize-y bg-transparent leading-relaxed outline-none placeholder:text-muted"
                />
              </section>
            </div>
          </>
        )}

        {saving && (
          <div className="flex items-center justify-center gap-3 text-sm text-muted">
            <Mascot size={32} mood="listening" /> {saving}…
          </div>
        )}
        {saveError && (
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
            {saveError}{" "}
            <button className="font-medium underline" onClick={() => router.replace("/")}>
              Back to notes
            </button>
          </div>
        )}
      </main>

      {recorder.state !== "stopped" && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/90 pt-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6">
            <div className="flex min-w-24 items-center gap-2.5">
              {recorder.state === "recording" && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />}
              {recorder.state === "paused" && <span className="h-2.5 w-2.5 rounded-full bg-muted" />}
              <span className="text-xl font-medium tabular-nums">{formatDuration(recorder.elapsedMs)}</span>
            </div>
            {recorder.state === "idle" && (
              <button
                onClick={start}
                aria-label="Start recording"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-[0_8px_24px_-8px_rgba(220,90,69,0.8)] transition active:scale-95"
              >
                <Icon name="mic" size={28} strokeWidth={2} />
              </button>
            )}
            {active && (
              <div className="flex items-center gap-2">
                <button
                  onClick={recorder.state === "recording" ? pause : resume}
                  className="h-12 rounded-full border border-border bg-card px-5 text-sm font-medium"
                >
                  {recorder.state === "recording" ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={stop}
                  className="flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-foreground px-5 text-sm font-medium text-background active:scale-[0.97]"
                >
                  <span className="h-3 w-3 rounded-sm bg-accent" /> Stop &amp; save
                </button>
              </div>
            )}
            <div className={`min-w-24 text-right text-xs text-muted ${active ? "hidden sm:block" : ""}`}>
              {recorder.state === "idle" ? "Tap to start" : langInfo(lang).native}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
