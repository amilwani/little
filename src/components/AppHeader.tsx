import Link from "next/link";
import { Mascot } from "./Mascot";

const NAV = [
  { href: "/meetings", label: "Meetings", icon: "📅" },
  { href: "/todos", label: "To-dos", icon: "☑️" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppHeader({ back, title, wide }: { back?: string; title?: string; wide?: boolean }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className={`mx-auto flex h-14 items-center gap-3 px-4 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
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
        {title && <h1 className="min-w-0 truncate font-semibold">{title}</h1>}
        <nav className="ml-auto flex shrink-0 items-center">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-muted hover:bg-accent-soft"
            >
              <span aria-hidden className="text-base sm:hidden">
                {n.icon}
              </span>
              <span className="hidden sm:inline">{n.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
