"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Counts in-app page views this tab, so Back can step back instead of jumping
// to a fixed page.
let views = 0;

export function hasHistory() {
  return views > 1;
}

export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => {
    views++;
  }, [pathname]);
  return null;
}
