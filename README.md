# Little

Little is a voice notes web app for phone and desktop. It records meetings, shows a live transcript in English or
Hindi, lets you type notes alongside, and saves everything in the user's own Google Drive. It installs on a phone's
home screen as a PWA.

- **Sign-in:** Google, with the `drive.file` scope (Little only sees files it creates).
- **Storage:** a `Little` folder in each user's Drive. Our server stores no notes.
- **AI:** optional. Users bring their own Gemini, OpenAI or Claude key in Settings. Recording, notes and Drive work without a key; only AI features need one.

## What's in this version

| Area | Status |
| --- | --- |
| Google sign-in and Drive storage | Done |
| Record, pause, resume, stop (screen stays awake while recording) | Done |
| Live transcript, English or Hindi, switchable mid-recording | Done (browser speech recognition, best in Chrome) |
| Notes editor next to the transcript | Done |
| Notes list, note page with playback, edit and delete | Done |
| Offline safety: notes saved on the device first, uploaded later | Done |
| Settings: save audio, default language, AI keys | Done |
| Installable PWA with Little icons | Done |
| AI meeting notes: summary, key points, action items, decisions | Done |
| AI transcripts from the recording (Gemini or OpenAI key) | Done |
| Dictate: talk, get clean text, copy or save | Done |
| Projects: group notes, drag and drop, select and move | Done |
| Meeting templates: 1:1, process walkthrough, review, brainstorming, decision making | Done |
| Shared projects: share by Google email; team tasks per project; private to-dos stay private | Done |
| To-do dashboard: complete vs in review, by project, by person, due this week | Done |
| Meetings from Google Calendar: record with the right title, people and template; notes link back to the meeting | Done |
| Speaker labels in AI transcripts (Gemini); tap a transcript line to play from there | Done |
| Share a note (WhatsApp, any app), email it, or save it as a Google Doc | Done |
| Ask your notes: questions answered from your meetings, with links | Done |
| 11 Indian languages, and translate AI notes into any of them | Done |
| App shortcuts: long-press the icon for Dictate, Record, To-dos, Meetings | Done |
| Search inside notes, transcripts and AI notes; tags; pinned notes | Done |
| To-do board (To do, In progress, In review, Complete) with Team tasks and My tasks, with "+ To-do" on meeting action items | Done |

## How data is stored in Drive

```
Little/
  index.json                 list of notes (keeps the notes list fast)
  settings.json              user settings, including their AI keys
  todos.json                 the to-do board
  Launch/                    a project folder holds its notes' folders
  2026-11-01 Team sync/
    notes.md                 the note, readable in Drive
    transcript.json          transcript with timestamps
    audio.webm               the recording (if "Save audio" is on)
    ai-notes.md              AI notes (when written)
```

## Setup

### 1. Google Cloud (one time, about 10 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project called `Little`.
2. **APIs & Services → Library:** enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**.
   - App name `Little`, your support email, and the app's home page once deployed.
   - Scopes: add `.../auth/drive.file`, plus `openid`, `email`, `profile`.
   - While testing, add your own Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Type: **Web application**.
   - Authorized JavaScript origins: `http://localhost:3000` and your live URL (e.g. `https://little.vercel.app`).
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and
     `https://<your-live-url>/api/auth/callback/google`.
   - Copy the **Client ID** and **Client secret**.

Before opening Little to the public, submit the consent screen for Google's verification (Publishing status →
Publish app). `drive.file` is a non-sensitive scope, so this is the light review.

### 2. Run locally

```bash
cp .env.example .env.local      # then fill in the three values
npx auth secret                 # prints a value for AUTH_SECRET
npm install
npm run dev                     # http://localhost:3000
```

### 2b. Google file picker (for joining shared projects)

Teammates join a shared project by picking its folder once in Google's file picker.

1. In Google Cloud, **APIs & Services → Library**, enable **Google Picker API**.
2. **APIs & Services → Credentials → Create credentials → API key**. Restrict it to the Google Picker API and to
   your site's address.
3. Copy your **project number** from the Cloud console's home page.
4. Set `NEXT_PUBLIC_GOOGLE_API_KEY` (the key) and `NEXT_PUBLIC_GOOGLE_APP_ID` (the project number) in `.env.local` and
   in Vercel, then redeploy.

### 2c. Google Calendar (for the Meetings page)

1. In Google Cloud, **APIs & Services → Library**, enable **Google Calendar API**.
2. In **Google Auth Platform → Data access**, add the scope `.../auth/calendar.events.readonly`.

Little asks for calendar access only when someone taps **Connect Google Calendar**, and only to read events.
For a public launch Google reviews this scope (a sensitive scope: verification, no security audit).

### 3. Deploy to Vercel

1. Sign in to [vercel.com](https://vercel.com) with GitHub and import this repository.
2. Add the environment variables `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
3. Deploy, then add the live URL to the Google OAuth client (step 1.4).

Every push to `main` deploys automatically.

### Install on a phone

- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.

## Known limits

- On iPhone, a web app can stop recording if the screen locks or you switch apps. Little keeps the screen awake while
  recording, but keep the app open.
- Live transcript uses the browser's speech recognition: best in Chrome and Android, weaker in Safari. Users with a
  Gemini or OpenAI key can re-transcribe the recording with AI, which is much better for Hindi and Hinglish.
- AI transcripts send the whole recording in one request: up to about 50 minutes with Gemini and about 90 with OpenAI.

## AI

All AI calls run in the user's browser with their own key, straight to Google, OpenAI or Anthropic. Keys and
transcripts never pass through Little's server. Models: Gemini 2.5 Flash, GPT-5 mini (with Whisper for transcripts),
and Claude Opus 5.5. Claude can write notes and clean up dictation but can't transcribe audio, so AI transcripts need
a Gemini or OpenAI key.

## Tech

Next.js 15 (App Router, TypeScript), Tailwind CSS 4, Auth.js (next-auth v5), Google Drive REST API, IndexedDB
(idb-keyval), a small service worker for install and offline.
