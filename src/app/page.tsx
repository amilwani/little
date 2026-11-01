import { auth, signIn } from "@/auth";
import { Mascot } from "@/components/Mascot";
import { Suspense } from "react";
import { NotesHome } from "@/components/NotesHome";

type Feature = { title: string; body: string; icon: React.ReactNode };

const FEATURES: Feature[] = [
  {
    title: "Live transcripts",
    body: "Every word on screen as you talk.",
    icon: <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
  },
  {
    title: "English + हिंदी",
    body: "Switch languages mid-meeting.",
    icon: <path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c0 4-3 7-7 9M14 21l4-9 4 9M15.5 18h5" />,
  },
  {
    title: "AI meeting notes",
    body: "Summaries and action items, written for you.",
    icon: <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />,
  },
  {
    title: "Dictation",
    body: "Talk messy, get polished text to paste anywhere.",
    icon: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  },
  {
    title: "Your Drive, your data",
    body: "Everything lives in your own Google Drive.",
    icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  },
  {
    title: "Phone and laptop",
    body: "Install it like an app. Works offline.",
    icon: <path d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2" />,
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user)
    return (
      <Suspense>
        <NotesHome />
      </Suspense>
    );

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center px-5 pb-10 pt-14 text-center md:pt-24">
      <Mascot size={88} />
      <h1 className="mt-6 text-[40px] font-semibold leading-[1.08] tracking-tight md:text-5xl">
        You talk.
        <br />
        <span className="text-accent">Little</span> takes the notes.
      </h1>
      <p className="mt-4 max-w-sm text-[17px] leading-relaxed text-muted">
        Meetings, lectures and ideas, turned into transcripts and notes in English or Hindi. Free, and private to you.
      </p>

      <SignInButton className="mt-8" />

      <ul className="mt-14 grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border text-left">
        {FEATURES.map((f) => (
          <li key={f.title} className="bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-subtle text-foreground">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {f.icon}
                </svg>
              </span>
            </div>
            <h2 className="mt-3 text-sm font-semibold">{f.title}</h2>
            <p className="mt-0.5 text-xs leading-snug text-muted">{f.body}</p>
          </li>
        ))}
      </ul>

      <p className="mt-8 max-w-sm text-xs text-muted">
        Little can only see the files it creates, in a &ldquo;Little&rdquo; folder in your Drive. AI features use your
        own Gemini, OpenAI or Claude key.
      </p>
    </main>
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
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}
