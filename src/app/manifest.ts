import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Little",
    short_name: "Little",
    description: "Record, transcribe and keep notes in your own Google Drive.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf5",
    theme_color: "#fffaf5",
    orientation: "portrait",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Long-press the app icon on a phone (or right-click it on a computer) for these.
    shortcuts: [
      { name: "Dictate", short_name: "Dictate", url: "/dictate", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Record a meeting", short_name: "Record", url: "/notes/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "To-dos", short_name: "To-dos", url: "/todos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Meetings", short_name: "Meetings", url: "/meetings", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
