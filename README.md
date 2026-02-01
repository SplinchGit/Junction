# Junction

A calm, local-first social operations hub with a native Android client and a lightweight PC companion.

## What works now

- Android app with Feed + Chat + Settings
- Local-first feed stored in Room, swipe to archive, tap to mark seen
- Notification ingestion via NotificationListenerService (with consent flow)
- Voice input for chat (Android speech recognizer)
- Optional HTTP backend for chat (keeps `/chat` contract)
- Google sign-in + Firebase sync scaffolding (chat, feed, prefs)
- PC companion web client scaffold (Vite + React + Firebase)
- GitHub Releases update banner (checks latest release)
- Update indicator dot appears in the Feed header when a new release is available (banner auto-hides).

## Android setup

1. Open the project in Android Studio.
2. Add Firebase config:
   - Place `google-services.json` in `app/` (not committed).
   - Add your OAuth Web Client ID to `local.properties`:
     ```
     JUNCTION_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID
     ```
3. Sync Gradle and run `app`.

## Web (PC companion)

1. Copy `web/.env.example` to `web/.env` and fill Firebase values.
2. Run:
   ```
   cd web
   npm install
   npm run dev
   ```

## Privacy posture

- Notification ingestion is local-only by default.
- Sync requires explicit Google sign-in.
- No data is sent externally unless you enable sync or the backend.

## Update pipeline

- GitHub Actions builds debug APK on push/tag.
- App checks GitHub Releases and shows a calm update banner if newer.

## Local repo update helper

Run:
```
.\scripts\update.ps1
```
This does a `git pull` and refreshes web dependencies if present.

---

If build errors appear, share them and we will patch fast.
