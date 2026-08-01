# Configuration map

This repo reads credentials and endpoints from per-module config files. Use this map to keep them consistent.

## Android (`apps/android/`)

Required (local only, not committed):
- `local.properties`
  - `JUNCTION_WEB_CLIENT_ID` (OAuth Web client ID from the same Firebase project)
  - `JUNCTION_REALTIME_ENDPOINT` (Functions or server SDP endpoint)
  - `JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT` (recommended)

Files that consume these:
- `apps/android/build.gradle.kts` -> `BuildConfig.*`
- `apps/android/src/main/java/com/splinch/junction/data/sync/firebase/AuthManager.kt`
- `apps/android/src/main/java/com/splinch/junction/data/preference/UserPrefsRepository.kt`

Firebase wiring:
- `apps/android/google-services.json` (not committed; must match `com.splinch.junction`)

## Web (`apps/web/`)

Required:
- `apps/web/.env`
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_STORAGE_BUCKET`
  - `VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `VITE_FIREBASE_APP_ID`
  - `VITE_FIREBASE_MEASUREMENT_ID` (optional)
  - `VITE_REALTIME_ENDPOINT`

Files that consume these:
- `apps/web/src/config.ts`
- `apps/web/src/firebase.ts`
- `apps/web/src/App.tsx`

## Firebase Functions (`services/functions/`) — primary backend

Required:
- Functions config or env: `OPENAI_API_KEY`

Files that consume these:
- `services/functions/index.js`

## Server (`services/server/`) — optional (advanced)

Required:
- `services/server/.env`
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
- `services/server/config.js`
- `services/server/index.js`

## Quick sanity check

Run:
```
.\scripts\config-check.ps1
```
This prints which keys are missing without dumping secrets.
