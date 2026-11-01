import { auth, signIn } from "@/auth";
import { Icon, type IconName } from "@/components/Icon";
import { Mascot } from "@/components/Mascot";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HomeDashboard } from "@/components/HomeDashboard";

const FEATURES: { title: string; body: string; icon: IconName }[] = [
  { title: "Live transcripts", body: "Words appear as you talk", icon: "mic" },
  { title: "English + हिंदी", body: "Plus 9 Indian languages", icon: "globe" },
  {
    title: "AI meeting notes",
    body: "Summary and action items",
    icon: "sparkles",
  },
  { title: "Dictation", body: "Talk messy, paste clean", icon: "pen" },
  { title: "Team projects", body: "Share with your team", icon: "users" },
  { title: "To-do board", body: "Action items to tasks", icon: "todo" },
  { title: "Ideas", body: "A space to think out loud", icon: "bulb" },
  { title: "Private", body: "Saved in your own Drive", icon: "shield" },
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
      <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col justify-center gap-6 px-5 py-6 lg:flex-row lg:items-center lg:gap-16 lg:px-10">
        <section className="flex flex-col items-center text-center lg:w-1/2 lg:items-start lg:text-left">
          <Mascot size={64} className="lg:-ml-1 [@media(max-height:700px)]:hidden" />
          <h1 className="mt-4 font-display text-[44px] font-normal leading-[1.02] tracking-tight sm:text-[52px] lg:text-[60px] xl:text-[66px]">
            You talk.
            <br />
            <em className="text-accent">Little</em> takes the notes.
          </h1>
          <p className="mt-3 max-w-sm text-[16px] leading-relaxed text-muted lg:max-w-md lg:text-[17px]">
            Meetings, walkthroughs and ideas, turned into transcripts and notes in English or Hindi. Free, and private
            to you.
          </p>
          <SignInButton className="mt-6 lg:max-w-xs" />
          <p className="mt-3 hidden max-w-sm text-xs text-muted lg:block">
            Little can only see the files it creates, in a &ldquo;Little&rdquo; folder in your Drive. AI features use
            your own Gemini, OpenAI or Claude key.
          </p>
        </section>

        <ul className="stagger grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border text-left lg:w-1/2">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="group flex items-start gap-2.5 bg-card p-3 transition hover:bg-subtle/60 sm:p-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-subtle transition group-hover:scale-110 group-hover:text-accent sm:h-8 sm:w-8">
                <Icon name={f.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold leading-tight sm:text-sm">{f.title}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted sm:text-xs">{f.body}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mx-auto max-w-sm text-center text-[11px] text-muted lg:hidden [@media(max-height:700px)]:hidden">
          Little only sees the files it creates in your Drive. AI features use your own Gemini, OpenAI or Claude key.
        </p>
      </main>
    </>
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
