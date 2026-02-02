# Configuration map

This repo reads credentials and endpoints from per-module config files. Use this map to keep them consistent.

## Android (`app/`)

Required (local only, not committed):
- `local.properties`
  - `JUNCTION_WEB_CLIENT_ID` (OAuth Web client ID from the same Firebase project)
  - `JUNCTION_REALTIME_ENDPOINT` (Functions or server SDP endpoint)
  - `JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT` (recommended)

Files that consume these:
- `app/build.gradle.kts` -> `BuildConfig.*`
- `app/src/main/java/com/splinch/junction/sync/firebase/AuthManager.kt`
- `app/src/main/java/com/splinch/junction/settings/UserPrefsRepository.kt`

Firebase wiring:
- `app/google-services.json` (not committed; must match `com.splinch.junction`)

## Web (`web/`)

Required:
- `web/.env`
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_FIREBASE_MEASUREMENT_ID` (optional)
  - `VITE_REALTIME_ENDPOINT`

Files that consume these:
- `web/src/config.ts`
- `web/src/firebase.ts`
- `web/src/App.tsx`

## Server (`server/`)

Required:
- `server/.env`
  - `OPENAI_API_KEY`
  - `FIREBASE_SERVICE_ACCOUNT_JSON` **or** `GOOGLE_APPLICATION_CREDENTIALS`

Optional:
- `OPENAI_ALLOWED_MODELS`, `OPENAI_CHAT_MODEL`, `OPENAI_REALTIME_MODEL`
- OAuth provider credentials:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`

Files that consume these:
- `server/config.js`
- `server/index.js`

## Firebase Functions (`functions/`)

Required:
- Functions config or env: `OPENAI_API_KEY`

Files that consume these:
- `functions/index.js`

## Quick sanity check

Run:
```
.\scripts\config-check.ps1
```
This prints which keys are missing without dumping secrets.
