import { auth, signIn } from "@/auth";
import { Mascot } from "@/components/Mascot";
import { NotesHome } from "@/components/NotesHome";

type Feature = { title: string; body: string; icon: React.ReactNode; soon?: boolean };

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
    soon: true,
  },
  {
    title: "Dictation",
    body: "Talk messy, get polished text to paste anywhere.",
    icon: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
    soon: true,
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
  if (session?.user) return <NotesHome />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center px-5 pb-10 pt-12 text-center">
      <Mascot size={112} />
      <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight">
        You talk.
        <br />
        <span className="text-accent">Little</span> takes the notes.
      </h1>
      <p className="mt-3 max-w-sm text-muted">
        Meetings, lectures and ideas, turned into transcripts and notes in English or Hindi. Free, and private to you.
      </p>

      <SignInButton className="mt-7" />

      <ul className="mt-10 grid w-full grid-cols-2 gap-3 text-left">
        {FEATURES.map((f) => (
          <li key={f.title} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
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
              {f.soon && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Soon
                </span>
              )}
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
      <button className="flex w-full items-center justify-center gap-3 rounded-2xl bg-accent px-5 py-3.5 font-semibold text-white shadow-sm active:scale-[0.98]">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
          <path
            fill="#fff"
            d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"
          />
        </svg>
        Continue with Google
      </button>
    </form>
  );
}
