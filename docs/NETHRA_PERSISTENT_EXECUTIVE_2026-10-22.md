# Nethra persistent executive — first vertical slice

This report records the implemented state on `feat/nethra-durable-agent`. It does not claim the full persistent-agent vision is complete.

## Architecture map

- Windows Electron owns the single `qwen3:30b` Ollama inference queue, objective runner, SQLite WAL store, scheduler, exact approvals, LAN API and encrypted relay. The installed 30B variant is thinking-only; reasoning remains separate from final output.
- `nethra-store.js` persists tasks, execution leases, usage, approvals, receipts, child records, activity events and now attention events. The schema moves from version 3 to 4 without replacing task records.
- `nethra-scheduler.js` cheaply polls due tasks and renews a fenced execution lease. Model inference occurs only after a claim. The wake runtime remains ten minutes with one active local inference. Claim order uses configured priority with hourly age promotion so a lower-priority due task is eventually served.
- `nethra-attention.js` accepts bounded internal source observations with stable source ID/revision and deduplicates unchanged evidence. A reasoning-required event may bring a sleeping objective forward. Metadata-only observations are journaled without invoking the model. Claimed attention is returned to pending on interruption or crash recovery. Daily/weekly direction reviews are queued only after meaningful progress; milestone reviews are queued when completed steps grow. An unchanged objective defers its check-in without inference.
- `nethra-runner.js` receives a bounded briefing of claimed attention, objective policy, plan and evidence. Existing tool and approval boundaries remain in force.
- `nethra-api.js` is shared by desktop IPC, authenticated LAN and the encrypted phone relay. `nethra.configure` changes objective policy with revision and request-ID checks; `nethra.reunion` reads a bounded journal without model inference.
- Android uses `NethraClient` over the paired transport and does not run this scheduler. Both clients now offer autonomy, priority and direction-check-in selectors and a lightweight “since you were away” view.

## Implemented and verified

| Capability | State |
| --- | --- |
| One local 30B model for Windows and Android requests | Working and verified on Windows; Android build verified, physical 100153 install unverified |
| Durable profiles (`QUIET`, `BALANCED`, `ACTIVE`), priority 1–5, check-in preference | Persisted and editable through both client APIs; daily/weekly/milestone check-ins have bounded deterministic triggers, while profile-specific exploration remains unimplemented |
| Deduplicated attention observations and priority claim order | Implemented and unit verified with SQLite reopen and single-lease checks |
| Interrupted attention recovery | Implemented and unit verified; events are requeued instead of silently marked complete |
| Model-free reunion journal | Implemented and unit verified; UI displays persisted objective count, approvals and recent activity |
| Calendar/Gmail event watchers | Not implemented on Windows; no live-source event ingestion into the attention table |
| Live Android objective policy and reunion UI | Built and unit-tested; no phone attached for smoke testing |

Windows `npm test` passed 121/121. Scripted restart/approval acceptance passed 29/29 with real SQLite/files and simulated inference. Electron offline UI smoke passed navigation, objective controls, renderer IPC and persistence. Android `:app:testDebugUnitTest :app:assembleDebug` passed for versionCode 100153 (166 tests across 29 suites). APK: `apps/android/build/outputs/apk/debug/app-debug.apk`, SHA-256 `03E60F8D85B762E15D0BA597BAEC0913017AB032E755A0B565DE9FDC3FD98B78`. ADB listed no device, so no physical install or cross-device smoke is claimed.

The packaged Windows runtime was rebuilt at the stable `apps/windows/dist/nethra-agent-chat-20261022` path. Five key package files matched source byte-for-byte. `Nethra.lnk` targets that path, the Nethra window responds, and the authenticated host listens on private interfaces at port 43111. The owner database migrated to schema 4 with all four prior task records present and no active lease. Regenerating the shortcut requires `JUNCTION_PACK_OUTPUT=nethra-agent-chat-20261022` as well as packaging; otherwise it targets the stale default output and opens a recovery window against schema 4.

## Important limits and next stage

The new autonomy choices are **stored preferences**, not yet a complete initiative controller. They are included in the 30B objective briefing; configured priority influences claim order. Daily, weekly and milestone check-ins now create attention only after progress, but the full content and quality of a live 30B direction question remain unverified. Profile-specific exploratory reflection and proactive notifications are not implemented. Attention has a secure internal ingestion boundary, but no production calendar/Gmail watcher calls it. `nethra.reunion` summarizes saved journal events; it does not refresh external sources. The Android UI does not yet retain an encrypted offline snapshot across process death.

Android `get_calendar_agenda` reads feed entries. `FeedRepository.seedIfEmpty()` inserts a demonstration Calendar entry, so this cannot be used as verified calendar evidence. Android Gmail tools use `GMAIL_MODIFY` and `GMAIL_COMPOSE`; their OAuth tokens are phone-side and must not be copied to Windows. Host monitoring needs an independent, opt-in, read-only Calendar/Gmail authorization, protected token storage, source freshness/revision tracking, and explicit connection health. Until that exists, Nethra must not claim that it checked real mail or calendar data.

Next coherent slice: implement a host source-connection interface and read-only Google Calendar/Gmail adapters, with independent narrowly scoped OAuth, encrypted local tokens, event IDs/revisions, bounded refresh/backoff and disconnected/stale states. Connect them to the attention table, then add profile-specific reflection and check-in policy. Verify with mocked sources first and live accounts only after owner authorization. Sending, modifying or deleting external data stays outside passive monitoring and requires a separately approved adapter.

The PC must remain awake and signed in for scheduled work. Hostel Wi-Fi phone reachability and physical Android 100153 behavior remain unverified; wireless debugging was not opened on the untrusted network.

## Review pass: attention and check-in defects fixed

An independent review of the schema 4 stage found and fixed six defects, each with a regression test in `apps/windows/test/nethra-attention.test.js`:

1. Objectives created before schema 4 had no `checkIn`. The clients displayed `WEEKLY`, but no check-in ever fired. Opening the store now backfills the profile defaults (`BALANCED`, priority 3, `WEEKLY`, next check-in in seven days) for non-terminal objectives that lack them. It writes a `PROFILE_DEFAULTED` event and leaves the task revision unchanged.
2. Attention observed while a cycle was running was overwritten by the runner's chosen wake (up to seven days). The scheduler now caps the next wake at the earliest pending reasoning-required attention, still subject to the minimum wake bound.
3. Observing future-dated attention could postpone an already-due objective (`nextWakeAt: null` was treated as infinitely late). It now only pulls a sleeping objective's wake earlier.
4. One objective's check-in failure aborted `run()` before `claim()` and retried on every tick, which stalled all scheduling. Failures are now isolated per objective and reported through `scheduler.lastError`.
5. Milestone revisions now include `lastDirectionAt`, so a milestone count reached again after reconfiguration still gets a review. They stay stable across a crash retry.
6. `attention()` returned the oldest 500 rows, which hid the newest claimed attention from the runner and clients. It now returns the newest 500 rows in chronological order.

Windows `npm test` passed 127/127. Scripted acceptance passed 29/29 (simulated inference). The packaged runtime at `nethra-agent-chat-20261022` has **not** been rebuilt with these fixes. The backfill in item 1 applies to the owner database on the next launch of a rebuilt package.

## Signed PC → phone device commands and the shared executor

**Transports.** Commands ride the existing `nethra.*` API. The phone pulls with `nethra.device.pull` and reports with `nethra.device.result`, over pinned-TLS LAN first and then the AES-GCM Firebase relay. No Firestore collections or rules changed. This covers home Wi-Fi, phone hotspot (the host binds every private interface) and mobile data (relay). Hostel Wi-Fi isolates clients, so there the phone uses the relay, or Tailscale once it is installed on the phone.

**Trust.** The host signs each command at delivery time with its LAN TLS private key (RSA-2048, `SHA256withRSA`). The phone (`DeviceCommandVerifier.kt`) accepts a command only when:
- the SPKI SHA-256 equals the pin it saved at pairing;
- the signature verifies;
- the command names this phone and the paired PC instance;
- it is unexpired, with a lifetime of at most 24 h;
- its id has never been seen.

Signed bytes are parsed only after verification. A Kotlin test verifies a vector produced by the Windows signer (`src/test/resources/device-command-vector.json`). The queue (`device-commands.sqlite`, separate from the schema 4 owner database) holds no secret. That lets CLIs enqueue while only the Electron host can sign.

**Tiers.**
- READ: `STATUS`, `SMOKE_TEST`, `COLLECT_LOGS`. These run automatically. Logs cover this app's own process only, are redacted, and are capped at 12,000 characters.
- CONFIRM: `CONFIRM_INSTALL`. The phone shows a notification and an Approve/Reject card in the Nethra panel, and returns the approved versionCode and SHA-256. Nethra cannot issue CONFIRM commands.
- No other kinds exist.

**Shared executor.** `apps/windows/scripts/junction-ops.cjs` is used by Claude (through Remote Control), Codex and the owner:
- `device send STATUS|SMOKE_TEST|COLLECT_LOGS [--wait]`, `device list|get|wait`;
- `adb devices|connect`. Connections are allowed only to USB serials and `100.64.0.0/10` Tailscale addresses;
- `adb install APK --serial S`. It refuses downgrades, requests `CONFIRM_INSTALL` and runs `adb install -r` only after the phone approves that exact hash.

The 30B model gets `phone_check` (READ kinds only) and `phone_result`. A result posted for an objective's command creates `device` attention that wakes that objective, and the result is passed to the model as untrusted data.

**Verification.** Windows `npm test` passed, final group 134/134. Acceptance passed 29/29 (simulated inference). The Electron offline UI smoke passed. Android `:app:testDebugUnitTest :app:assembleDebug` passed 173 tests in 31 suites for versionCode 100154, SHA-256 `2e8d0ed8fa02b7de40301f0860e57b0dbd48fec212481a23e564fbad2095ebdd`.

**Not yet verified.** There has been no live round trip with a physical phone, because no device was attached. The packaged Windows runtime has not been rebuilt. Background delivery runs at most every 15 minutes (the WorkManager minimum), or every 60 s while the Nethra panel is open. ADB over Tailscale needs Tailscale on the phone and `adb tcpip 5555` over USB after each phone reboot. Installs over the relay are deliberately unsupported (a 74 MB debug APK).

## Deployment and Google Calendar source (22 October 2026, late)

**Committed:** `fa8c6ce` (Nethra, 30B, review fixes, device commands), `c1178f7` (rebuild procedure) and `782389f` (Calendar). Not pushed. Crash logs, `artifacts/` run outputs, `junction_pull.db` and the stray `apps/windows/lan-server.js` copy were deliberately left uncommitted.

**Deployed:** the package at `dist/nethra-agent-chat-20261022` matches source byte-for-byte for the Nethra, device and calendar modules. It launched through `Nethra.lnk` and listens on 10.164.57.103, 100.95.8.42 and 192.168.56.1 port 43111. The owner database is still schema 4 with 4 tasks and no lease. The waiting objective received `PROFILE_DEFAULTED` (weekly check-in due 2026-10-29); the completed ones were left unchanged. The first rebuild raced the startup task's restart-on-failure and left a bare Electron window, so `AGENTS.md` now requires disabling the task while packing.

**Calendar:** `src/calendar-source.js`. OAuth is Windows-owned with loopback and PKCE and requests `calendar.readonly` only. The grant is encrypted with `safeStorage` under `userData/sources`. A refused scope is revoked, and a forged callback state is rejected. The source polls a 14-day window every 10 minutes, backs off up to 1 h, and catches up at start after downtime. Each event's etag is its revision. The first sync is a silent baseline. Added, changed and cancelled future events become attention only for objectives with `sources: ['calendar']`. Removals are suppressed when results hit the 250-event cap. The model sees only id, summary, location, start, end, status and updated, never descriptions or attendees, as untrusted data. Status (DISCONNECTED, CONNECTED, STALE, ERROR) is shown on Windows and Android.

**Verification:** Windows `npm test` passed, final group 141/141. The UI smoke passed. Acceptance passed 29/29 (simulated inference). Android has 173 tests in 31 suites; APK versionCode 100155 has SHA-256 `46d61ed58b083121ca05d03de2cc546aa3aaf348c6930cc56b639e9b7a350b65`.

**Not verified live:** consent against a real Google account. That needs the owner's Desktop OAuth client ID and secret, entered in Objectives → Google Calendar. Also not verified: a phone install of 100154 or 100155, a live phone_check round trip, Gmail monitoring (not implemented) and full master-task acceptance.

## Gmail source and CI emulator smoke

**Push policy.** The repository ruleset `single-branch-only` allows only `main`, so work is pushed by fast-forwarding `main`. A push to `main` runs CI, the web build, the APK build and the Play internal workflow. The Play workflow currently skips every step because no release credentials are configured. When the emulator smoke passes, the APK build job publishes the APK and `latest.json` to GitHub Pages and creates a GitHub release; the phone's in-app updater reads `latest.json`.

**CI fix.** `android-emulator-runner` executes each `script:` line separately under `/bin/sh`, so the inherited multi-line smoke step failed on `set -o pipefail`. The smoke step now runs `scripts/ci/android-emulator-smoke.sh` from a sparse checkout.

**Gmail.** `src/gmail-source.js` shares `src/google-source.js` with Calendar. Each source holds an independent grant and can be disconnected on its own.
- **Scope:** `gmail.metadata` only. That grants headers and labels and never message bodies, so `gmail.readonly` is not requested.
- **Baseline:** the first sync records the profile `historyId` and creates no attention.
- **Polling:** `history.list` (messageAdded, INBOX, at most 3 pages) finds new mail. Spam, trash, drafts, sent, promotions and social are ignored. At most 20 messages per sync are fetched with `format=metadata` (From, Subject, Date).
- **Expired cursor:** if the history cursor has expired (404), the source re-baselines silently. Mail that arrived during that gap is not reported.
- **Attention:** each new message becomes `SOURCE_ADDED` attention with revision `received`, only for objectives with `sources: ['gmail']`.
- **Model access:** the model reads headers through `gmail_message` as untrusted data, with `bodyAvailable: false`. No send tool exists.

**Verification.** Windows `npm test` final group passed 146/146 (5 Gmail tests, 7 Calendar tests). The UI smoke passed. Acceptance passed 29/29 (simulated inference). Android has 173 tests; APK versionCode 100156 has SHA-256 `24be054235a51e98b36061e6cb42bcd581a96218fe64a6fa17fb468692a704dd`. The deployed package matches source.

**Live Gmail consent requires:** the Gmail API enabled in the same Cloud project, and `gmail.metadata` added to the OAuth consent screen scopes. It is a restricted scope, which works in Testing mode for listed test users.

**Version codes.** CI APKs are `101000 + run_number` (build 143 was published as 100143 before this offset, which is below the 1001xx builds installed by hand, so the in-app updater could never offer it). Local manual builds should use codes below the current CI code, or be installed only by ADB, so they never block CI updates. The Play workflow uses its own run counter on a separate track.

## Live approval-to-completion: passed (23 October)

The earlier live run did the approved write but ended `WAITING_FOR_USER`. Its event trail showed the cause. The runner executed the approved `write_draft` itself at the start of the wake, and the model then saw only its stale plan ("Request approval to replace review.txt…"). It re-saved that plan and asked for the same approval again.

The runner now puts `approvedActionsCompletedThisWake` (tool, path, SHA-256) and an explicit instruction at the **front** of the briefing, because `bounded()` truncates from the end. The instruction tells the model not to re-request those actions, to mark the steps complete, to check the success criteria and to finish if they are met. Regression test in `test/nethra-runner.test.js`.

Live re-run with real `qwen3:30b` (`scripts/nethra-live-approval-smoke.js`): approval requested, file untouched until approval, approved exact write performed (`amber approval 62`), final status **COMPLETED**, 447 s in total, `success: true`. This is the first end-to-end live completion of the approval workflow. It is a single run, so repeat it before treating it as reliable.
