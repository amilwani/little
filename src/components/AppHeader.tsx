import Link from "next/link";
import { Mascot } from "./Mascot";

export function AppHeader({ back, title }: { back?: string; title?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        {back ? (
          <Link href={back} className="-ml-2 rounded-full px-2 py-1 text-lg text-muted hover:bg-accent-soft" aria-label="Back">
            ←
          </Link>
        ) : (
          <Link href="/" className="flex items-center gap-2">
            <Mascot size={32} />
            <span className="text-lg font-semibold">Little</span>
          </Link>
        )}
        {title && <h1 className="truncate font-semibold">{title}</h1>}
        <div className="ml-auto">
          <Link href="/settings" className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-accent-soft">
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}
