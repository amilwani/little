"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Mascot } from "@/components/Mascot";
import { pickerAvailable, pickSharedFolder } from "@/lib/picker";
import { joinProject } from "@/lib/sharing";
import { useAccessToken } from "@/lib/useAccessToken";

export default function JoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}

function Join() {
  const router = useRouter();
  const folder = useSearchParams().get("folder");
  const { token, status, user } = useAccessToken();
  const [state, setState] = useState<"working" | "needs-pick" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  const join = async (folderId: string) => {
    if (!token) return;
    setState("working");
    try {
      const { project } = await joinProject(token, folderId);
      router.replace(`/notes?p=${project.id}`);
    } catch {
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!token || !folder || tried.current) return;
    tried.current = true;
    // Try straight away; if Drive says no, ask the teammate to pick the folder once.
    join(folder).then((ok) => ok === false && setState("needs-pick"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, folder]);

  const pick = async () => {
    if (!token) return;
    setError(null);
    try {
      const picked = await pickSharedFolder(token);
      if (!picked) return;
      if ((await join(picked.id)) === false) {
        setState("error");
        setError(`"${picked.name}" isn't a Little project, or it hasn't been shared with ${user?.email ?? "this account"}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  return (
    <>
      <AppHeader back="/" title="Join a project" />
      <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pt-12 text-center">
        <Mascot size={110} mood={state === "working" ? "listening" : "happy"} />
        {status === "unauthenticated" ? (
          <>
            <p className="font-medium">Sign in to join this project</p>
            <p className="text-sm text-muted">Use the Google account the invite was sent to.</p>
            <button
              onClick={() => signIn("google", { callbackUrl: window.location.href })}
              className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background"
            >
              Sign in with Google
            </button>
          </>
        ) : !folder && state === "working" ? (
          <>
            <p className="font-medium">Join a shared project</p>
            <p className="text-sm text-muted">Pick the project folder a teammate shared with you.</p>
            <PickButton onClick={pick} />
          </>
        ) : state === "working" ? (
          <p className="text-muted">Opening the project…</p>
        ) : (
          <>
            <p className="font-medium">One more step</p>
            <p className="text-sm text-muted">
              Google asks you to pick the shared folder once, so Little is allowed to open it. Look for the project&apos;s
              name under &quot;Shared with me&quot;.
            </p>
            <PickButton onClick={pick} />
          </>
        )}
        {error && <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{error}</p>}
      </main>
    </>
  );
}

function PickButton({ onClick }: { onClick: () => void }) {
  if (!pickerAvailable) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        Joining needs Google&apos;s file picker, which isn&apos;t set up on this copy of Little yet.
      </p>
    );
  }
  return (
    <button onClick={onClick} className="rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background">
      Pick the shared folder
    </button>
  );
}
