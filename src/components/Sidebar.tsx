"use client";

import { useDroppable } from "@dnd-kit/core";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Mascot } from "./Mascot";
import { Menu } from "./Menu";
import { openPalette } from "./CommandPalette";
import { NAV, isActive, withProject } from "./AppHeader";
import type { Project } from "@/lib/drive";
import { cache } from "@/lib/local";
import { useAccessToken } from "@/lib/useAccessToken";

const row =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[14px] transition-colors hover:bg-foreground/[0.05]";

/** The desktop sidebar: pages, projects and settings, in the style of a notes app. */
export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAccessToken();
  const first = user?.name?.split(" ")[0];

  const newProject = () => {
    if (pathname === "/notes") window.dispatchEvent(new Event("little:new-project"));
    else router.push("/notes#new-project");
  };

  return (
    <aside id="sidebar" className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar md:flex">
      <div className="flex h-12 items-center gap-1 px-2">
        <Link href="/" className={`${row} min-w-0 flex-1 font-semibold`} aria-label="Little home">
          <Mascot size={22} />
          <span className="truncate">{first ? `${first}'s Little` : "Little"}</span>
        </Link>
        <Menu
          label="New"
          icon="plus"
          items={[
            { label: "Record a meeting", icon: "mic", onClick: () => router.push(withProject("/notes/new")) },
            { label: "Write a note", icon: "doc", onClick: () => router.push(withProject("/notes/write")) },
            { label: "Dictate", icon: "pen", onClick: () => router.push("/dictate") },
            { label: "Jot down an idea", icon: "bulb", onClick: () => router.push("/ideas?new=1") },
          ]}
        />
      </div>

      <nav aria-label="Main" className="flex flex-col gap-px px-2">
        <button onClick={openPalette} className={`${row} text-muted`}>
          <Icon name="search" size={17} />
          <span className="flex-1">Search</span>
          <kbd className="text-[11px] text-muted/80">⌘K</kbd>
        </button>
        {NAV.map((n) => {
          const on = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`${row} ${on ? "bg-foreground/[0.06] font-medium text-foreground" : "text-foreground/75"}`}
            >
              <Icon name={n.icon} size={17} className={on ? "" : "text-muted"} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex min-h-0 flex-1 flex-col px-2">
        <div className="group flex h-7 items-center justify-between px-2">
          <span className="text-xs font-medium text-muted">Projects</span>
          <button
            onClick={newProject}
            aria-label="New project"
            className="flex h-6 w-6 items-center justify-center rounded text-muted opacity-60 hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={null}>
            <ProjectList onNew={newProject} />
          </Suspense>
        </div>
      </div>

      <div className="flex flex-col gap-px border-t border-border px-2 py-2">
        <Link href="/join" className={`${row} text-foreground/75`}>
          <Icon name="link" size={17} className="text-muted" /> Join a shared project
        </Link>
        <Link
          href="/settings"
          aria-current={pathname.startsWith("/settings") ? "page" : undefined}
          className={`${row} ${pathname.startsWith("/settings") ? "bg-foreground/[0.06] font-medium" : "text-foreground/75"}`}
        >
          <Icon name="settings" size={17} className="text-muted" /> Settings
        </Link>
      </div>
    </aside>
  );
}

function ProjectList({ onNew }: { onNew: () => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const pathname = usePathname();
  const current = useSearchParams().get("p");

  useEffect(() => {
    const load = () => cache.getIndex().then((i) => setProjects(i?.projects ?? []));
    load();
    window.addEventListener("little:index", load);
    return () => window.removeEventListener("little:index", load);
  }, []);

  if (projects === null) return null;
  if (!projects.length)
    return (
      <button onClick={onNew} className={`${row} text-muted`}>
        <Icon name="plus" size={15} /> Add a project
      </button>
    );
  return (
    <ul className="flex flex-col gap-px">
      {projects.map((p) => (
        <ProjectRow key={p.id} project={p} active={pathname === "/notes" && current === p.id} />
      ))}
    </ul>
  );
}

function ProjectRow({ project, active }: { project: Project; active: boolean }) {
  // Notes can be dragged from the list onto a project here.
  const { setNodeRef, isOver } = useDroppable({ id: `project:${project.id}` });
  return (
    <li ref={setNodeRef}>
      <Link
        href={`/notes?p=${project.id}`}
        className={`${row} ${active ? "bg-foreground/[0.06] font-medium" : "text-foreground/75"} ${isOver ? "bg-accent-soft ring-1 ring-accent" : ""}`}
      >
        <span className="flex w-[17px] justify-center">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: project.color }} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          {project.name}
          {project.unavailable ? " (no access)" : ""}
        </span>
        {project.shared && <Icon name="users" size={13} className="text-muted" />}
      </Link>
    </li>
  );
}
