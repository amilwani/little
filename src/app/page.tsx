import { auth, signIn } from "@/auth";
import { Mascot } from "@/components/Mascot";
import { NotesHome } from "@/components/NotesHome";

export default async function Home() {
  const session = await auth();
  if (session?.user) return <NotesHome />;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <Mascot size={140} />
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Hi, I&apos;m Little</h1>
        <p className="text-muted">
          I listen to your meetings and thoughts, write them down in English or Hindi, and keep everything safe in
          your own Google Drive.
        </p>
      </div>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
        className="w-full"
      >
        <button className="flex w-full items-center justify-center gap-3 rounded-2xl bg-accent px-5 py-3.5 font-semibold text-white shadow-sm active:scale-[0.98]">
          <GoogleG />
          Continue with Google
        </button>
      </form>
      <p className="text-xs text-muted">
        Little can only see the files it creates in your Drive, inside a folder called &ldquo;Little&rdquo;.
      </p>
    </main>
  );
}

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" />
    </svg>
  );
}
