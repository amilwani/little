"use client";

import { useEffect, useState } from "react";

/** A small floating note while the device is offline, so saves don't feel lost. */
export function OfflinePill() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="toast fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-1.5 text-[13px] text-background shadow-lg">
      You&apos;re offline. Changes stay on this device until you&apos;re back.
    </div>
  );
}
