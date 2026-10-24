# Nethra continuation — 24 October 2026

Claude's session stopped during Android integration. This continuation preserves that work and
the existing owner data. Changes are local and are not published to GitHub or the APK release feed.

## Implementation

- Windows: shared model warmer with residency checks, deduplication, memory guard and retry cooldown;
  startup warming and idle retention settings; readiness UI; interactive inference priority;
  per-turn environment context; persisted objective tracking, control and scheduled updates;
  appearance settings and lightweight Sakura artwork/petals.
- Android: monotonic call timer and per-turn session metadata; phone warm-up requests; appearance
  settings, palettes and artwork; actual last-used TTS identity and voice previews; opt-in higher
  bitrate for the same Azure voice, retaining the original default.
- Fixed interrupted integration's provider field and trailing callback compilation errors.
- Added regression coverage for call timing, session clearing, read-aloud state, motion settings,
  confirmation expiry/session binding/replay and interrupted disclosure completion.
- Failed or interrupted playback cannot count as a completed spoken approval disclosure.

## Explicit limitations

Spoken approval is available only for the policy's supported actions during an owner-started local
voice call. Email sending and notification replies remain on-screen: current tools reference mutable
remote drafts or notification targets and cannot guarantee the exact recipient/content heard by the
owner. Immutable outgoing snapshots and send-time validation are still needed for the requested
email-by-voice flow. Code changes, installation and other higher-risk operations retain screen approval.
Windows external sending remains unavailable.

No ADB device was connected. Android UI, audio quality, voice recognition, real actions and phone
connectivity therefore still need physical-device verification. Realtime voice metadata and recovery
need integration testing. No alternative HD voice was activated or downloaded.

The independent review agent could not run because its usage limit was reached. Local inspection and
tests found and repaired defects; there is no completed independent review to claim.

## Measurements

The installed tag is `qwen3:30b`, family `qwen3moe`, 30.5B, Q4_K_M. Ollama reported 4096 active context
and 10,572,728,892 bytes in VRAM from a 19,207,248,934-byte loaded model. No model switch or download.

Three synthetic warm requests on 24 October, during development/build activity:

| Prompt | First visible text | Total | Reported generation rate |
|---|---:|---:|---:|
| Hello | 8.371 s | 8.827 s | 13.33 tokens/s |
| Are you the 30B model? | 19.168 s | 23.008 s | 14.87 tokens/s |
| Hello | 7.503 s | 7.942 s | 14.93 tokens/s |

These are measurements, not a controlled before/after speedup. The model was already resident, so
no cold-load latency was measured. Raw results: `artifacts/codex-resume-latency.json`.

## Checks and running

- Windows `npm test` succeeded; final Node test batch: 241 passed. Log: `artifacts/codex-resume-windows-tests.log`.
- Windows isolated appearance smoke passed, including persistence, reduced motion, readiness and
  objective controls. Dark/light Sakura screenshots visually inspected. Initial screenshot overwrite
  failed on a locked output file; the final run used a separate artifact directory and exited 0.
  Log: `artifacts/codex-resume-appearance-final.log`.
- Android: 202 tests across 38 suites, zero failures/errors; `assembleDebug` successful. Log:
  `artifacts/codex-resume-android-final.log`.
- Windows package built in `dist/nethra-continuation-20261024` after the old directory proved locked.
  With the recovery task disabled/stopped, its verified `app.asar` was copied into the existing
  `nethra-agent-chat-20261022` runtime. Matching SHA-256 hashes verified the copy. Both desktop
  shortcuts were launched; a visible Nethra window and listeners on port 43111 were confirmed.
  The recovery task is restored to Ready. Backup: `artifacts/nethra-before-continuation-20261024.asar`.

From the repository root, build Android with `./gradlew.bat :app:testDebugUnitTest :app:assembleDebug`.
The APK is `apps/android/build/outputs/apk/debug/app-debug.apk`; install with
`adb install -r apps/android/build/outputs/apk/debug/app-debug.apk` after connecting the phone.

Windows: in `apps/windows`, set `$env:JUNCTION_PACK_OUTPUT='nethra-agent-chat-20261022'`.
Follow `AGENTS.md`: disable the per-user Junction Nethra recovery task before rebuilding a live
runtime, close that runtime, run `npm run pack:workspace` and `npm run desktop`, launch the desktop
shortcut, then restore the task. Keep the executable beside its resources. Do not copy it alone.
