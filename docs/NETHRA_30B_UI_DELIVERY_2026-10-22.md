# Nethra 30B and chat UX delivery — 22 October 2026

This is the current migration record. Earlier `NETHRA_DELIVERY.md` sections describe historical 14B tests and should not be read as the current model configuration.

## Current behavior

- Windows and Android local-provider catalogs select `qwen3:30b` only. Previously saved `qwen3:14b` selections normalize to 30B. The objective runner, bounded child records, desktop chat, paired-phone requests and Junction World use the same local tag.
- The installed tag is Qwen3 30.5B MoE Q4_K_M, with native tools and thinking. Its 2507 thinking variant emitted raw reasoning in `content` when sent `think:false`; all local 30B calls now send `think:true`, which separates reasoning from the visible answer. Thinking is shown as always on, rather than offering a false off switch.
- PC primary navigation is Chat and Audit. More contains Objectives, Feed, Work Activity, Context & devices and Settings. Chat has an active-objective count, and its `+` menu can carry typed text into a persistent objective. The composer is wider and grows to 240 px for multiline drafting.
- Android keeps Chat and Audit as bottom tabs. The chat menu can carry a typed draft into the objectives form; the form retains the persistent-execution choice and displays the 30B thinking constraint.
- Nethra wakes are bounded at ten minutes, with a matching durable inference-accounting cap. This accommodates slower CPU/GPU-split 30B runs without undercharging the objective budget. Daily budget and single-inference limits still apply.

## Evidence

| Check | Result |
| --- | --- |
| Ollama model inspection | `qwen3:30b` reports 30.5B Q4_K_M, tools and thinking; `qwen3:14b` removed with `ollama rm`; `ollama list` contains only 30B |
| Direct local inference | Cold load 51.84 s; 45% GPU / 55% CPU, context 4096; 22–24 output tokens/s in short probes; native `report_probe` tool call returned the exact arguments |
| Live desktop chat runtime | `LocalAgentRuntime.run` with `qwen3:30b` and a stored `thinking:false` request returned the visible answer “Two plus two equals four.” in 7.3 s; 432 reasoning characters stayed separate from content |
| Live Nethra objective | `artifacts/nethra-30b-live-smoke.json`: read approved file, wrote exact witness to workspace, saved plan and completed in 165.369 s |
| Runtime-limit regression | First 30B run hit the inherited six-minute limit after read/write, then paused without falsely claiming completion. Ten-minute cap and full accounting were added; rerun passed |
| Windows test suite | `npm test`: 109/109 passed after migration and accounting changes |
| Scripted restart/approval acceptance | `node artifacts/nethra-acceptance.cjs`: 29/29 checks, real SQLite/files/API/auth fixture with scripted inference |
| Live 30B approval/restart | Partial: `artifacts/nethra-30b-live-approval-smoke.json` records one approval request, unchanged file before approval, persisted approval across store reopen, and exact approved replacement with evidence receipt. The second wake reached the ten-minute limit before the model saved a plan and called `finish_objective`; it safely yielded `SLEEPING`, so full completion is unverified |
| Electron renderer | Offline UI smoke passed primary/secondary navigation, objective prefill, fixed thinking control, renderer IPC and persistence; screenshot: `apps/windows/test-results/offline-ui-smoke.png` |
| Android | Unit/build pass: 166 tests across 29 suites; debug APK versionCode 100152, SHA-256 `98DDA6785E369612D5214634A639B95A1C6504E2AEACE76BF6B1766E99EFA7B4` |
| Packaged Windows host | `apps/windows/dist/nethra-agent-chat-20261022` source matches package for the model and UI files; Nethra window responds and host listens on port 43111 |
| Disk headroom | Removing 14B recovered 8.64 GiB; C: free space rose from 7.22 to 15.86 GiB |

## Setup and limits

Use the Nethra desktop shortcut and keep Ollama running. The executable remains `Junction.exe` at the stable package path to preserve existing Windows startup and firewall bindings. The local Ollama API remains loopback-only; paired phones connect to Junction's authenticated API. The PC must be awake and the owner signed in for scheduled execution. Open Chat > `+` > **Continue as objective** on Windows, or Chat menu > **Continue draft as objective** on Android; review progress via the chat count or Objectives screen.

The APK was built but not installed because `adb devices` listed no phone. No Android 100152 smoke or live phone-to-30B round trip is claimed. Wireless debugging was not opened on the untrusted hostel network; the PC Tailscale client is currently logged out and unable to reach its coordination server. When the phone is available, install with `adb install -r apps/android/build/outputs/apk/debug/app-debug.apk` and smoke launch, local-model selection, objective draft handoff and a host result. Earlier physical phone tests were with 14B and an older APK.

Thirty-billion-parameter inference is materially slower than 14B on this 12 GiB GPU. The short probe generated 22–24 tokens/s after a 52 s cold load; complex objectives may use the entire ten-minute wake and resume on a later scheduled cycle. The live approval test proved the protected write and persisted state, but the 30B model did not finish its post-approval plan inside one wake. Full live sleep/reboot recovery, a completed 30B approval loop, a physical phone approval loop on the new build and hostel-Wi-Fi phone reachability remain unverified. No general external-action adapter is added by this migration.
