"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type MenuItem = { label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean };

/** A small popover menu that closes on outside click or Escape. */
export function Menu({
  label,
  icon = "more",
  text,
  items,
  align = "right",
}: {
  label: string;
  icon?: IconName;
  text?: string;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-9 items-center gap-1.5 rounded-lg text-sm hover:bg-subtle ${text ? "px-2.5" : "w-9 justify-center"} ${open ? "bg-subtle" : ""}`}
      >
        <Icon name={icon} size={18} />
        {text && <span>{text}</span>}
      </button>
      {open && (
        <div
          role="menu"
          className={`animate-pop absolute top-11 z-40 min-w-48 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-subtle disabled:opacity-40 ${it.danger ? "text-accent" : ""}`}
            >
              {it.icon && <Icon name={it.icon} size={16} className={it.danger ? "" : "text-muted"} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
