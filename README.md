# Junction

[![Download APK](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsplinchgit.github.io%2FJunction%2Flatest.json&query=%24.version&prefix=%E2%AC%87%20&label=DOWNLOAD%20APK&color=4f7cff&style=for-the-badge)](https://splinchgit.github.io/Junction/junction-debug.apk)

That button is the whole install, and the version on its face is read live from the build it is
serving — not typed here. It downloads the APK itself: no landing page, no picking a file. Every push
to `main` overwrites it in place at a URL that never changes, so it is always the newest build, and
it is the only download link in this README on purpose.

You should only ever need it once. After that Junction updates itself: it checks the same URL, and
installs over itself keeping your API keys, chat history and memory. Same app, same key, one version.

[![APK build](https://img.shields.io/github/actions/workflow/status/SplinchGit/Junction/android-build.yml?branch=main&style=flat-square&label=APK%20build)](https://github.com/SplinchGit/Junction/actions/workflows/android-build.yml)
[![Updated](https://img.shields.io/github/last-commit/SplinchGit/Junction/main?style=flat-square&label=main%20updated)](https://github.com/SplinchGit/Junction/commits/main)

Status, not downloads — and live rather than written down, so they cannot go stale. If "APK build" is
not passing, the button is still serving the last APK that built successfully, which will be older
than `main`. Installing it over an older Junction keeps your API keys, chat history and memory: every
published build is signed with the same key and carries a higher version code than the one before.

Junction is a personal assistant that spans an Android phone and a Windows PC. It can chat through
cloud models, a subscription-backed Codex installation, or a small model running on your own PC;
act on the phone behind explicit trust controls; share selected state between your devices; and
delegate coding work into isolated Git worktrees for review.

The model is replaceable. Junction is the part that remembers, routes, checks, asks permission,
executes, verifies, and keeps a record.

## The short version

- **Android is the mobile agent.** It owns phone actions, voice, notifications, durable local
  memory, the trust gate, plan approval, execution, verification, and the audit trail.
- **Windows is the home base.** It has local chat and memory, optional account sync, bounded desktop
  context, built-in web research, model/provider selection, and a Projects command centre for Codex
  coding agents.
- **Local Junction Brain connects them.** Pair the phone to the PC with a QR code and Android can use
  the PC's loopback-only Ollama model over an end-to-end encrypted Firebase relay. The model endpoint
  is never exposed to the LAN or internet.
- **Cloud reasoning is optional.** Android and Windows can use OpenAI, Anthropic, DeepSeek, and
  compatible providers with per-device encrypted keys. Windows can also use the locally signed-in
  Codex CLI and its ChatGPT subscription.
- **Sync is optional.** Both applications work locally. Firebase is used only for features the owner
  enables: shared conversations, memory/feed convergence, device identity, remote phone requests,
  and Local Brain transport.

## A useful mental model

```text
                         optional Firebase fabric
                    (identity, sync, encrypted relay)
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
      Android Junction                        Junction for Windows
      ────────────────                        ────────────────────
      chat and voice                         desktop chat and memory
      phone context/actions                  bounded PC context
      trust and approvals                    local web research
      plans and verification                 Codex project delegation
              │                                       │
       cloud providers                    cloud providers / Codex / Ollama
```

Junction is deliberately not a single giant autonomous process. Each capability has a narrower
boundary, and crossing a consequential boundary requires an owner action or a fixed policy decision.

## What works today

| Capability | Android | Windows |
| --- | --- | --- |
| Multi-conversation chat and local history | Yes | Yes |
| Durable owner-confirmed memory | Yes | Yes |
| OpenAI, Anthropic, DeepSeek, compatible providers | Yes | Yes |
| Small local Ollama model | Through a paired PC | Directly on the PC |
| Codex using a ChatGPT subscription | No direct route | Read-only chat and coding delegation |
| Voice | Realtime or Android speech/TTS | Not connected yet |
| Notification and screen context | Android notifications and Accessibility | On-demand, read-only UI Automation metadata |
| Tool/agent mode | Phone tools for cloud models; paired read-only Local Agent | Bounded Local Agent plus separate Codex Projects |
| Web research | Through the paired Local Agent | Built-in Junction Search and full-page evidence extraction |
| Phone actions | Gated, approved, verified, audited | Not applicable |
| Desktop actions | Not remotely exposed | Read-only inspection; no broad desktop mutation |
| Cross-device state | Opt-in conversations, memory, feed and preferences | Opt-in conversations, memory and read-only feed |
| Self-update | Permanent, checksum-verified APK channel | No signed update channel yet |

“Yes” means implemented in this repository. It does not mean every OEM, provider, account, or
physical-device path has been validated. The remaining external and hardware-dependent gaps live in
[`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

## Reasoning paths

Junction chooses a reasoning engine; it does not pretend every engine has the same abilities.

### Provider chat

Android supports Anthropic, OpenAI, DeepSeek, and custom OpenAI-compatible endpoints. Windows adds
Groq and stores every provider key separately using Windows `safeStorage`/DPAPI. Android secrets are
held in encrypted device storage. Keys never synchronize between devices.

Android has a workhorse/frontier split and health-aware fallback across providers the owner has
already configured. A failed local-provider request is never silently rerouted to a paid cloud
provider.

### Codex on this PC

Windows can use the installed Codex CLI as a chat workflow. It uses the ChatGPT account already
signed into that CLI, needs no API key in Junction, and runs ordinary chat read-only.

Coding is a different workflow. From **Projects**, one instruction may target up to three named Git
repositories. After explicit approval, Junction gives each project its own branch, worktree, and
Codex thread. Work stops for owner decisions, survives Junction restarts, respects confirmed Codex
capacity windows, and cannot merge until the reviewed base commit, head commit, and binary diff hash
still match. Junction never pushes or auto-merges.

See [`docs/DELEGATION_V1.md`](docs/DELEGATION_V1.md) for the exact contract and current hardening gaps.

### Local Junction Brain

Windows can host a small Ollama model on `127.0.0.1`. Pairing creates independent device identities
and a 256-bit secret stored in Android's encrypted storage and Windows DPAPI storage. Requests and
streamed responses travel through Firebase as ciphertext bound to the brain, request, and message
stage; Firebase does not receive the conversation plaintext.

Ordinary Local Brain chat has no network, computer, scheduling, or source tools. When the owner
explicitly enables **Tools** for a phone conversation—or **Agent** for one Windows message—the PC
runs a separate bounded Local Agent. It may perform up to three safe searches over five decisions,
but it cannot mutate either device, send messages, schedule work, or edit code. Every generated
query passes a deterministic egress check before it leaves the PC.

A local model cannot turn a hallucinated marker into an action. Coding-agent work still starts
locally from Windows **Projects** and is handed to Codex behind its own approval and review flow.

### Web research

The Windows chat has a one-message **Research** toggle. Junction Search discovers results through a
public, no-key search endpoint, then retrieves selected pages itself. It accepts only HTTPS public
hosts, resolves and pins public addresses before every request, refuses destination redirects,
limits response sizes and content types, extracts bounded text, labels it as untrusted evidence, and asks
the selected model to cite source passages. Research does not grant the model network access or tools.

**Agent** mode lets the local model request follow-up searches one at a time. Junction owns the
durable job ledger, source deduplication, evidence budget, citation validation, and stopping rules.
The model sees only bounded extracted passages and receives a validation error if it invents or omits
evidence citations.

## Trust is part of the runtime

Junction reads hostile or instruction-shaped material while also possessing useful capabilities.
That cannot be made safe with a stern system prompt, so the controls sit outside the model.

- **Reader/actor separation.** Untrusted email and captured content go through a tool-free reader
  path that produces constrained structured output. The actor never receives raw untrusted text as
  authority.
- **Persistent provenance.** Context is labelled `OWNER`, `JUNCTION`, or `UNTRUSTED`. Summarizing
  untrusted material does not make it trusted.
- **Owner-trigger requirement.** Only a live owner-triggered turn may initiate a state-changing
  phone tool call. Synced messages, notifications, webpages, and model output are not owner intent.
- **Fixed risk tiers.** Tool definitions declare `READ`, `INAPP`, `OUTBOUND`, or `DESTRUCTIVE` risk.
  The model cannot lower its own risk or approve its own plan.
- **Bound approvals.** Approval is tied to the disclosed plan. Execution, post-condition checks,
  recovery, cancellation, and the final outcome are audited.
- **Fail-closed egress.** Unknown tools, malformed arguments, unsafe recipients, changed plans, and
  unsupported state are rejected rather than guessed through.

This is containment, not a claim that prompt injection has been “solved.” The aim is to prevent
untrusted content from silently acquiring authority and to keep the blast radius visible and small.

## Android capabilities

- Feed, Chat, Audit, Settings, conversation shelf, and durable Room persistence.
- Notification ingestion, reply, dismiss, and digest workflows.
- Accessibility-based `read_screen`, `tap_element`, `set_text`, scroll, Back, and Home with
  low-fidelity and secure-surface checks.
- Gmail triage, draft, send, archive, and unsubscribe with thread-recipient constraints.
- Typed multi-step plans with owner approval, interruption/resume, verification, and recovery.
- Realtime voice or an on-device speech-recognition/TTS loop, including foreground call handling.
- Calendar reminders, GitHub source inspection, reviewable PR proposals, and verified self-update.
- Optional same-owner Firebase sync and an owner-authenticated remote-command channel.

## Windows capabilities

- Native Electron application with local conversations, memory, provider usage estimates, Feed,
  Audit, Settings, and keyboard-accessible navigation.
- Per-install device identity; Google/Firebase sign-in through the system browser with PKCE.
- Provider secrets encrypted with Electron `safeStorage`; Firebase refresh tokens protected by DPAPI.
- On-demand foreground-app inspection through Windows UI Automation. It records bounded structured
  metadata, not screenshots, and does not provide coordinate clicking or broad automation.
- Manual, opt-in convergence of supported conversations and owner memory plus a read-only shared
  mobile Feed.
- Direct local Ollama chat, subscription-backed Codex chat, built-in Junction Research, encrypted
  Local Brain relay, bounded Local Agent, and isolated Codex project delegation.

The Windows client is becoming a first-class part of Junction, but it is not yet at Android parity:
voice, notification ingestion, integrations, mutation tools, signed distribution, and automatic
updates still need Windows-native implementations.

## Privacy and data flow

- Chat history, Feed, memory, provider usage, and audit data are local by default.
- Sync does nothing until the owner signs in and enables it on each device.
- Provider keys, raw screenshots, raw PC context, tool arguments, local audit rows, and pairing
  secrets are not synchronized.
- Shared messages are immutable and provenance-labelled. Deleted conversations and memories use
  tombstones so another device cannot silently resurrect them.
- PC context is collected only on request, reduced locally, kept in renderer memory, and attached to
  one explicit chat request only when the owner chooses.
- Local Brain plaintext exists only at the paired endpoints. Firebase carries encrypted envelopes
  and bounded operational state.
- Telemetry export is explicit and aggregate-only; it excludes message content and tool arguments.

The shared-state protocol is documented in [`docs/SHARED_STATE_V1.md`](docs/SHARED_STATE_V1.md).

## Install and run

### Android

For normal use, tap the APK button at the top of this README. Android will ask you to allow installs
from the browser or file manager you used. Junction handles later updates through the same artifact.

On first run, choose a provider in Settings and add its API key, or pair a Windows Local Brain. The
app works without Firebase unless you want sync, remote requests, Realtime voice, or PC pairing.

### Windows development build

```powershell
cd apps/windows
npm install
npm test
npm start
```

Optional launch configuration:

```powershell
$env:JUNCTION_FIREBASE_API_KEY = '<firebase web api key>'
$env:JUNCTION_FIREBASE_PROJECT_ID = '<firebase project id>'
$env:JUNCTION_GOOGLE_DESKTOP_CLIENT_ID = '<desktop OAuth client id>'
```

Firebase values enable identity, shared state, and Local Brain pairing. Web research needs no key or
separate search service. For local inference, run Ollama on its standard loopback endpoint and select the
local model in **Settings → AI & models**. For Codex workflows, install Codex, run `codex login`, and
select **Codex on this PC**.

Package Windows with `npm run pack` for an unpacked build or `npm run dist` for an NSIS installer.
The installer is currently unsigned, so SmartScreen will warn.

### Android development build

1. Open the repository in Android Studio.
2. Select the `app` configuration; the Gradle module lives at `apps/android`.
3. Add any local provider/Firebase values to `local.properties` as described in
   [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md).
4. Sync Gradle and run on an emulator or device.

Firebase is optional at build time. If `apps/android/google-services.json` is absent, the Google
plugins are not applied and local chat still builds.

### Optional server components

- `services/functions` provides the OpenAI Realtime SDP/client-secret exchange.
- `services/server` provides the self-hosted Realtime relay, OAuth integrations, and single-admin
  claim helper. It is not the normal text-chat backend.
- `services/pc-companion` is the loopback-only Windows platform adapter used for bounded local
  context and Ollama compatibility.
- `apps/web` is the earlier React/Vite read-only web companion.

Deploy the checked-in Firestore contract before enabling shared state or pairing:

```powershell
firebase deploy --only firestore:rules
```

## Repository layout

```text
apps/android/          Android app and trust-controlled mobile runtime
apps/windows/          Native Windows client and local command centre
apps/web/              Read-only web companion
avatar/                Reusable Android avatar renderer
services/functions/    Firebase functions for Realtime support
services/server/       Optional integrations and relay server
services/pc-companion/ Loopback Windows platform adapter
services/build-calculator/
tools/companion/       Local diagnostic/control CLI
docs/                  Architecture, protocols, limitations, and validation notes
```

The Android package map is in [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md); the broader runtime
design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Update pipeline / direct APK releases

**One URL, always the newest build:**
`https://splinchgit.github.io/Junction/junction-debug.apk` is the APK file itself, not a page about
it. The `publish-pages` job in `Build Android APK` (`.github/workflows/android-build.yml`) overwrites
it on every push to `main`, so the link is permanent and its contents are whatever `main` last built.
The README button points straight at it; nothing else in this README downloads anything.

Three companion files sit next to it, deliberately not linked above so there is only ever one thing
to tap: `junction-debug.apk.sha256` (checksum of the exact file being served), `index.html` (a page
stating version, build date, commit and SHA-256 of that same file), and `latest.json` (the same facts
as machine-readable JSON).

**`latest.json` is what makes updates seamless.** `UpdateChecker` fetches it and compares
`versionCode` against `BuildConfig.JUNCTION_VERSION_CODE`; if the published build is higher,
`UpdateInstaller` downloads the APK, verifies it against the published SHA-256, backs up the
currently installed APK for one-tap rollback, and hands it to Android's installer. Because that is
the *same* file the button serves, signed with the *same* key, it installs over the running app and
keeps API keys, chat history, durable memory and your permission grants. You tap the README button
once, ever; after that Junction updates itself.

This deliberately replaced a check against GitHub Releases, which was broken two ways. Releases were
built from `v*` tags by a separate `Android Release` workflow and signed with a *different* key, so
an APK offered from there could never install over a button-installed build — Android rejects the
signature mismatch and the only way through is an uninstall, which destroys exactly the data above.
And the comparison was on `versionName`, a hand-edited string that stays `0.5.0` across hundreds of
builds, so no published build ever looked newer in the first place.

That workflow has been deleted, along with the second signing key it needed. There is now one
Junction: one artifact, one key, one URL, one version code that only goes up. Two distribution
channels signed with two keys is not a richer release process — on Android it is just a guarantee
that one of them can never update the other.

No version number is written into this README by hand. The download badge is a shields.io dynamic
badge reading `$.version` out of `latest.json`, so its face is the version of the build it links to,
resolved when the page loads. The two status badges work the same way against the repo. Nothing in
this section can drift from reality by someone forgetting to edit it.

**Published builds are signed with a stable, committed debug key.** `apps/android/debug.keystore` is checked
into the repo — an exception to the `*.keystore` ignore rule — because CI has to sign with the *same*
key every run. Without a fixed key Gradle generates a throwaway one per build, Android refuses to
install the new APK over the old one, and the only way through is to uninstall first, destroying API
keys, chat history, durable memory facts and the notification/accessibility grants on every update.

Committing it is safe precisely because it is a debug key: its credentials are the public Android SDK
constants (`android` / `androiddebugkey`, hardcoded in `apps/android/build.gradle.kts`), so it protects
nothing and identifies nothing. It only has to be *stable*. The release keystore is a real secret and
stays gitignored, injected from `ANDROID_KEYSTORE_BASE64` at tag time.

`ANDROID_DEBUG_KEYSTORE_BASE64` still works as an override: if that repo secret is set, the workflow
decodes it over the committed file before building. Set it only if you want published builds signed
with a key that isn't public — and keep it backed up, because losing it breaks updates for everyone
who installed a build signed with it.

Version codes come from CI, not from a hand-edited release counter. Published builds use
`100000 + github.run_number`, placing them above legacy builds while making every subsequent push
strictly newer to Android. The manifest and APK derive the code from the same run number; local
builds fall back to the start of that reserved range.

One caveat remains for anyone building locally: `connectedDebugAndroidTest` against a phone that has
Junction installed replaces the install, with the same data loss, because the instrumentation build
does not carry the published version code.

## Junction changing its own code

Android can inspect bounded excerpts from the fixed `SplinchGit/Junction` repository and propose a
multi-file pull request on a new `junction/...` branch. It cannot target `main`, edit workflows, or
read/write signing and local secret material. The exact payload requires on-screen approval;
“always allow” is unavailable.

CI must pass before Junction offers a separate merge action. The branch must still be mergeable and
the owner must approve again. A merge triggers the normal APK pipeline above.

Windows delegation is broader but remains local: Codex works in isolated worktrees, Junction binds
review to the exact diff, and only the owner can merge. Neither path grants the model authority to
rewrite Junction silently.

## Validation

```powershell
# Android unit tests and build
.\gradlew :app:testDebugUnitTest :app:assembleDebug --no-daemon

# Android instrumentation tests (device or emulator required)
.\gradlew :app:connectedDebugAndroidTest --no-daemon

# Windows client
cd apps/windows
npm test

# Loopback companion
cd ../../services/pc-companion
npm test
```

Before trusting phone actions in daily use, validate notification replies, Accessibility targeting,
Gmail recipients, voice background behaviour, Shizuku state, pairing/revocation, and corrupted-update
rejection on a physical device. Before treating Windows delegation as merge automation, independently
rerun project tests and inspect the preserved worktree and diff.

## Current boundaries

- No wake-word detector or Bixby remap.
- No bundled Android keyboard fallback for apps that reject Accessibility text entry.
- APK installation still ends in Android's system confirmation UI; it is not fully silent.
- The Local Agent has read-only web research, not arbitrary computer or state-changing tools.
- Junction Search relies on a public no-auth discovery endpoint; the guarded retrieval, extraction,
  evidence, citation, and agent layers are Junction-owned, but Junction does not operate a web index.
- Windows desktop context is read-only and collected only on request.
- Windows distribution is not signed and has no automatic updater.
- Shared-state retention and Android cursor pagination need hardening for large-scale use.
- Device/OEM-dependent paths still require physical-device validation.

Those boundaries are design constraints until their trust, lifecycle, and failure behaviour are
implemented—not promises delegated to a model.

## Local repo update helper

```powershell
.\scripts\update.ps1
```

Runs `git pull` and refreshes web dependencies if present.
