# Junction for Windows

This Electron app packages the local PC companion as a native Windows install and
adds the first same-owner account-linking foundation. The local companion starts
inside the app on an ephemeral loopback port with a random in-memory bearer token;
it is never exposed to the LAN.

## What works

- Stable per-install Windows device identity.
- Native Google OAuth using the system browser, PKCE, and a temporary loopback
  callback, followed by Firebase Auth exchange. No embedded-login webview.
- Explicit opt-in device registration under `users/{uid}/devices/{deviceId}`.
- Firebase refresh tokens encrypted with Electron `safeStorage` (Windows DPAPI).
- One-click, explicit foreground-app UI Automation inspection through the existing
  typed OWNER-provenance proposal and audit pipeline.
- Local-only default. No polling, screenshot capture, continuous context upload,
  raw UI metadata sync, or desktop mutation capability.
- Local desktop Chat, Feed, Audit, Context & devices, Settings, memory, provider
  routing/usage, and a keyboard-accessible conversation drawer.
- Explicit manual same-owner sync for authoritative conversations, immutable
  provenance, owner memory, and a read-only shared Feed.
- A local Projects command centre for up to three repositories. It refuses dirty
  or non-Git inputs, creates isolated branches/worktrees only after plan approval,
  preserves decision requests and progress, and binds merge approval to the exact
  reviewed base/head/diff hash.

Delegation never starts through Firestore or another linked device. It is a local
owner action, does not auto-merge or push, and cancellation preserves the branch
and worktree for inspection. On this machine the current Junction and Mafioso
trees are dirty and Civlets is not a Git repository, so they correctly appear as
`needs setup` until the owner prepares them.

## Cloud and credential policy

Cloud/API-backed reasoning is the intended reasoning path for this Windows app.
Ollama discovery remains in the local service only as a harmless optional status
check; it is not selected by default and no model is downloaded.

Provider API keys are deliberately **per device**. A future Windows provider setup
must encrypt them with `safeStorage`; they must never be written to Firestore or
copied from Android. Firebase authentication credentials identify the owner but do
not grant an LLM provider credential.

Account sync is opt-in. Even when enabled, PC context should be collected only for
an explicit owner request, reduced locally to relevant structured fields, labelled
`UNTRUSTED`, and sent only as part of that request. It must not be cached in cloud
history by default. The current UI keeps the snapshot in renderer memory only.

## Development setup

Create a Google OAuth client of type **Desktop app** in the same Google Cloud
project used by Firebase Authentication, and enable Google as a Firebase sign-in
provider. Set these variables in the launch environment (do not commit them):

```powershell
$env:JUNCTION_FIREBASE_API_KEY = '<firebase web api key>'
$env:JUNCTION_FIREBASE_PROJECT_ID = '<firebase project id>'
$env:JUNCTION_GOOGLE_DESKTOP_CLIENT_ID = '<desktop oauth client id>'
npm install
npm test
npm start
```

Deploy the updated root `firestore.rules` before enabling device registration.
Firebase configuration IDs are not secrets, but keeping environment-specific
values outside source prevents accidentally pairing a development build to the
production project.

## Packaging and validation

```powershell
npm run pack   # unpacked smoke-test build
npm run dist   # NSIS installer
```

In a restricted environment where the builder cannot access its standard Windows
cache, `npm run pack:workspace` assembles an equivalent unpacked smoke-test app
from the already downloaded Electron runtime entirely inside the repository. It
does not create an installer or replace the production `pack`/`dist` commands.
Set `JUNCTION_PACK_OUTPUT` to a simple directory name when a prior smoke-test
runtime is still locked (for example `parity-win-unpacked`); the packer never
targets a path outside `apps/windows/dist`.

Validate on an interactive Windows desktop: install, confirm a stable device ID
across restart, sign in through the system browser, opt in, and check the matching
Firestore device document. Then foreground Notepad and inspect it; verify the
result is structured UI Automation metadata marked `UNTRUSTED`, and that the local
audit JSONL contains proposal/outcome metadata but no Notepad text.

The application currently has no code-signing configuration. Windows SmartScreen
will warn on unsigned installers; production distribution requires an Authenticode
certificate and CI signing. Elevated apps and custom-rendered/game surfaces may not
expose usable UI Automation metadata. No broad automation is implemented.
