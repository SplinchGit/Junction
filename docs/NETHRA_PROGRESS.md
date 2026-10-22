# Nethra implementation ledger

## 21 October 2026 late — qwen14b reachability, verbose telemetry, hostel Wi-Fi

Full write-up: `docs/HANDOFF_2026-10-21_QWEN14B_AND_RELAY.md`.

- Junction's runtime talks to `qwen3:14b` correctly (7/7 live checks). The reported CUDA
  crash was host resource exhaustion: Ollama's GPU-discovery watchdog timed out, it used a
  stale free-VRAM reading, the 8.23 GiB full offload failed, and the CPU fallback failed too
  on a 11.9 GiB host with ~2.8 GiB free. Added failure classification plus one bounded
  unload-and-retry, so the owner sees an actionable cause instead of a raw CUDA string.
- Added the requested verbose footer (tok/s, token counts, total/load/generate timing, model
  calls, tools, thinking) on Windows and Android, behind a persisted `verbose` setting shared
  through the existing Nethra settings API. Speed comes from Ollama's `eval_duration`, never
  the wall clock. Room DB 23 → 24 for the Android column; migration verified on real device
  data with 77 messages preserved.
- **Hostel AP client isolation is now proven, not inferred.** With the host confirmed
  listening, phone→PC:43111, PC→phone:45999 and PC→phone:5555 all fail, the last against the
  phone's own ADB daemon confirmed listening via `ss`; the same listener connects in 0.8 ms
  over USB. No firewall rule can fix this network.
- `PRIVATE_IPV4` rejected `100.64.0.0/10`, so Junction could never bind Tailscale. Fixed, and
  added `preferredBindAddresses()`: when an overlay exists the API binds the overlay **only**,
  no longer exposing itself on the untrusted shared LAN. On this host it now selects
  `100.95.8.42` alone, where it previously bound `10.164.57.103` and `192.168.56.1`.
- Windows `npm test` 95/95; Android 166/166 across 29 suites; APK 100148 installed and
  launched cleanly on SM_A528B.
- Outstanding: the phone is not in the tailnet, so no cross-device traffic has run and the
  Android footer has never rendered a real payload; the packaged Windows runtime was not
  rebuilt and still predates these changes; the firewall rule needs elevation.


## 21 October 2026 current host repair

- Reproduced and repaired stale draft receipt replay, unrelated-draft completion, and oversized Android objective list responses.
- Added persisted bounded child records with lease fencing and crash interruption state; child work remains sequential and uses `qwen3:14b`.
- Full Windows `npm test` passes (Nethra group 74/74); scripted recovery acceptance passes 29 checks; live 14B file-read/draft-write objective passes.
- Rebuilt `nethra-agent-win-final`, launched it with the existing user profile, updated and launched the Desktop shortcut. The host process responds and listens on the PC at port 43111; the startup task points to the final package.
- No phone is currently attached to ADB. No APK was pushed in this stage, so a new Android smoke was not triggered. Real phone synchronization remains unverified.

Plan: docs/superpowers/plans/2026-10-20-nethra.md

Branch: feat/nethra-durable-agent. Inherited uncommitted work retained. No existing files discarded.

Preflight: store/scheduler produces leased tasks consumed by runner; runner produces checkpoints consumed by store; host supplies shared inference and owner-only API consumed by both UIs. Conflicts resolved with explicit contracts before dispatch.

Ruling: Continue in the current checkout on a dedicated branch because the resumed task depends on extensive inherited uncommitted assets and repairs. A new clean worktree would omit that work.

Status: implementation active. Initial failures reproduced: five owner-handler tests; stale search after greeting; missing LAN surface context.

## Resumed 2026-10-20 evening

Recovered the approved master task and interrupted implementation from the prior session. Continue on the existing `feat/nethra-durable-agent` branch with inherited changes intact.

- Fresh full Windows `npm test`: passed; `artifacts/nethra-resume-tests.log`.
- Fresh real qwen3:14b objective: read approved fixture, write report, complete; 46.161 seconds; `artifacts/nethra-live-smoke.json`.
- Fresh real native thinking: answer and tool call both streamed thinking metadata successfully; raw reasoning omitted from evidence; `artifacts/nethra-thinking-live.json`.
- Adversarial review reproduced approval crash recovery, unsupported false completion, missing Projects DOM, queue-budget accounting and answer retry defects. Repair in progress; `artifacts/nethra-runtime-audit.md`.
- Android full recompilation recovered stale Kotlin metadata; 153 unit tests passed and a debug APK was built and hashed. No connected device was available for UI or LAN validation.
- Full restart/delegation/approval integration acceptance and packaged launch verification pending.

Ruling: Preserve the earlier branch/checkout decision instead of creating a fresh worktree. Cost if wrong: less isolation; avoids losing the extensive uncommitted implementation and assets.

Verification distinction: live model file/tool and thinking checks are separate from scripted-model integration/recovery checks. No attached Android device has been found; phone UI and hostel Wi-Fi reachability remain hardware-dependent.

## Final resumed verification update (21 October 2026)

- Nethra core: `node --test test/nethra*.test.js` passed 52/52 after repairs.
- Offline Electron UI: pass; Chat, Feed, Projects, Audit, Context, Settings and Nethra navigation; objective create/pause/resume/cancel IPC; no renderer errors. Full Nethra screenshot could not be written because the C: drive was full.
- Electron host lifecycle: pass in a disposable profile with network and model disabled; headless start, desktop attach, persistent window close, reattach and same saved task all verified.
- Recovery integration: `node artifacts/nethra-acceptance.cjs` passed 29 checks with real SQLite, scoped files, scheduler, runner, API, shared inference lock and Ed25519-authenticated LAN fixture; inference responses were scripted.
- Fresh full Windows `npm test` after the audit repairs passed with exit 0. The final Nethra group passed 68/68.
- Built a fresh `apps/windows/dist/nethra-agent-win-unpacked` runtime once 433 MB became available; the pack script exited successfully. Nine required host/runner/permission/UI files extracted byte-for-byte identical from `app.asar` (`artifacts/nethra-package-verification.json`). The packaged runtime was not launched or attached to the desktop shortcut.
- The new package leaves about 115 MB free, still below the temporary dependency-copy requirement for the full Windows suite. Guarded cleanup of older generated runtimes remains blocked by local execution policy.
- A guarded attempt to reclaim space from obsolete generated app runtimes was rejected twice by local execution policy. The runtime targeted by the Desktop shortcut was preserved. No repository source was removed.
- Fresh live Ollama `qwen3:14b` objective completed in 9.811 seconds with real `read_file` and `write_draft` calls. Scripted persistence acceptance passed all 29 checks.
- Android build 100144 passed 157 tests across 28 suites, installed on SM_A528B, and opened the Nethra objective screen without a fatal app exception. APK SHA-256 is recorded in `docs/NETHRA_DELIVERY.md`.
- Phone `10.164.57.104/24` and PC `10.164.57.103/24` share a subnet. The phone reports the host unavailable; Ollama is loopback-only and no active Junction LAN listener was found. Do not infer client isolation from this: the host was not listening.

Final status: the scoped Nethra core passed full Windows and Android unit suites, deterministic persistence acceptance, a live 14B tool-use run and a physical Android UI smoke. The complete master task is not production-ready: cross-device Nethra synchronization, packaged-host launch/restart and OS sleep/reboot acceptance remain outstanding. General semantic outcome verification is heuristic; durable child records, general document ingestion, external-action adapters, notifications, shell sandbox and broader memory/permission UI remain incomplete as listed in `docs/NETHRA_DELIVERY.md`.

## Live-host restart follow-up (21 October 2026)

- With the user's approval, closed the old `qwen14b-performance` Junction process and started the Nethra package using the existing Junction user-data profile. No application data was cleared.
- The launch reproduced a packaged-only startup defect: the host tried to invoke `nethra-startup.ps1` from inside `app.asar`, where PowerShell cannot access it. Added regression tests and copied the script to `resources/nethra-startup.ps1` in packaged builds; packaged runtime now resolves the unpacked script path.
- `apps/windows` full `npm test` passed after the fix; Nethra suite 70/70. Built `dist/nethra-agent-win-repaired`, launched it in the existing profile, and verified the desktop shortcut and scheduled task target that runtime.
- Live host now listens on `10.164.57.103:43111`; the task `Junction Nethra <user SID>` is registered and Ready. This proves Windows host initialization, not Android synchronization.
- A phone TCP connection to that PC listener returned `No route to host`; ping was filtered by the Wi-Fi gateway. Host/phone share a `/24`, so network client isolation or filtering remains likely. Tailscale is installed on Windows but logged out and unavailable on the phone.
- Android UI inspection was stopped after the foreground app was found to be ChatGPT rather than Junction. No text was entered or submitted. The earlier Junction installation/UI smoke remains valid; no cross-device acceptance is claimed.
