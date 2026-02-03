# Junction

A calm, local-first social operations hub with a native Android client and a lightweight PC companion.

## What works now

- Android app with Feed + Chat + Settings
- Local-first feed stored in Room, swipe to archive, tap to mark seen
- Notification ingestion via NotificationListenerService (with consent flow)
- GPT chat via OpenAI Realtime WebRTC (text default + optional sustained speech mode)
- Agent tool proposals with explicit Apply/Cancel confirmation + undo
- Optional HTTP backend for legacy chat (keeps `/chat` contract)
- Google sign-in + Firebase sync scaffolding (chat, feed, prefs)
- PC companion web client (Vite + React + Firebase) mirroring chat + feed
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
   - Add the Firebase Function URL to `local.properties` (or set it in Settings -> Realtime):
     ```
     JUNCTION_REALTIME_ENDPOINT=https://<region>-<project>.cloudfunctions.net/realtimeSdpExchange
     ```
   - (Recommended) Add the Realtime client secret URL to `local.properties` (or set it in Settings -> Realtime):
     ```
     JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT=https://<region>-<project>.cloudfunctions.net/realtimeClientSecret
     ```
3. Sync Gradle and run `app`.

## Web (PC companion)

1. Copy `web/.env.example` to `web/.env` and fill Firebase values.
2. Set `VITE_REALTIME_ENDPOINT` to the same Functions URL.
2. Run:
   ```
   cd web
   npm install
   npm run dev
   ```

## Firebase Functions (Realtime SDP exchange) — primary backend

1. Install Firebase CLI and log in.
2. Install dependencies:
   ```
   cd functions
   npm install
   ```
3. Set the OpenAI API key (Functions config or env):
   ```
   firebase functions:config:set openai.key="YOUR_OPENAI_API_KEY"
   ```
   or export `OPENAI_API_KEY` before deploy.
4. Deploy:
   ```
   firebase deploy --only functions
   ```
5. Copy the function URL into Android Settings -> Realtime.

## Self-hosted Junction server (optional, advanced)

This server handles OpenAI calls securely (API keys stay server-side) and mints short-lived Realtime client secrets.

1. Install dependencies:
   ```
   cd server
   npm install
   ```
2. Copy `server/.env.example` to `server/.env` and set:
   - `OPENAI_API_KEY`
   - Firebase Admin creds (`FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`)
   - (Optional) Set `OPENAI_CHAT_MODEL=gpt-5.2` and `OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview`
   - Set `PUBLIC_BASE_URL` to your server URL (needed for OAuth redirects)
   - Configure OAuth client IDs/secrets for integrations you want to enable
3. Run:
   ```
   npm start
   ```
4. Point the app Settings:
   - Realtime client secret endpoint: `http://<host>:8787/realtime/client-secret`
   - Realtime SDP endpoint (optional fallback): `http://<host>:8787/realtime/sdp-exchange`
   - HTTP backend: `http://<host>:8787`

## Integrations (OAuth)

Junction uses standard OAuth to link third-party services. The app opens the provider login page,
then the server stores tokens under the signed-in Firebase user.

Required server env vars per provider:
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Notion: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`

Redirect URI format (set in each provider console):
```
${PUBLIC_BASE_URL}/integrations/<provider>/callback
```

The app expects a deep link after success:
```
junction://oauth-callback?provider=<provider>&status=connected
```

Integration actions (server endpoints):
- `POST /integrations/<provider>/start` -> returns auth URL
- `POST /integrations/<provider>/sync` -> pulls latest data into the feed
- `POST /integrations/<provider>/disconnect` -> revokes locally (removes stored tokens)

## Admin (single-owner)

Junction uses Firebase custom claims to mark a single admin account. The backend will
stamp `admin=true` on the matching email and remove it from everyone else.

Set the admin email in one place:
- Firebase Functions: `firebase functions:config:set admin.email="you@example.com"`
  (or set `ADMIN_EMAIL` in the Functions env before deploy).
- Self-hosted server: set `ADMIN_EMAIL` in `server/.env`.

After sign-in, refresh the ID token (sign out/in or use any Settings action that already
calls `getIdToken(true)`) to pick up the admin claim.

## Speech Mode usage

- Speech Mode is per conversation. Toggle it in the Chat screen.
- When ON, a Realtime WebRTC session stays connected while you view the conversation.
- Sign-in is required to create Realtime sessions (Functions auth gate).
- Use the mic toggle to mute/unmute audio input. Text input remains available.
- Use Stop to cancel the current response and Regenerate to request a new one.

## Privacy posture

- Notification ingestion is local-only by default.
- Sync requires explicit Google sign-in.
- No data is sent externally unless you enable sync, Realtime, or the backend.

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
