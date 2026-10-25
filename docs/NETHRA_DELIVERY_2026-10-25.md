# Nethra delivery — 25 October 2026

Builds on the 24 October continuation (`NETHRA_CONTINUATION_2026-10-24.md`, commit `e668ab1`). Two
agents worked in parallel on the same request; this note covers the combined state.

## Verified facts about this PC

- Ollama 0.40.7. Installed tag `qwen3:30b` = Qwen3-30B-A3B-**Thinking-2507**, architecture
  `qwen3moe`, 48 layers, 128 experts (8 active), 30.5B parameters, Q4_K_M, 19.2 GB loaded.
- Resident at 4096 context with 10.57 GB in VRAM (≈55%); the remainder in system RAM.
- No model was downloaded, switched or re-quantised.

## Measured latency (24–25 October, `scripts/warmup-latency-measure.js`)

Raw: `apps/windows/test-results/warmup-latency.json`. One run each; not a statistical benchmark.

| Case | First token | First visible text | Total | Generation |
|---|---:|---:|---:|---:|
| Cold greeting, no warm-up | 65.1 s | 71.7 s | 73.6 s | (load dominated) |
| Warm-up load request alone | — | — | 60.8 s | — |
| First greeting after warm-up | 2.5 s | 7.1 s | 7.5 s | 15.6 tok/s |
| Warm greeting | 0.09 s | 6.3 s | 6.8 s | 17.9 tok/s |
| Warm short question | 0.65 s | 8.7 s | 9.1 s | 22.9 tok/s |

Warming before the first message removes roughly a minute of waiting. The gap between first
token and first visible text is the model's private reasoning (it is a thinking-only model).
The cold run's original tokens/s figure was wrong (load time counted as generation); fixed.

## Implemented and verified (automated tests, Electron UI smokes, live measurement)

- **Warm-up**: shared `ModelWarmer` (deduplicated, outside the inference lock, residency check,
  memory guard, failure cooldown that never blocks chat). Triggers: launch (setting), opening/
  starting/returning to a chat, voice mode, and ~2 minutes before an objective wake that needs
  inference. Settings: load at launch (desktop / also at sign-in / never), keep loaded 15 min–8 h
  (default 2 h). Chat shows queued / loading model / reading / thinking / responding.
- **Priority**: objectives take the model slot per model call, not per wake; an owner message
  preempts a generating objective step (at most twice per step, so objectives cannot starve).
- **Awareness**: a compact per-turn situation block — origin (desktop / phone LAN / relay), host,
  local time and zone, linked objective with last action / next / wake reason / needs, source
  freshness (“connected, checked at T” vs “connected, not checked” vs “stale” vs “unavailable”),
  phone presence, voice-call state from the phone, and an explicit honesty rule.
- **Objectives**: host-recorded wake reasons, waiting-for, last accomplished, outputs and evidence
  separate from the model's note; identical-input wakes skip inference and back off, then ask you;
  wall-time limits checkpoint and yield instead of counting as failures; owner controls
  pause / resume / check now / redirect / **edit** / **stop** / **delete**.
- **Continuous work** (new, per task, on by default for tasks you create in Tasks): after a
  productive step the next one starts ~20 s later instead of 5 minutes. Your chats still preempt
  it and the daily model-time limits still apply (shown on each task).
- **Task chats**: every new task gets its own chat. After each productive step Nethra posts what
  was actually done and what is next; questions, approvals and outcomes go there too. Anything you
  write in that chat reaches the task: it answers a pending question, or becomes a note the next
  step reads (and wakes a sleeping task). Quiet hours (default 22:00–07:00) and an updates setting
  (all / only outcomes / off) apply.
- **Task window** redesigned on Windows (status chip, “needs you” first, clear actions, editor,
  full record collapsed) and extended on Android.
- **Appearance**: light/dark/system, Junction/Sakura/Moss palettes, Sakura Mountain artwork from
  the supplied wallpaper (62 KB WebP) at the edges, separate petal layer (~24 fps, paused when
  hidden/unfocused, off under reduced motion and power saving), intensity controls; persisted.

Windows: `npm test` passes (317 tests across all suites, 252 in the main batch); offline and appearance Electron smokes pass with no renderer
errors. Android: unit suite passes (202+ tests) and `assembleDebug` succeeds.

## Implemented, needs physical-device verification

- Android call timer and connecting / active / reconnecting / ended states.
- Per-turn session context from the phone (voice vs text, spoken vs typed, read-aloud on).
- Spoken approval: exact disclosure, one-use, 45 s expiry, bound to plan + disclosure digest,
  rejected if it overlaps Junction's speech, invalidated if the plan changes, audit row + chat
  record. **Email by voice**: draft → read recipient and text → “send it” → Junction re-reads the
  draft from Gmail at send time and refuses if recipient or text changed → reports Gmail's
  confirmation. Drafts are known for the current app session only; after a restart, approve on screen.
- Active TTS identity (engine, voice, locale, network/local) in Voice settings; previews.
- Android appearance and petals.

## Not available / remaining gaps

- Windows objectives cannot send anything (no send tool exists); voice approval does not change that.
- Notification replies, screen automation, settings changes, code changes/merges and installs keep
  on-screen approval. Realtime (OpenAI) voice has no spoken approval.
- Hostel Wi-Fi isolation and Firebase write quota (see earlier handoffs) are unchanged.
- Long-duration live runs of continuous tasks have not been observed yet.

## Running

Windows (from `apps/windows`, PowerShell): follow `AGENTS.md` — disable the `Junction Nethra <SID>`
task, close Junction, `$env:JUNCTION_PACK_OUTPUT='nethra-agent-chat-20261022'`,
`npm run pack:workspace`, `npm run desktop`, open the Desktop shortcut, re-enable the task.

Android (repo root): `./gradlew.bat :app:testDebugUnitTest :app:assembleDebug`, then
`adb install -r apps/android/build/outputs/apk/debug/app-debug.apk`. Pushing to `main` publishes a
new APK through CI.
