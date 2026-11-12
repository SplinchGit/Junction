# Junction for Windows

Nethra includes local Ollama inference and a persistent objective scheduler, store, approvals,
checkpoints and evidence tracking. Android can use this runtime over paired LAN or the encrypted
relay; closing the phone UI does not stop authorised host objectives.

The October continuation adds shared model warming, readiness states, startup/retention settings,
interactive priority, structured situation context, objective progress and controls, quiet-hour
reporting, and persistent appearance choices (system/light/dark, Junction/Sakura/Moss and optional
Sakura Mountain artwork). See [verification and remaining gaps](../../docs/NETHRA_CONTINUATION_2026-10-24.md).

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
- Local-only default. No continuous screen capture or raw UI metadata upload. Authorised
  persistent objectives may poll connected sources and use scoped execution tools.
- Local desktop Chat, Feed, Audit, Context & devices, Settings, memory, provider
  routing/usage, and a keyboard-accessible conversation drawer.
- Built-in Junction Search with no API key or companion service: guarded public-HTTPS
  retrieval, DNS/IP pinning, zero destination redirects, bounded extraction, durable evidence
  jobs, and passage citations.
- An always-available local tool runtime for Ollama. Its schema-constrained loop may search up
  to three times across seven bounded model passes; deterministic egress and citation validation sit
  outside the model. Tool availability and execution scope depend on the approved workflow.
- **Codex on this PC** is a selectable chat workflow. It invokes the locally
  installed, ChatGPT-signed-in Codex CLI in read-only, ephemeral mode, so it
  uses the subscription attached to that CLI login instead of storing an API
  key. Settings shows whether that subscription-backed workflow is ready.
- A Mafioso menu destination that opens the hosted game when configured and the
  local Mafioso workspace during development.
- Explicit manual same-owner sync for authoritative conversations, immutable
  provenance, owner memory, and a read-only shared Feed.
- Persistent development work starts from an owner instruction in Chat. The owner
  names a local file, folder, or Git repository; Junction keeps that scope with the
  conversation, works from an isolated app-data checkpoint, verifies changes, and
  promotes the exact verified files with a rollback backup. Work Activity shows the
  live task, failures, tests, Codex waits, and an immediate Stop control.

The owner's paired Android chat can issue the same scoped instruction while the
Windows app is connected. Closing Windows pauses work; opening it does not silently
resume. Saying “continue” in the same conversation resumes it. Stop preserves the
queue, checkpoint, results, and handoff. Junction never imports an owner project
into the Junction source repository and never pushes unless the owner asks.

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

## Local Qwen models on Windows and Android

Choose **Local LLM** in either app. **Qwen3 30B** (`qwen3:30b`) remains the default
for chat and Nethra tasks. **Qwen3-Next 80B A3B Instruct · Q3_K_M** can be selected
for chat or individual Nethra tasks. A separate **80B Thinking · Q3_K_M** option
is available for longer reasoning, alongside the official **80B Thinking · Q4_K_M**.
All models use the same Nethra task,
plan, evidence, permissions and checkpoint; switching does not erase progress.
The existing 80B Instruct option uses the local Ollama alias
`junction-qwen3-next:80b-q3km`. To prepare another paired PC, run
`ollama pull hf.co/unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF:Q3_K_M`, then
`ollama create junction-qwen3-next:80b-q3km -f models/qwen3-next-80b-q3km.Modelfile`
from `apps/windows`. The alias shares the downloaded weights and fixes an upstream
chat template that otherwise returns empty replies. Existing selections of the
upstream tag migrate to the alias. Older unsupported local selections resolve to
30B. The installed 30B variant always uses native thinking; the existing 80B
Instruct alias does not.

To install the **separate Thinking weights** on the paired PC (from `apps/windows`):

```powershell
ollama pull hf.co/unsloth/Qwen3-Next-80B-A3B-Thinking-GGUF:Q3_K_M
ollama create junction-qwen3-next-thinking:80b-q3km -f models/qwen3-next-80b-thinking-q3km.Modelfile
ollama run junction-qwen3-next-thinking:80b-q3km "What is 17 times 23?"
```

This is an **opt-in 38.3 GB download**; Junction does not pull it automatically.
The corrected Thinking template pre-fills `<think>` so Ollama separates the
reasoning channel from content/tool calls. Check with `ollama show
junction-qwen3-next-thinking:80b-q3km`; select the Thinking model in Tasks
or the Local LLM picker after installing it. Nethra reserves up to 6,144 output
tokens for a Thinking task step (versus 1,536 for older models) with no forced
1,100-token thought cutoff; this can be substantially slower. Ollama may time
out or run out of memory on the current 32 GB RAM PC, even with the RTX 2060.
A successful model download is not proof that the Thinking model can actually
finish a tool call on this host. First run `node scripts/ollama-tool-smoke.js
junction-qwen3-next-thinking:80b-q3km` from `apps/windows`: it checks a real
structured tool call and a follow-up answer against a deterministic fake tool
result, and exits nonzero if either fails. Then test a small research-and-draft
Nethra task. This smoke requires the model weights and Ollama running locally.

For the official 48 GB Q4 Thinking weights, use this separate Ollama alias:

```powershell
ollama pull hf.co/Qwen/Qwen3-Next-80B-A3B-Thinking-GGUF:Q4_K_M
ollama cp hf.co/Qwen/Qwen3-Next-80B-A3B-Thinking-GGUF:Q4_K_M junction-qwen3-next-thinking:80b-q4km
```

Select **Qwen3-Next 80B Thinking · Q4_K_M** in Local LLM or **Thinking Q4** in
Tasks. The alias shares the official blob. Nethra sends native thinking on with
Qwen's recommended temperature `0.6`, top-p `0.95`, top-k `20` and min-p `0`.
Benchmarks retain their explicit temperature override. This profile uses an
8,192-token context and up to 2,048 output tokens. Chat and manual warm-up
request memory mapping (`use_mmap: true`) so Ollama can map CPU-side weights
from disk. The normal automatic and CPU-only cold loads timed out on the
32 GiB RAM / 12 GiB VRAM PC. Memory mapping started inference there, but
generation can still be slow. The Q4 model loads on demand, with 30B as the default.

Keep Junction and Ollama running on the paired PC. Android uses the authenticated
LAN connection or the separately selected encrypted relay mode; weights stay on
the PC. Both platforms use the existing agent runtime with native tools, a 16K
context budget, and one active model request at a time. Web research requires
internet. Coding work uses the existing explicitly requested Codex workflow.

The 30B model is approximately 19 GB. On this PC it was observed running
45% GPU / 55% CPU at a 4096-token context and about 22–24 output tokens/second
once loaded. Keep free space for Windows' paging file and enough system RAM for
the portion not resident in VRAM. Junction World uses this model too. The Q3_K_M
80B model is about 38 GB and exceeds this PC's 32 GB physical RAM; partial GPU
offload and paging may make it slow or unable to load while other apps are open.

Rebuild the Windows runtime and Android APK to update the selectors and defaults.

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

## Nethra tasks, warm-up and appearance (October 2026)

Current status and measurements: [`docs/NETHRA_DELIVERY_2026-10-25.md`](../../docs/NETHRA_DELIVERY_2026-10-25.md).

- **Model readiness.** The chat header shows whether `qwen3:30b` is loaded. Junction loads it when
  you open Junction (Settings → Model readiness: launch, sign-in or never), open or start a chat,
  start voice on the phone, or shortly before a task needs it. Loading never writes a message.
  Measured here: a cold first reply took 73.6 s; after warm-up it took 7.5 s.
- **Tasks.** Create one in Tasks (or ask in chat). Each task has its own chat where Nethra posts
  real progress and asks what it needs; reply there to steer it. Tasks can work continuously, and
  can be paused, checked now, edited, redirected, stopped or deleted. Background work yields to
  your messages.
- **Appearance.** Settings → Appearance: light/dark, palette, Sakura Mountain artwork, petals and
  motion. Reduced motion in Windows is respected.


### Nethra P0 verification

The task detail header exposes Delete before progress; its normal view keeps diagnostics collapsed. The existing deletion endpoint now fences execution, keeps deletion tombstones and retries failed cleanup. The ordinary conversation is retained.

Run `npm test`, then `node_modules/.bin/electron scripts/nethra-delete-ui-smoke.js` for isolated renderer/IPC/SQLite deletion verification (network and inference disabled). `npm run pack` creates the complete directory runtime under `dist/win-unpacked`; keep the executable beside `resources`. For a packaged SQLite check, run `scripts/nethra-package-smoke.cjs` with that runtime under `ELECTRON_RUN_AS_NODE=1`. These checks use temporary profiles and do not install over the active owner runtime.

For upgrade, schema and Android installation/verification details, see `../../docs/NETHRA_P0_DELIVERY.md`.
