"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { Mascot } from "./Mascot";
import { openPalette } from "./CommandPalette";
import { hasHistory } from "./NavHistory";

export const NAV: { href: string; label: string; icon: IconName; key: string }[] = [
  { href: "/", label: "Notes", icon: "notes", key: "h" },
  { href: "/meetings", label: "Meetings", icon: "calendar", key: "m" },
  { href: "/todos", label: "To-dos", icon: "todo", key: "t" },
  { href: "/ask", label: "Ask", icon: "sparkles", key: "a" },
];

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/notes/") && pathname !== "/notes/new";
  return pathname.startsWith(href);
}

/** Back goes to where you came from inside Little, or to `href` on a fresh visit. */
export function BackButton({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (hasHistory()) {
          e.preventDefault();
          router.back();
        }
      }}
      aria-label="Back"
      className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-subtle hover:text-foreground"
    >
      <Icon name="back" size={20} />
    </Link>
  );
}

/**
 * The top bar. On a phone it shows Back or the logo, the page title, search and
 * settings (the tab bar at the bottom does the rest). On a laptop it also holds
 * the main sections and a New button.
 */
export function AppHeader({
  back,
  title,
  focus,
  actions,
}: {
  back?: string;
  title?: string;
  /** Kept for older callers; the header is always full width now. */
  wide?: boolean;
  /** Focused screens (recording, dictating) hide the tab bar. */
  focus?: boolean;
  actions?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <div className={`flex min-w-0 items-center gap-2 ${back ? "md:hidden" : ""}`}>
            {back ? <BackButton href={back} /> : <Logo />}
            {title && <h1 className="min-w-0 truncate text-[15px] font-semibold">{title}</h1>}
          </div>
          {back && (
            <div className="hidden md:flex">
              <Logo />
            </div>
          )}

          <nav className="ml-6 hidden items-center gap-0.5 md:flex" aria-label="Main">
            {NAV.map((n) => {
              const on = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    on ? "bg-subtle font-medium text-foreground" : "text-muted hover:text-foreground"
                  }`}
                >
                  <Icon name={n.icon} size={16} />
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
            <button
              onClick={openPalette}
              aria-label="Search and jump (Ctrl K)"
              className="flex h-9 items-center gap-2 rounded-lg px-2 text-muted hover:bg-subtle hover:text-foreground md:border md:border-border md:bg-card md:px-3 md:hover:bg-card"
            >
              <Icon name="search" size={17} />
              <span className="hidden text-sm md:inline">Search</span>
              <kbd className="hidden rounded border border-border px-1.5 text-[11px] text-muted lg:inline">⌘K</kbd>
            </button>
            <Link
              href="/settings"
              aria-label="Settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              className={`flex h-9 w-9 items-center justify-center rounded-lg hover:bg-subtle hover:text-foreground ${
                pathname.startsWith("/settings") ? "text-foreground" : "text-muted"
              }`}
            >
              <Icon name="settings" size={18} />
            </Link>
            <div className="hidden items-center gap-1 pl-1 md:flex">
              <Link
                href="/dictate"
                className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-foreground hover:bg-subtle"
              >
                <Icon name="pen" size={16} />
                Dictate
              </Link>
              <RecordLink className="flex h-9 items-center gap-2 rounded-lg bg-foreground px-3.5 text-sm font-medium text-background hover:opacity-90">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Record
              </RecordLink>
            </div>
          </div>
        </div>
      </header>
      {!focus && <BottomNav />}
    </>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Little home">
      <Mascot size={28} />
      <span className="text-[17px] font-semibold tracking-tight">Little</span>
    </Link>
  );
}

/** Starts a recording, in the project you are looking at if any. */
export function RecordLink({ className, children }: { className: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href="/notes/new"
      className={className}
      onClick={(e) => {
        const p = new URLSearchParams(window.location.search).get("p");
        if (p && window.location.pathname === "/") {
          e.preventDefault();
          router.push(`/notes/new?p=${encodeURIComponent(p)}`);
        }
      }}
    >
      {children}
    </Link>
  );
}

/** Phone tab bar: Notes, Meetings, Record, To-dos, Ask. */
function BottomNav() {
  const pathname = usePathname();
  const tabs = [NAV[0], NAV[1], null, NAV[2], NAV[3]];
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
        {tabs.map((n) =>
          n ? (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
              className={`flex w-16 flex-col items-center gap-0.5 py-1 text-[11px] ${
                isActive(pathname, n.href) ? "font-medium text-foreground" : "text-muted"
              }`}
            >
              <Icon name={n.icon} size={22} strokeWidth={isActive(pathname, n.href) ? 2 : 1.6} />
              {n.label}
            </Link>
          ) : (
            <RecordSheetButton key="rec" />
          ),
        )}
      </div>
    </nav>
  );
}

function RecordSheetButton() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="relative">
      {open && <button aria-label="Close" className="fixed inset-0 -z-10 cursor-default bg-black/10" onClick={() => setOpen(false)} />}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Record or dictate"
        aria-expanded={open}
        className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_20px_-6px_rgba(220,90,69,0.7)] transition-transform active:scale-95"
      >
        <Icon name={open ? "close" : "mic"} size={open ? 22 : 24} strokeWidth={2} />
      </button>
      {open && (
        <div className="animate-pop absolute bottom-16 left-1/2 w-64 -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-xl">
          <RecordLink className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-subtle">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon name="mic" size={18} />
            </span>
            <span>
              <span className="block text-sm font-medium">Record a meeting</span>
              <span className="block text-xs text-muted">Transcript and AI notes</span>
            </span>
          </RecordLink>
          <Link href="/dictate" className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-subtle">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-subtle">
              <Icon name="pen" size={18} />
            </span>
            <span>
              <span className="block text-sm font-medium">Dictate</span>
              <span className="block text-xs text-muted">Talk, get clean text to paste</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
