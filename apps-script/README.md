# Little on Google Apps Script

The whole Little app as an Apps Script web app. No server, no Vercel, no Google Cloud project to set up. Each person's
data lives in their own Google account:

- **Google Drive:** a `Little` folder. Every note gets its own folder with `notes.md`, `transcript.json`,
  `ai-notes.md` and the recording, the same layout as the Next.js app.
- **Google Sheets:** a `Little data` spreadsheet in that folder, with tabs `Notes`, `Projects`, `Todos`, `Ideas`,
  `Inbox` and `SlackSeen`. Each project also gets a `Little board` spreadsheet in its own folder, holding the project's
  notes list and team to-dos, so sharing the folder shares the board.
- **Keys:** AI keys and the Slack token are kept in each user's private Apps Script properties. Other people using the
  same web app can't read them.

## Files

| File | What it does |
| --- | --- |
| `Code.gs` | Web app entry (`doGet`), setup, Sheets and Drive storage helpers, settings and keys |
| `Notes.gs` | Notes, projects, sharing, to-dos, ideas, full-text search |
| `Ai.gs` | Gemini, OpenAI and Claude calls; meeting notes, AI transcripts, dictation clean-up, Ask, translate, idea riffs, Slack actionables; the six meeting templates |
| `Integrations.gs` | Google Calendar, Slack inbox, save as Google Doc, email a note |
| `Index.html` | Page shell |
| `Styles.html` | All styles, light and dark |
| `App.html` | The front end (plain JavaScript, no build step) |
| `appsscript.json` | Manifest: permissions and web app settings |

## Setup (about 5 minutes)

1. Go to [script.google.com](https://script.google.com) and click **New project**. Name it `Little`.
2. Click the gear icon (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the editor, create the files. Use **+ → Script** for each `.gs` file and **+ → HTML** for each `.html`
   file. Type the name without the extension (for example `Notes`, `Styles`). Paste in each file's contents. The project
   already has a `Code.gs`: replace its contents. Paste `appsscript.json` over the existing manifest.
4. Pick `setup` in the function menu at the top and click **Run**. Approve the permissions (Google shows an
   "unverified app" screen for your own scripts: **Advanced → Go to Little**). This creates your `Little` folder and
   `Little data` spreadsheet.
5. Click **Deploy → New deployment → Web app**. Keep "Execute as: User accessing the web app" and "Who has access:
   Anyone with a Google account" (or "Anyone in your organization" on Google Workspace). Click **Deploy** and copy the
   web app URL.
6. Open the URL. On your phone, open the same URL and use **Add to Home Screen**.
7. In the app, tap **Turn on AI** and follow the two steps to paste a free Gemini key.

After you change any file, use **Deploy → Manage deployments → Edit → Version: New version** so the live URL picks it
up. The **Test deployments** link always runs the latest code, which is handy while you try things.

Optional: run `installHourlyInbox` once from the editor to check Slack every hour in the background.

## Same features as the Next.js app

| Feature | In Apps Script |
| --- | --- |
| Google sign-in, data in your own Drive | Built in: Apps Script signs each person in |
| Record, pause, resume, stop; screen stays awake | Same, in the browser (see "Microphone" below) |
| Live transcript in 11 Indian languages, switch mid-recording | Same (browser speech recognition, best in Chrome) |
| Your own notes next to the transcript, template outlines | Same |
| AI meeting notes with templates (General, 1:1, Walkthrough, Review, Brainstorm, Decision) | Same prompts, run on Google's servers with your key |
| AI transcripts with speaker labels (Gemini) or Whisper (OpenAI) | Same |
| Tap a transcript line to play from there | Same |
| Action items: tick them off, "+ To-do" | Same |
| Dictate: talk, get clean text, copy or save | Same |
| Written notes, tags, pins, search inside notes, transcripts and AI notes | Same (search runs on the sheet) |
| Projects: group notes, select and move | Same |
| Shared projects with team to-dos; personal to-dos and ideas stay private | Same: sharing adds people as editors of the project folder and emails them a join link |
| To-do board (To do, In progress, In review, Complete), My tasks / Team tasks, stats, drag and drop | Same |
| Meetings from Google Calendar; record with the right title, people and template | Same, with no extra Google Cloud setup |
| Ask your notes, with cited links | Same |
| Translate AI notes into any of the 11 languages | Same |
| Share a note: copy, WhatsApp, email, Google Doc | Same (email goes from your own Gmail) |
| Ideas with colors, pins and AI riffs | Same |
| Slack inbox: asks and promises from DMs, mentions and your own messages | Same, with a pasted Slack token instead of "Sign in with Slack" (see below) |
| Two-step Gemini key setup | Same |
| Home dashboard, command palette (Ctrl/⌘ K), dark mode, phone layout | Same |

## What doesn't map one-to-one, and the workaround

- **Microphone.** Apps Script serves the page inside a sandboxed iframe, and whether the browser lets that iframe use
  the mic depends on Google's iframe settings and the browser. Little tries the mic first. If it's blocked, the Record
  page says so and offers **Upload a recording** (on a phone this opens the voice recorder), then you get an AI
  transcript and notes as usual. Dictate falls back to typing or your keyboard's mic button. Test the Record button on
  each device you plan to use.
- **Install as an app and offline mode.** Apps Script can't serve a service worker or manifest, so there's no true PWA
  install or offline queue. Use **Add to Home Screen** for an icon. Typed notes are kept as drafts on the device while
  you type, and if saving a recording fails you get **Try again** and **Download recording**.
- **Slack sign-in.** The Next.js app used Slack OAuth with an encrypted cookie. Here, each person creates a small Slack
  app once (the Inbox page walks through it: add the `search:read` user scope, install, copy the `xoxp-` token) and
  pastes the token. If you want one-click Slack sign-in later, the
  [apps-script-oauth2](https://github.com/googleworkspace/apps-script-oauth2) library can do it.
- **Recording size and time limits.** A recording travels to Apps Script in one request, so Little caps it at 25 MB
  (about 2 hours at the 24 kbps it records at). Gemini transcripts take up to about 14 MB (about 75 minutes); longer
  recordings keep the live transcript. Each server call can run for up to 6 minutes, which is enough for one AI transcript.
- **Drive permission.** The Next.js app used the narrow `drive.file` scope. Apps Script's Drive service needs full Drive
  access, so the consent screen asks for it. Little still only touches its own `Little` folder.
- **Speed.** Each action is a round trip to Apps Script (roughly half a second to two seconds), a bit slower than the
  Next.js app. Bootstrap loads everything in one call so the first screen is quick after that.
- **Sharing with people outside your Workspace.** They need to open the same web app URL and approve it once, and they
  see the "unverified app" screen unless you publish the script through Google's verification.

## How it was checked

The server code was run against a fake of the Apps Script services (Drive, Sheets, Properties, Calendar, Mail, Docs,
UrlFetch) with two users: every public function, sharing and joining a project, team versus private to-dos, moving
notes and to-dos between projects, Slack, and all three AI providers. The front end was driven end to end in Chromium,
including inside a sandboxed iframe like Apps Script uses, with and without mic permission. The real Google services
can still differ in small ways, so give it a run-through after you deploy. The checks are in `dev/` (`node dev/server-test.js`;
`dev/run-ui.sh` needs Playwright). You don't paste anything from `dev/` into Apps Script.
