import { auth, signIn } from "@/auth";
import { Icon, type IconName } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HomeDashboard } from "@/components/HomeDashboard";

const BADGES: { label: string; icon: IconName }[] = [
  { label: "हिंदी, English + 9 more", icon: "globe" },
  { label: "Saved in your own Google Drive", icon: "shield" },
  { label: "Free with your own AI key", icon: "sparkles" },
];

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (session?.user) {
    // Older links to a project or a search open the notes list.
    const { p, q } = await searchParams;
    if (p) redirect(`/notes?p=${encodeURIComponent(p)}`);
    if (q) redirect(`/notes?q=${encodeURIComponent(q)}`);
    return (
      <Suspense>
        <HomeDashboard />
      </Suspense>
    );
  }

  return (
    <>
      <div className="aurora aurora-morning" aria-hidden />
      <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col justify-center gap-10 px-5 py-8 lg:flex-row lg:items-center lg:gap-16 lg:px-10">
        <section className="flex flex-col items-center text-center lg:w-[52%] lg:items-start lg:text-left">
          <div className="flex items-center gap-2">
            <Mascot size={36} />
            <span className="text-[17px] font-semibold tracking-tight">Little</span>
          </div>
          <h1 className="mt-6 font-display text-[46px] font-normal leading-[1] tracking-tight sm:text-[56px] lg:text-[64px] xl:text-[72px]">
            Never forget what you <em className="text-accent">promised.</em>
          </h1>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-foreground/70 lg:text-[17px]">
            Little listens to your meetings and voice notes, in Hindi or English, and turns what was said into notes and
            to-dos you actually finish.
          </p>
          <SignInButton className="mt-7 lg:max-w-xs" />
          <ul className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[13px] text-muted lg:justify-start">
            {BADGES.map((b) => (
              <li key={b.label} className="flex items-center gap-1.5">
                <Icon name={b.icon} size={14} className="text-foreground/50" />
                {b.label}
              </li>
            ))}
          </ul>
        </section>

        <Features />
      </main>
    </>
  );
}

const FEATURES: { title: string; body: string; icon: IconName; tint: string }[] = [
  { title: "AI notes", body: "Decisions and action items, written for you", icon: "sparkles", tint: "#dc5a45" },
  { title: "To-do board", body: "Private tasks and team boards", icon: "todo", tint: "#2a9d8f" },
  { title: "Calendar", body: "See today's meetings, record in one tap", icon: "calendar", tint: "#4d96ff" },
  { title: "Ask your notes", body: "\u201cWhat did I promise this week?\u201d", icon: "search", tint: "#9b5de5" },
  { title: "Ideas", body: "A space to think out loud, AI riffs on it", icon: "bulb", tint: "#e9a23b" },
  { title: "Dictation", body: "Talk messy, paste clean text anywhere", icon: "pen", tint: "#e76f8a" },
];

/** A small bento of what Little does: one live example, then the rest. */
function Features() {
  return (
    <div className="stagger mx-auto grid w-full max-w-lg grid-cols-2 gap-3 lg:w-[46%]">
      <div className="col-span-2 rounded-2xl border border-border bg-card/90 p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "color-mix(in srgb, #dc5a45 14%, transparent)", color: "#dc5a45" }}>
              <Icon name="mic" size={15} />
            </span>
            Live transcript
          </p>
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-accent">
            <span className="pulse-dot h-2 w-2 rounded-full bg-accent" /> 12:04
          </span>
        </div>
        <div className="mt-3 space-y-1.5 text-[13.5px] leading-relaxed">
          <p>
            <span className="font-medium">Aman:</span> Priya, launch deck Friday tak bhej dena.
          </p>
          <p>
            <span className="font-medium">Priya:</span> हाँ, और pricing 15th को final करेंगे।
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {["English", "हिंदी", "Hinglish", "+ 9 more"].map((l) => (
            <span key={l} className="rounded-full bg-subtle px-2.5 py-0.5 text-[12px] text-foreground/70">
              {l}
            </span>
          ))}
        </div>
      </div>
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className="group rounded-2xl border border-border bg-card/90 p-3.5 shadow-[0_8px_30px_-16px_rgba(0,0,0,0.12)] backdrop-blur transition hover:-translate-y-0.5"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg transition group-hover:scale-110"
            style={{ background: `color-mix(in srgb, ${f.tint} 14%, transparent)`, color: f.tint }}
          >
            <Icon name={f.icon} size={16} />
          </span>
          <p className="mt-2.5 text-[14px] font-semibold leading-tight">{f.title}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{f.body}</p>
        </div>
      ))}
    </div>
  );
}

function SignInButton({ className = "" }: { className?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/" });
      }}
      className={`w-full max-w-sm ${className}`}
    >
      <button className="flex w-full items-center justify-center gap-3 rounded-xl bg-foreground px-5 py-3.5 font-medium text-background shadow-sm transition hover:opacity-90 active:scale-[0.98]">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
          <path
            fill="#FFC107"
            d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
          />
          <path
            fill="#FF3D00"
            d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
          />
          <path
            fill="#4CAF50"
            d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
          />
          <path
            fill="#1976D2"
            d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
          />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}
