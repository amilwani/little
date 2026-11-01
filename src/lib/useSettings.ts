"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./drive";

const LOCAL_KEY = "little:settings";

function readLocal(): Settings {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocal(s: Settings) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

/**
 * Settings live in Little/settings.json in the user's Drive, with a copy in
 * this browser so they load instantly. API keys never touch our server's
 * storage.
 */
export function useSettings(token: string | null) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readLocal());
  }, []);

  useEffect(() => {
    if (!token) return;
    loadSettings(token)
      .then((s) => {
        setSettings(s);
        writeLocal(s);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  const update = useCallback(
    async (next: Settings) => {
      setSettings(next);
      writeLocal(next);
      if (token) await saveSettings(token, next);
    },
    [token],
  );

  return { settings, loaded, update };
}
