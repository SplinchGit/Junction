# Nethra implementation and verification

## 22 October 2026 Qwen3 30B and UI update

The current implementation and verification are recorded in [NETHRA_30B_UI_DELIVERY_2026-10-22.md](NETHRA_30B_UI_DELIVERY_2026-10-22.md). The 14B results below are historical evidence from earlier builds. The current local model is `qwen3:30b`, whose installed variant requires thinking to remain on. The packaged Windows host and Android versionCode 100152 use that model; the 14B Ollama model has been removed. Windows chat now keeps Chat and Audit as primary navigation, with the other pages in More. Objectives remain accessible from chat. The current Android APK passed build and unit tests but has not been installed or smoked on a phone because ADB is unavailable.

## 22 October 2026 agent-mode continuation

The latest Android chat database was read from the connected SM_A528B (versionCode 100148, SQLite integrity `ok`). It records a successful response over the phone hotspot and the owner's question about calling agent mode from chat. The response incorrectly said agent mode was unavailable. The underlying gap was real: Nethra's API and task panels existed, but normal chat only routed to the separate Foreman work handler or to unconstrained model prose.

Explicit Nethra chat commands now route on the Windows host before inference on desktop, authenticated LAN and encrypted relay paths. `Nethra, research <topic>` and `Start a Nethra goal: <objective>` create durable objectives tied to the conversation; `Nethra status` lists saved work; `Nethra pause/resume/cancel <task-id>` uses current revisions. Capability questions receive a truthful answer without creating work. Other conversation remains ordinary chat. The local model's deployment context now describes Nethra accurately.

An observed live `qwen3:14b` objective exposed budget heartbeats that wrote one history event and changed the task revision every second. Inference usage now persists without those event/revision changes. A fresh live run completed in 9.64 seconds, read an approved file, wrote the expected draft, and produced no `BUDGET` events. Windows `npm test` passes 100/100 in its final Nethra group; the 29-check scripted restart/wake/child/approval acceptance also passes. These numbers do not prove a complete live long-running acceptance on physical devices.

The packaged PC runtime and Desktop shortcut now target `apps/windows/dist/nethra-agent-chat-20261022`. The Windows sign-in recovery task targets the same executable. The active process listens on the current phone-hotspot IP `10.161.36.129:43111`, Tailscale `100.95.8.42:43111`, and the local VirtualBox adapter. Junction's dedicated API uses pinned TLS and paired-device authentication on these interfaces; Ollama stays loopback-only. The user reports hotspot PC/phone chat working; hostel Wi-Fi remains unavailable, consistent with client isolation. No new Android APK was pushed in this stage, so the previous Android install/build smoke evidence applies.

Physical Android verification after the host deploy: `Nethra status` returned the PC's saved task IDs in chat. A phone chat command then created objective `20b1807f-89a2-4181-b08d-df432f2271a2`; the host scheduler claimed it, the live `qwen3:14b` model planned and called `write_draft`, and the phone Nethra panel showed `COMPLETED` with the stored summary. The actual `phone-agent-proof.md` contains `Junction phone agent mode verified 22 October 2026`; its SHA-256 matches the durable evidence receipt. After forcibly restarting the Windows host, Android refreshed the same completed objective from the host. The physical phone also answered `Is agent mode callable in chat` with the new truthful command guidance. Screenshots: `artifacts/junction-phone-nethra-status-chat.png` and `artifacts/junction-phone-nethra-completed-after-host-restart.png`. `ollama ps` showed `qwen3:14b`, 4096 context, 100% GPU during this verification. Final Windows `npm test` passed 101/101; the scripted acceptance passed 29/29.

Independent read-only security and test reviews found four confirmed defects after the first phone success. An authenticated LAN socket survived device-key replacement; Resume could bypass waiting/blocked states; a repeated chat control with one request ID failed after its first revision change; and multiple large approvals could overflow Android's bounded response. These are repaired with regressions. Approval detail now sends one pending action at a time; if exact content cannot fit, Android requires review on Windows before approval. Pausing and resuming preserves pending input, rejected actions and sleeping wake times. Windows `npm test` passed 105/105 and the scripted acceptance still passed 29/29 after these repairs.

Android versionCode `100149` (APK SHA-256 `42F7E1300ADDC3E7582DDF8D82FF83D5DA3A45EF4488173D2BBB9537A9FFE509`) was built and installed in place after 166/166 unit tests. Its physical smoke passed: Junction launched, the Nethra panel recovered the completed phone-created objective, and recent logcat contained no fatal exception. A final live `qwen3:14b` tool loop after the audit fixes completed in 9.47 seconds with real file read/write and no budget-event flood. The packaged Windows host and recovery task use `apps/windows/dist/nethra-agent-chat-20261022`. Keeping this stable executable path matters because Windows inbound firewall authorization appears path-specific: a build launched from a new output directory listened locally but timed out from the phone; returning to the previously working path restored phone-to-PC TCP reachability. The latter is an inference from the observed path switch and TCP tests; the firewall rule itself could not be inspected without administrator access.

The live `qwen3:14b` approval-and-restart test found and repaired one more replay defect: after an approved overwrite, a repeated `request_approval` call incorrectly left the goal waiting again. A completed action now returns its persisted receipt only when the written file still matches its hash. The rerun requested approval for an existing file, left it untouched, reopened the task store, approved the exact replacement, wrote the file, and completed. Evidence is in `artifacts/nethra-live-approval-smoke.json`. Windows `npm test` passed 105/105 and the 29-check scripted acceptance passed again. The repaired host was repackaged at the stable executable path and restarted; its hotspot listener accepted a physical phone TCP connection.

Remaining checks: validate a full live future wake across host sleep or reboot, test physical hostel Wi-Fi only if revisited, and exercise large approval review on the installed phone. Do not classify the entire platform as production-ready yet.

## 21 October 2026 host and agent repair

The current packaged host is `apps/windows/dist/nethra-agent-win-final`. Its Desktop shortcut and Windows sign-in task target that directory. The process responded after launch, and its authenticated LAN listener accepted a TCP connection on the PC at `10.164.57.103:43111`. This is host availability on Windows; an Android round trip was unavailable because `adb devices -l` listed no attached phone during this repair.

Three confirmed defects were repaired: completed draft receipts could claim success after the file changed; an unrelated draft could satisfy a report objective; and a list of 100 Unicode objectives could exceed the encrypted transport frame. Draft completion now checks the current file hash and relevant evidence. The list keeps task IDs while trimming previews to the transport limit. Bounded child tasks now have durable records with parent IDs, scope, model, tool limits, result schema, and crash interruption state. Children remain sequential and are not independent scheduler jobs.

Fresh verification: full Windows `npm test` passed (final group 74/74); the deterministic restart/approval acceptance passed 29 checks with scripted inference; a live `qwen3:14b` run read a real approved file, wrote a draft and completed with the expected witness. The model was observed on the GPU with a 4096-token context. Five key package files matched source byte-for-byte, and the final host and shortcut launched. No new Android APK was built or pushed in this repair, so the prior APK smoke result below remains the latest device UI evidence. Hostel Wi-Fi phone connectivity, cross-device state retrieval, sleep/reboot recovery, and the full 14-step live acceptance remain unverified. The overall platform is not yet production-ready.

This checkout continues the approved Junction/Nethra master task on `feat/nethra-durable-agent`. It contains inherited uncommitted work from the interrupted session. This report is updated as verification finishes; passing unit tests alone do not establish production readiness.

## Architecture decision

Keep Junction's Electron/CommonJS host, native Ollama API and existing paired transports. Add a separate Nethra objective runner beside the existing coding Foreman. The Foreman remains the scoped Codex development workflow; Nethra now uses only `qwen3:30b` for local objectives and bounded child work.

| Component | Responsibility |
| --- | --- |
| `nethra-store.js` | SQLite WAL database, transactions, schema version, objective state, fenced leases, budgets, approvals, action receipts and audit events |
| `nethra-scheduler.js` | Claim due objectives, enforce runtime/wake limits, renew leases, recover interruptions and retry with backoff |
| `nethra-runner.js` | Reconstruct bounded context, execute native tool loops, checkpoint plans/evidence, yield or explicitly complete |
| `nethra-tools.js` | Closed schemas and allowlist, approved text reads, public research, workspace drafts, approval checks and child capability restrictions |
| `local-agent-runtime.js` | Ollama calls, streaming tool accumulation, native thinking metadata and shared inference serialization |
| `main.js` / `nethra-startup.*` | Host initialization without a desktop window, single instance, Windows sign-in/recovery task, independently attached desktop UI |
| `nethra-api.js` | One API for desktop IPC, authenticated LAN and encrypted relay clients |
| `renderer/nethra.js` | Windows objective creation, plans/evidence/history, approval, thinking and startup controls |
| Android `NethraClient` / `NethraPanel` | Host-owned durable state, reconnecting requests, objective controls and exact approvals |

Objectives, approvals and execution state live under Electron user-data `nethra/nethra.sqlite`; generated drafts live in per-objective workspaces alongside it. Conversation history and existing owner-entered memory remain separate stores. Current working context is rebuilt from bounded task state, rather than an indefinitely growing transcript. This is structured task memory, not a general semantic long-term memory service.

### References and alternatives

The reference review favors the smallest implementation compatible with the installed stack:

- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) separates execution checkpoints from cross-thread stores. Junction adopts that separation through its own task store; introducing graph infrastructure would duplicate the existing JavaScript orchestration for this bounded workflow.
- [OpenAI Agents SDK sessions](https://openai.github.io/openai-agents-js/guides/sessions/) provide a session interface for history. Junction already has local conversation persistence and needs host-specific leases, permissions and scheduling, so an additional SDK is unnecessary here.
- [Claude Agent SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents) inform isolated context and tool restrictions. Nethra implements sequential local workers to retain the existing Ollama model and constrained GPU budget.
- [Ollama thinking](https://docs.ollama.com/capabilities/thinking) uses separate thinking and final content fields. Installed model metadata and live calls, rather than model size alone, establish current support.
- [Windows Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page) supplies sign-in and recovery triggers. A per-user interactive host retains access to protected device identity without a new service account. This is sign-in startup, not execution while the owner is signed out.

No Python agent runtime, additional local model, external orchestrator or new cloud dependency was introduced. Existing optional Firebase relay/account functions are retained.

## Root causes and repairs

The interrupted implementation initially left owner-work controls routed through task submission, phone conversation/surface context absent from inference, and stale search requests able to follow greetings. Those paths have focused regression coverage. The earlier Qwen timeout investigation is in [QWEN14B_PERFORMANCE_2026-10-19.md](QWEN14B_PERFORMANCE_2026-10-19.md): an observed CUDA initialization failure forced a slow CPU load. It does not prove the intermittent GPU failure can never recur.

The resumed adversarial review found additional defects that the initial passing suite missed:

1. Approval consumption and action reservation were separate transactions, leaving an unrecoverable crash boundary.
2. Unrelated directory evidence could support a false claim that an unsupported external action completed.
3. Projects/delegation scripts loaded against missing DOM elements.
4. Waiting in the shared inference queue consumed objective inference budgets.
5. The API checked live input state before durable request deduplication, rejecting successful answer retries.

Repair status and exact regression evidence are tracked in `artifacts/nethra-repair-report.md` and `artifacts/nethra-runtime-audit.md`.

## Execution and permission boundaries

Defaults are one shared inference at a time, 4096-token context, 12 model iterations, 10 tool calls, at most two sequential child tasks with depth one, ten minutes per wake, and wake intervals between five minutes and seven days. Global and objective daily budgets are stored locally. The scheduler polls durable due dates while idle; it does not invoke the model while waiting. Ollama may retain model weights in VRAM for its configured keep-alive interval.

Reads require Windows-approved roots or the objective workspace. Phone clients cannot grant themselves new PC read roots. File tools reject traversal, links and sensitive names, bound text reads, and restrict writes to objective draft workspaces. Existing draft replacement needs approval of the exact action payload. Reserved actions with uncertain outcomes must be held for review rather than silently repeated.

`READ_ONLY`, `LOCAL_WRITE`, `EXTERNAL_WRITE`, `SENSITIVE` and `DESTRUCTIVE` categories exist, but no external sending, application submission, purchasing or account-change adapter is available to Nethra. Such requests must not be represented as completed. Draft preparation is distinct from external execution. Restricted shell/development execution is not part of this Nethra tool registry; the existing approval-controlled Foreman remains separate.

Retrieved content is untrusted data. Child tools are read-only and cannot delegate, finish a parent or expand scopes. Search egress must be grounded in owner input or prior public evidence; private file evidence cannot supply arbitrary query terms. Credentials stay in existing protected identity/key stores. Raw thinking is omitted from stored objective evidence and audit/notification output.

These controls reduce capability and replay risks; they cannot prove the semantic correctness of every model conclusion. The Windows user account remains the local security boundary. The SQLite task database is local and is not separately encrypted at rest by this implementation.

## Connectivity and setup

### Windows

1. Keep Ollama running with the installed `qwen3:30b`. `ollama list` must show it; `ollama ps` during work should show GPU/CPU placement and context 4096. This model uses thinking for every response.
2. Use the complete packaged runtime directory. `Junction.exe` must stay beside `resources/app.asar` and `resources/pc-companion`; never copy only the EXE.
3. Open Nethra, enter a goal and success criteria, and grant an optional read folder on this PC. New files stay in the objective workspace. Enable persistent execution for ongoing goals.
4. Thinking is always on for the installed 30B variant. The control indicates this and cannot disable it. Raw reasoning is not shown in ordinary logs.
5. Enable **Start Nethra after Windows sign-in** for background recovery. The PC must be awake and the owner signed in. Closing the desktop window retains a host when persistent objectives need it; a normal desktop launch attaches to the existing instance.
6. Startup diagnostics are under Electron user-data `logs/startup.log`. Inspect errors there if a listener or scheduled task cannot start.

### Android

1. Install the verified APK using the existing stable signing/update process; avoid uninstalling an existing installation merely to update it.
2. In Windows Settings, create a Junction LAN pairing code and scan it using Junction Android. Pair only your own PC/phone. The saved certificate fingerprint and device-key challenge authenticate subsequent connections.
3. Open Projects/Nethra on Android to create objectives, inspect saved state and approve exact actions. The phone can close while the Windows host continues.
4. If direct Wi-Fi is blocked, use the existing encrypted PC relay pairing. Google sign-in is optional for owner setup; the relay still uses its configured Firebase transport.
5. A private overlay such as Tailscale remains a fallback requiring device-level setup and verification. This session does not establish hostel client isolation or firewall reachability without the phone.

The installed Ollama listener was verified on `127.0.0.1:11434`; it must remain loopback-only. Junction exposes its authenticated encrypted API, not Ollama. Existing LAN listeners bind eligible private interfaces, use TLS pinning and device signatures, support revocation and reconcile interface changes. No unrelated hostel device was scanned.

## Verification evidence and readiness

### 22 October UI and phone update

The Windows chat composer now groups model, verbose, Thinking Mode and objective creation under a compact `+` menu. The desktop UI, shortcut and launcher artwork say Nethra; the packaged runtime remains named `Junction.exe` to preserve existing firewall and startup bindings. Android now displays Nethra branding, keeps objectives reachable from chat overflow and the drawer rather than a permanent bottom tab, and places development projects under Build projects.

Mobile conversation deletion now records a Room tombstone before removing the chat, rejects stale LAN/Firebase reimports, sends a Firebase deletion independently of LAN success, and asks for confirmation in the drawer. Physical phone build 100150 was installed and smoked: one disposable chat was deleted, its session and messages were absent, its tombstone was present, and it stayed deleted after a sync interval and force-stop/restart. A new objective created on that phone reached the real PC `qwen3:14b`, wrote a draft, and displayed `COMPLETED` on Android.

Final build 100151 includes the refreshed eye icon and passed 166 Android unit tests across 29 suites. APK SHA-256: `198DB8F5A4098095A165B529F0A5A211192374D8D347F35E72A5AE811F2FCDA0`. The Windows suite passed 105/105, the Electron renderer/IPC smoke passed with the closed and expanded menu, and the scripted restart/approval acceptance passed 29 checks. The packaged Windows runtime at `apps/windows/dist/nethra-agent-chat-20261022` was relaunched and owns the authenticated listener on port 43111. Build 100151 has **not** been installed or smoke-tested on the phone because ADB disconnected when the phone left the hotspot. Hostel Wi-Fi phone-to-PC reachability is still unresolved. The prior 100150 phone smoke does not verify the final icon build.

For current Android setup, open the drawer or chat overflow and select **Nethra objectives**. Use **Build projects** for development project files. Install build 100151 with `adb install -r apps/android/build/outputs/apk/debug/app-debug.apk` once USB debugging or the existing ADB link is available; then launch Nethra and repeat the objective/delete smoke without uninstalling user data.

| Check | Evidence | Current result |
| --- | --- | --- |
| Windows unit/contract/integration command | `apps/windows` `npm test` (21 Oct 2026) | PASS, exit 0; final Nethra block 70/70, with preceding Windows suites also passing |
| Live local 14B objective | `artifacts/nethra-live-smoke.json` | PASS, `qwen3:14b` read fixture, wrote expected report and completed; latest run 9.811 seconds |
| Live native thinking with and without tool call | `artifacts/nethra-thinking-live.json` | Passed; metadata streamed and raw reasoning omitted from saved report |
| Android unit suite and APK | `apps/android` unit test XML and `apps/android/build/outputs/apk/debug/app-debug.apk` | PASS, 157 tests in 28 suites; build 100144; SHA-256 `19FED094814F9C3E2C19E61858A6852D97BFEC0A277D6197E7EACEDE460CCCBF` |
| Physical Android UI smoke | Connected SM_A528B (`RZCRA0E69TB`) | PASS: installed APK, launched app, opened Nethra and verified objective controls; no fatal exception in inspected logcat |
| Restart/wake/child/approval integration | `artifacts/nethra-acceptance-report.md` and `artifacts/nethra-acceptance-result.json` | 29 checks passed; scripted inference, real SQLite/files/scheduler/API and authenticated LAN fixture; not the complete live 14-step acceptance |
| Electron headless/desktop lifecycle | `artifacts/nethra-host-smoke.json` | Passed disposable profile; not packaged |
| Electron renderer IPC and controls | `artifacts/nethra-final-offline-ui.log` | Passed; screenshot file was empty because the disk was full |
| Packaged build and archive identity | `apps/windows/dist/nethra-agent-win-repaired` | PASS; startup script is unpacked at `resources/nethra-startup.ps1`; runtime launched using existing Junction user data |
| Packaged launch and desktop shortcut update | Desktop `Junction.lnk` and Windows listener/task inspection | PASS; shortcut and scheduled sign-in/recovery task target the repaired runtime; LAN listener active on the PC |
| Real Android-to-Windows Nethra round trip | Phone `10.164.57.104/24`, PC `10.164.57.103/24`; phone TCP to PC port 43111 returns `No route to host`; PC port is held by legacy `qwen14b-performance` package, which has no Nethra module; current Nethra package was separately launched in an isolated profile but showed a recovery/error window | BLOCKED on replacing the active legacy Junction session with the Nethra package and diagnosing its startup window; Tailscale is installed on Windows but logged out, coordination sync failed, and is not installed on the phone |

The scoped Nethra core has passed the full Windows suite, deterministic recovery checks, live `qwen3:14b` tool use and thinking checks, Android unit tests and an on-device UI smoke. The packaged host now launches from the Junction desktop shortcut, registers its sign-in/recovery task, and listens on the PC. The phone's TCP probe to the PC returns `No route to host`, and Tailscale cannot currently provide a route. The whole master task is not production-ready: cross-device Nethra synchronization and OS sleep/reboot acceptance remain unverified. Do not interpret the scripted recovery checks or Android UI smoke as live cross-device acceptance.

### Remaining scope beyond the verified core

| Feature | Classification and limit |
| --- | --- |
| Local text reads, research and workspace drafts | WORKING AND VERIFIED for scoped filesystem behavior; public research retains existing provider availability limits |
| Durable plans, evidence, state transitions, leases and wake calculations | WORKING AND VERIFIED in deterministic integration; full real-model multi-cycle use remains separate |
| Native 14B tools and thinking | WORKING AND VERIFIED by real Ollama calls |
| Android objective interface | WORKING AND VERIFIED for install, launch and Nethra screen smoke on the user's phone; host synchronization not verified |
| Phone-to-PC hostel Wi-Fi reachability / isolation diagnosis | PARTIALLY VERIFIED: both owned devices share a `/24`, while the phone TCP probe to the PC's active legacy listener returned `No route to host` and ping was filtered by the gateway. Client isolation or network/firewall policy is likely; the exact cause is unconfirmed |
| Native OS reboot / sleep / sign-in acceptance | IMPLEMENTED BUT UNVERIFIED through an actual reboot or suspend cycle |
| Child delegation | PARTIALLY IMPLEMENTED: bounded sequential context/tools and persisted parent evidence; children are not independently persisted objective records with their own task IDs/schemas |
| Memory | PARTIALLY IMPLEMENTED: structured objective context and existing owner memory; no general verified-fact/assumption knowledge base or document retrieval index |
| General document ingestion | NOT IMPLEMENTED in Nethra beyond bounded UTF-8 text files; no PDF/Word parser in this tool registry |
| Consequential external sending/submitting/purchasing | NOT IMPLEMENTED; no adapter may claim these operations occurred |
| Nethra restricted shell/development sandbox | NOT IMPLEMENTED; separate existing Foreman coding workflow retained |
| Deadline/priority-specific scheduling policy | PARTIALLY IMPLEMENTED: model-selected wakes with independent bounds, budgets and dependency checking; no complete calendar/priority policy engine |
| Background phone notifications for Nethra events | NOT IMPLEMENTED; both clients retrieve durable state when open |
| Narrow owner-configurable permission preapprovals | PARTIALLY IMPLEMENTED: fixed scoped-read/new-draft policy and exact overwrite approval; no general permission-policy editor |
| Device overlay fallback | IMPLEMENTED BUT UNVERIFIED as deployment configuration; Tailscale remains an optional setup path, not a proven phone route |

The implemented core is a reviewable local-agent foundation. It does not yet justify a production-ready claim for the entire master-task feature list.
