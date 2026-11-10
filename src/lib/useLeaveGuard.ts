"use client";

import { useEffect, useRef } from "react";

// The screen that is guarding right now (recording, unsaved typing), if any.
let current: ((href: string) => boolean) | null = null;

/**
 * For navigation that doesn't come from a link click (keyboard shortcuts, the
 * search palette, menus): asks the guarding screen first. True means go ahead.
 */
export function confirmLeave(href: string) {
  return current ? current(href) : true;
}

/**
 * While `active`, catches in-app link clicks (which skip the browser's beforeunload),
 * shortcut and menu navigation (through confirmLeave), and closing the tab.
 * `onLeave` decides: return true to let the navigation go ahead.
 */
export function useLeaveGuard(active: boolean, onLeave: (href: string) => boolean) {
  const cb = useRef(onLeave);
  cb.current = onLeave;
  useEffect(() => {
    if (!active) return;
    const guard = (href: string) => cb.current(href);
    current = guard;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      if (a.pathname === location.pathname && a.search === location.search) return;
      if (!cb.current(a.href)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      if (current === guard) current = null;
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [active]);
}
