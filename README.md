# Little

Little is a voice notes web app for phone and desktop. It records meetings, shows a live transcript in English or
Hindi, lets you type notes alongside, and saves everything in the user's own Google Drive. It installs on a phone's
home screen as a PWA.

- **Sign-in:** Google, with the `drive.file` scope (Little only sees files it creates).
- **Storage:** a `Little` folder in each user's Drive. Our server stores no notes.
- **AI:** optional. Users bring their own Gemini, OpenAI or Claude key in Settings (AI features arrive in step 3).

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
| AI notes, dictation cleanup, AI transcripts | Step 3 |

## How data is stored in Drive

```
Little/
  index.json                 list of notes (keeps the notes list fast)
  settings.json              user settings, including their AI keys
  2026-11-01 Team sync/
    notes.md                 the note, readable in Drive
    transcript.json          transcript with timestamps
    audio.webm               the recording (if "Save audio" is on)
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
- Live transcript uses the browser's speech recognition: best in Chrome and Android, weaker in Safari. AI transcripts
  with the user's own key come in step 3.

## Tech

Next.js 15 (App Router, TypeScript), Tailwind CSS 4, Auth.js (next-auth v5), Google Drive REST API, IndexedDB
(idb-keyval), a small service worker for install and offline.
