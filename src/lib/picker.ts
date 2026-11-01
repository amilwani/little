"use client";

// Google's file picker. With Little's limited Drive access, a teammate picks a
// shared project folder here once, which lets Little open it.

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;

export const pickerAvailable = Boolean(API_KEY && APP_ID);

type PickerResponse = { action: string; docs?: { id: string; name: string }[] };

declare global {
  interface Window {
    gapi?: { load: (name: string, cb: () => void) => void };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    google?: any;
  }
}

let loading: Promise<void> | null = null;

function loadPicker() {
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => window.gapi!.load("picker", () => resolve());
    s.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Google's file picker"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Opens the picker on folders shared with the user. Resolves with the picked folder, or null. */
export async function pickSharedFolder(token: string): Promise<{ id: string; name: string } | null> {
  if (!pickerAvailable) throw new Error("The file picker isn't set up yet.");
  await loadPicker();
  const g = window.google.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.FOLDERS).setSelectFolderEnabled(true).setOwnedByMe(false);
    const picker = new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle("Pick the shared Little project folder")
      .setCallback((r: PickerResponse) => {
        if (r.action === g.Action.PICKED && r.docs?.[0]) resolve({ id: r.docs[0].id, name: r.docs[0].name });
        else if (r.action === g.Action.CANCEL) resolve(null);
      })
      .build();
    picker.setVisible(true);
  });
}
