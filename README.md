# Junction

[![Download APK](https://img.shields.io/badge/Download-APK-4f7cff?style=for-the-badge)](https://splinchgit.github.io/Junction/)
[![APK build](https://img.shields.io/github/actions/workflow/status/SplinchGit/Junction/android-build.yml?branch=main&style=for-the-badge&label=APK%20build)](https://github.com/SplinchGit/Junction/actions/workflows/android-build.yml)
[![Updated](https://img.shields.io/github/last-commit/SplinchGit/Junction/main?style=for-the-badge&label=updated)](https://github.com/SplinchGit/Junction/commits/main)

Grab the latest build straight to your phone: **[Download APK](https://splinchgit.github.io/Junction/)**
— rebuilt automatically on every push to `main`. The download page states the version, build date,
commit and SHA-256 of exactly what it is serving, so there is never any guessing about whether you
have the current build.

- Direct APK: [`junction-debug.apk`](https://splinchgit.github.io/Junction/junction-debug.apk)
- Checksum: [`junction-debug.apk.sha256`](https://splinchgit.github.io/Junction/junction-debug.apk.sha256)

Both badges above are live, so this section cannot go stale: "updated" is when `main` last changed,
and "APK build" is the status of the workflow that publishes the download page. If that build is
failing, the page is still serving the last APK that succeeded — which will be older than `main`.

An Android-native assistant that acts on your phone under trust you control and can audit. It reads
the screen, replies to messages, manages email, and drives apps — always with a client-side trust
gate between "the model wants to do X" and "X actually happens."

## What Junction is (and isn't)

- **API-first, no on-device LLM.** You bring a key for Claude, OpenAI, DeepSeek, or any
  OpenAI-compatible endpoint. Chat and tool-calling run entirely against that provider from the
  phone — there is no local model and no required backend for text chat.
- **Local-first.** Feed, chat history, the audit log, and durable memory all live in on-device Room
  storage. Firebase sync is opt-in and off by default; the app runs fully without a Google account
  or `google-services.json`.
- **Trust is a client-side table, never model-decided.** Every tool has a fixed risk tier
  (`READ`/`INAPP`/`OUTBOUND`/`DESTRUCTIVE`) declared in `chat/tools/ToolRegistry.kt`. The model
  proposes; `TrustGate` decides whether that proposal auto-runs, needs your confirmation, or is
  blocked outright — see "Injection architecture" below.
- **Distribution reality.** There is no Play Store listing. Installs are via sideloaded release
  APKs (see "Direct APK releases") or, optionally, Shizuku for a smoother update flow — Shizuku
  needs restarting after every reboot on non-rooted devices and some OEMs (Xiaomi/MIUI in
  particular) add extra hoops or block it outright. `install_apk` currently uses the *public*
  `PackageInstaller` session API gated behind Shizuku being connected; it still shows Android's own
  install-confirmation dialog rather than a fully silent install (see `platform/ShizukuInstaller.kt`
  for exactly why, and what a genuinely silent path would still require).
- **Voice is provider-agnostic, not welded to one vendor.** Speech mode can run over OpenAI's
  Realtime API (low latency, needs the Functions/server relay below) or entirely on-device via
  Android's own `SpeechRecognizer`/`TextToSpeech`, routed through whichever text provider you've
  configured — pick the backend in Settings > Voice backend.
- **Memory is minimal and forward-only.** A capped (~200 fact) durable-fact store built from
  conversation going forward, never a trawl of old data. See "Memory" below.

See [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) for the specific spec items that need
a physical device, external credentials, or a business decision this codebase can't make for
itself — everything else in the v2 build spec is implemented.

## Injection architecture (summary)

Junction reads content it didn't write — emails, notifications, on-screen text — while holding the
ability to send messages and take actions. That's the classic untrusted-input + capability
combination, and it's treated as a first-class design problem rather than a prompt-wording issue:

- **Reader/Actor split.** Untrusted content is only ever passed to `LlmProvider.readUntrusted(...)`,
  a call with no `tools` parameter in its signature — it is structurally incapable of triggering a
  tool call. Its output is a validated `ReaderOutput` (summary/entities/salience), never raw text,
  and any instruction-shaped content inside it surfaces as an observation (`contentRequests`), not
  as something the actor lane can act on.
- **Provenance tagging.** Every context block, chat message, feed item, plan, and audit row carries
  `OWNER` / `JUNCTION` / `UNTRUSTED` provenance. It's never stripped or upgraded — a summary of
  untrusted content is still untrusted, transitively.
- **Trigger provenance.** Only an `OWNER`-triggered turn may initiate a state-changing tool call —
  enforced as a hard check in `TrustGate`, not a convention. A proactive digest check or an
  arriving email can, at most, produce a proposal for you to approve; it can never execute.
- **Taint escalation, plan-hash binding, centralized egress checks, fail-closed defaults.** See
  `chat/TrustGate.kt` and `chat/PlanExecutor.kt` — these are exercised end-to-end by
  `androidTest/InjectionTestSuite.kt`, which CI runs on every build.

This does not claim to "solve" prompt injection — nothing does. It prevents untrusted content from
silently initiating actions, contains blast radius when something does get through, and logs
attempted injections as a first-class metric (`ActionAuditMetrics.injectionDetectionCount`).

## Memory

`remember_fact`/`forget_fact` let the assistant store a fact the owner explicitly stated or
repeated (never something merely read from untrusted content) — capped at 200, reviewable and
individually deletable under Settings > Memory. Stored facts are replayed into future context as
`JUNCTION`-provenance state, so they inform responses but — like everything else with that
provenance tag — can never themselves initiate a tool call.

## What works today

- Android app: Feed, Chat, Audit, Settings.
- Local-first feed in Room; swipe to archive, tap to mark seen.
- Notification ingestion via `NotificationListenerService` (consent flow, tagged `UNTRUSTED` at
  capture), with reply/dismiss actions gated by the trust gate.
- Screen automation via an opt-in Accessibility service: `read_screen`, `tap_element`, `set_text`,
  `scroll`, `press_back`/`press_home`, with FLAG_SECURE and WebView/Canvas low-fidelity detection.
- Gmail triage/draft/send/archive/unsubscribe, with recipients constrained to the existing thread.
- Provider-agnostic chat (Anthropic / OpenAI / DeepSeek / custom OpenAI-compatible), with a
  workhorse/frontier lane split and health-aware fallback across configured providers.
- Full typed-plan pipeline: plan-level approval with per-step disclosure, post-condition
  verification, failure recovery, interruption/resume.
- Append-only audit log (`action_log`) backing an Audit tab, a state-based eval harness
  (`evaluation/`), and an explicit, content-free telemetry export.
- Optional Firebase sync (chat/feed/prefs) and a PC companion web client that mirrors
  conversations read-only — it cannot execute tools; anything it sends is tagged `UNTRUSTED`.
- GitHub Releases update banner + checksum-verified APK install.

## Android setup

1. Open the project in Android Studio.
2. Settings > add a provider API key (Anthropic, OpenAI, DeepSeek, or a custom OpenAI-compatible
   base URL) — this is all text chat and tool-calling need. No `google-services.json`, no backend,
   no Google account required.
3. Optional, for OpenAI Realtime voice specifically: add the Functions/server endpoint in Settings
   or `local.properties`:
   ```
   JUNCTION_REALTIME_ENDPOINT=https://<region>-<project>.cloudfunctions.net/realtimeSdpExchange
   JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT=https://<region>-<project>.cloudfunctions.net/realtimeClientSecret
   ```
   Or skip all of this and use the on-device voice backend (Settings > Voice backend), which needs
   none of it.
4. Sync Gradle and run `app`.

## Firebase / Google Sign-In console setup (optional sync only)

Everything above works with Firebase untouched. This section is only for opting into cross-device
sync of chat/feed/prefs.

1. Firebase Console: create or select the project.
2. Project settings -> Your apps -> Add app (Android), package `com.splinch.junction`.
3. Download `google-services.json` to `app/google-services.json`.
4. Add SHA fingerprints (SHA-1 required, SHA-256 recommended).
5. Authentication -> Sign-in method: enable Google.
6. Google Cloud Console -> Credentials: OAuth Client ID (Android, same package+SHA-1) and OAuth
   Client ID (Web application) — use the Web Client ID in `local.properties`.
7. Configure the OAuth consent screen (add your account as a test user if in testing mode).

Deploy the checked-in Firestore contract before enabling sync:
```
firebase deploy --only firestore:rules
```
The rules require synchronized chat messages to remain `UNTRUSTED` — companion content can never
become owner-authorized context.

## Web (PC companion)

Read-only mirror of chat/feed; cannot execute tools (see "Injection architecture").
```
cd web
cp .env.example .env   # fill Firebase values, set VITE_REALTIME_ENDPOINT
npm install
npm run dev
```

## Firebase Functions (Realtime SDP exchange — only needed for OpenAI Realtime voice)

```
cd functions
npm install
firebase functions:config:set openai.key="YOUR_OPENAI_API_KEY"
firebase deploy --only functions
```
Copy the function URL into Android Settings -> Realtime. Skip this entirely if you're using the
on-device voice backend or text-only chat.

## Self-hosted server (optional — Realtime relay + OAuth integrations + admin claim, not a chat backend)

Chat itself no longer goes through this server; providers are called directly from the app. This
server exists only for: minting short-lived Realtime client secrets, the OAuth integration flows
below, and stamping the single-admin Firebase custom claim.
```
cd server
npm install
cp .env.example .env   # OPENAI_API_KEY, Firebase Admin creds, PUBLIC_BASE_URL, OAuth client IDs
npm start
```
Point Settings -> Realtime at `http://<host>:8787/realtime/client-secret` (and optionally
`/realtime/sdp-exchange` as a fallback).

## Integrations (OAuth)

Google/Slack/GitHub/Notion link through the server above, storing tokens under the signed-in
Firebase user:
- Server env per provider: `GOOGLE_CLIENT_ID`/`SECRET`, `SLACK_CLIENT_ID`/`SECRET`,
  `GITHUB_CLIENT_ID`/`SECRET`, `NOTION_CLIENT_ID`/`SECRET`.
- Redirect URI: `${PUBLIC_BASE_URL}/integrations/<provider>/callback`.
- App deep link on success: `junction://oauth-callback?provider=<provider>&status=connected`.
- Endpoints: `POST /integrations/<provider>/start|sync|disconnect`.

## Admin (single-owner)

Set `ADMIN_EMAIL` (Functions config or server `.env`) to stamp `admin=true` on that account only.
Refresh the ID token (sign out/in, or any Settings action calling `getIdToken(true)`) to pick it up.

## Voice

Settings > Voice backend chooses:
- **Realtime** — OpenAI's WebRTC voice API, low latency, needs the Functions/server relay above and
  sign-in.
- **On-device** — Android's own `SpeechRecognizer`/`TextToSpeech`, routed through your configured
  text provider. Higher latency, works with any provider, needs neither Firebase nor the server.

Either way: mic toggle mutes/unmutes input, Stop cancels the current response, Regenerate requests
a new one, text input stays available throughout.

## Privacy posture

- Notification ingestion, feed, chat history, memory, and the audit log are local-only by default.
- Sync requires explicit Google sign-in and an explicit Settings toggle (default off).
- Telemetry export is an explicit, owner-initiated action and contains aggregate metrics only —
  never message content or tool arguments (`evaluation/TelemetryExporter.kt`).
- No data leaves the device unless you enable sync, Realtime voice, the self-hosted server, or an
  egress tool call you've approved.

## Update pipeline / direct APK releases

**Latest debug build:** [splinchgit.github.io/Junction](https://splinchgit.github.io/Junction/) always serves the
most recent debug APK from `main`, rebuilt by the `publish-pages` job in `Build Android APK`
(`.github/workflows/android-build.yml`) on every push. The page is generated from the build that
produced the APK, so the version, short SHA, build timestamp, commit link and SHA-256 it displays
always describe that exact file. This is unsigned and meant for quick sideloading, not the signed
release flow below.

No version number is written into this README on purpose. The APK's version comes from
`versionName` in `app/build.gradle.kts` and is rendered into the download page at build time;
restating it here would just be a second copy to forget to update. The badges at the top are
evaluated by shields.io when the page loads, so they track the repo rather than the last time
someone edited this file.

Note that debug and release share `applicationId = "com.splinch.junction"` with no suffix, and the
debug build is signed with a different key. Installing a debug APK over a release install (or
running `connectedDebugAndroidTest`) therefore replaces the app and wipes its data — API keys,
chat history, durable memory facts and the notification/accessibility grants all go with it.

The `Android Release` workflow builds a signed APK + SHA-256 checksum on a `v*` tag push (repo
secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`). The app checks GitHub Releases, verifies the published checksum, and hands
the verified APK to Android's system installer — a checksum mismatch blocks installation before the
installer opens. This release flow is a direct tag-push build, not the spec's full
commit→draft-PR→independent-model-review→CI-gated pipeline; see the note in
`update/UpdateChecker.kt` / `platform/ShizukuInstaller.kt` for what's still open there.

## Device validation

```
.\gradlew :app:testDebugUnitTest --no-daemon
.\gradlew :app:connectedDebugAndroidTest --no-daemon
```
`connectedDebugAndroidTest` needs a running emulator or USB-debuggable device (CI provisions one
automatically). Before shipping, also verify on a real device: notification reply/dismiss only
touches the originating notification; an accessibility-driven `open_app` only reports success once
the target package is actually foreground; a Gmail draft keeps the thread's own recipient; a
PC-companion message never proposes or executes an action; Shizuku status only flips to available
once its own service is actually running; a corrupted release checksum blocks install.

## Local repo update helper

```
.\scripts\update.ps1
```
Runs `git pull` and refreshes web dependencies if present.

---

If build errors appear, share them and we will patch fast.
