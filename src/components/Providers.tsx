"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";
import { CommandPalette } from "./CommandPalette";
import { NavHistory } from "./NavHistory";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <SessionProvider>
      <NavHistory />
      {children}
      <CommandPalette />
    </SessionProvider>
  );
}
