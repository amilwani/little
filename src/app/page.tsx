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

        <Flow />
      </main>
    </>
  );
}

/** Talk → Notes → Done, shown as three small cards. */
function Flow() {
  return (
    <ol className="stagger relative mx-auto flex w-full max-w-md flex-col gap-3 lg:w-[44%]">
      <FlowStep n={1} label="You talk">
        <div className="flex items-center gap-2 text-[12px] font-medium text-accent">
          <span className="pulse-dot h-2 w-2 rounded-full bg-accent" /> Recording · 12:04
        </div>
        <p className="mt-2 text-[14px] leading-relaxed">
          <span className="font-medium">Aman:</span> Priya, launch deck Friday tak bhej dena. Aur pricing hum 15th ko
          final karenge.
        </p>
      </FlowStep>
      <FlowStep n={2} label="Little takes the notes">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted">Decisions</p>
        <p className="mt-1 text-[14px]">Pricing is finalised on the 15th.</p>
        <p className="mt-3 text-[12px] font-medium uppercase tracking-wide text-muted">Action items</p>
        <p className="mt-1 text-[14px]">Priya sends the launch deck by Friday.</p>
      </FlowStep>
      <FlowStep n={3} label="It gets done">
        <div className="flex items-center gap-3">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-white">
            <svg viewBox="0 0 24 24" width="12" height="12" className="check-draw" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12l5 5L20 7" />
            </svg>
          </span>
          <span className="flex-1 text-[14px] text-foreground/50 line-through">Send launch deck</span>
          <span className="text-[12px] text-muted">Priya · Fri</span>
        </div>
      </FlowStep>
    </ol>
  );
}

function FlowStep({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-border bg-card/90 p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)] backdrop-blur">
      <p className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-[11px] font-semibold text-foreground">
          {n}
        </span>
        {label}
      </p>
      {children}
    </li>
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
