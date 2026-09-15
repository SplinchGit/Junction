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
- Built-in Junction Search with no API key or companion service: guarded public-HTTPS
  retrieval, DNS/IP pinning, zero destination redirects, bounded extraction, durable evidence
  jobs, and passage citations.
- An always-available local tool runtime for Ollama. Its schema-constrained loop may search up
  to three times across seven bounded model passes; deterministic egress and citation validation sit
  outside the model, and no mutation tools are exposed.
- **Codex on this PC** is a selectable chat workflow. It invokes the locally
  installed, ChatGPT-signed-in Codex CLI in read-only, ephemeral mode, so it
  uses the subscription attached to that CLI login instead of storing an API
  key. Settings shows whether that subscription-backed workflow is ready.
- A Mafioso menu destination that opens the hosted game when configured and the
  local Mafioso workspace during development.
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

Cloud/API-backed reasoning and local Ollama are both supported reasoning paths.
Junction never downloads a model automatically. Local chat's tool-capable runtime uses the
owner's loopback-only Ollama installation when explicitly selected.

To use the Codex chat workflow, install the Codex CLI and sign in on the same
Windows account (`codex login`). Then choose **Codex on this PC** and a model in
Settings → AI & models, and save. Junction sends the current bounded chat
context to a fresh local Codex CLI turn; it cannot edit files or run tools from
this chat workflow. Project delegation remains a separate, explicitly approved
workflow.

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
$env:JUNCTION_MAFIOSO_URL = '<optional hosted Mafioso URL>'
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

To create a working Desktop shortcut for that unpacked build, run:

```powershell
npm run pack:workspace
npm run desktop
```

The shortcut targets the complete `dist\\workspace-win-unpacked` runtime and sets
its working directory. Do not copy only `Junction.exe` to the Desktop: Electron
also needs the adjacent `resources\\app.asar` and `resources\\pc-companion` files.

Validate on an interactive Windows desktop: install, confirm a stable device ID
across restart, sign in through the system browser, opt in, and check the matching
Firestore device document. Then foreground Notepad and inspect it; verify the
result is structured UI Automation metadata marked `UNTRUSTED`, and that the local
audit JSONL contains proposal/outcome metadata but no Notepad text.

The application currently has no code-signing configuration. Windows SmartScreen
will warn on unsigned installers; production distribution requires an Authenticode
certificate and CI signing. Elevated apps and custom-rendered/game surfaces may not
expose usable UI Automation metadata. No broad automation is implemented.

## Local model reliability and live search verification

Desktop and paired-phone inference share a serialized runtime. Switching models
unloads other resident Ollama models to avoid memory allocation failures. Prompt
history, evidence, and output are bounded for the 4K context on CPU-only hosts.

For current-fact or explicit search requests, Junction executes web search before
inference, supplies the returned evidence as a tool result, and validates passage
citations. This is host-enforced search, not a claim that the model independently
decided to browse. Required search failures stop the request instead of falling
back to model memory. Citation validation checks IDs, not every claim's meaning.

Run `npm test` for deterministic regressions. Run
`node_modules/.bin/electron scripts/junction-ui-smoke.js` for all four installed
models (append a model name to test just one). The latter uses an isolated profile
and the real renderer/preload/IPC path. Its 2026 World Cup test records live search
HTTP responses, exact evidence delivered to inference, and supporting citations;
the independent expected answer is never included in the prompt. It also blocks
search deliberately and requires zero model calls and no answer. Inspect
`test-results/junction-websearch-2026.json` and the `web2026-*.png` screenshots.

The local-model fixes run on the paired Windows PC. Updating the Android APK alone
does not update that runtime; rebuild the Windows package as well.
