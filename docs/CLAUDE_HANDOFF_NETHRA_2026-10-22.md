# Claude handoff — Nethra persistent executive

Repository: `C:\Users\jf358\Documents\Junction`, branch `feat/nethra-durable-agent`. The working tree contains substantial inherited uncommitted work. Inspect `git status` and existing changes before editing; do not reset or overwrite them.

The user asked for one persistent 30B Nethra agent on Windows with Android as a companion. Their full specification is in the preceding conversation. Current architecture and stage evidence are in `docs/NETHRA_PERSISTENT_EXECUTIVE_2026-10-22.md`; earlier 30B migration evidence is in `docs/NETHRA_30B_UI_DELIVERY_2026-10-22.md`.

## What this stage changed

- Added SQLite schema 4 `attention` table, stable source-revision deduplication, profile/priority/check-in fields, progress timestamps, and revision-checked `configure` requests in `apps/windows/src/nethra-store.js`.
- Added `apps/windows/src/nethra-attention.js` with deterministic observation and daily/weekly/milestone direction-review triggers. Unchanged objectives do not invoke the model. Interrupted attention is requeued, not consumed.
- Scheduler claims due tasks with priority plus age promotion for fairness and sweeps check-ins every 15 seconds. One fenced lease and one 30B inference remain the existing limits.
- Runner gets bounded claimed-attention metadata and instructs the model to request direction for `DIRECTION_REVIEW` without treating this as action approval.
- Shared Nethra API adds `nethra.configure` and model-free `nethra.reunion`; both clients show/edit autonomy, priority and check-in preferences, and show recent durable activity. Host status truthfully reports Calendar/Gmail disconnected.
- Existing 30B-only model routing and always-on thinking remain in place. The installed `qwen3:30b` variant is thinking-only; 14B was removed in the prior stage.

## Verification and deployment state

- Windows `npm test`: 121/121 passed after final scheduler/check-in changes.
- Scripted restart/approval acceptance: `node artifacts/nethra-acceptance.cjs` passed 29/29, **simulated inference**.
- Android `:app:testDebugUnitTest :app:assembleDebug` passed for versionCode 100153 (166 tests in 29 suites). APK: `apps/android/build/outputs/apk/debug/app-debug.apk`, SHA-256 `03E60F8D85B762E15D0BA597BAEC0913017AB032E755A0B565DE9FDC3FD98B78`.
- Electron offline UI smoke passed after the final source changes: `npx electron scripts/offline-ui-smoke.js`.
- `adb devices -l` listed no device. Do not claim APK 100153 was installed or physically smoked. Do not open wireless ADB on untrusted hostel Wi-Fi without a verified private route.
- The Windows package at `apps/windows/dist/nethra-agent-chat-20261022` was rebuilt from the final source. Five key files match `app.asar` byte-for-byte. `Nethra.lnk` now targets that package; the responsive Nethra window and authenticated listeners on `10.164.57.103`, `100.95.8.42` and `192.168.56.1`, port 43111, were verified. The owner database is schema 4 with all four prior tasks and zero leases. The package path is kept stable because firewall/startup bindings appear path-specific. When regenerating the shortcut, set `$env:JUNCTION_PACK_OUTPUT='nethra-agent-chat-20261022'` before **both** `npm run pack:workspace` and `npm run desktop` in `apps/windows`. Without that environment variable, `npm run desktop` silently points the shortcut to the older `workspace-win-unpacked` package, which cannot read schema 4 and opens a recovery window. Follow `apps/windows/AGENTS.md`.

## Next work

1. Inspect this stage independently, especially attention event state transitions, `reconcileCheckIns`, SQLite migrations, and scheduler fairness. Fix confirmed defects and rerun focused/full tests.
2. Preserve the verified stable Windows package and shortcut path. If rebuilding later, set `JUNCTION_PACK_OUTPUT` for both packaging and shortcut creation, then verify the owner task count and listener. Do not destroy owner data.
3. Add real, opt-in, read-only Windows source connectors for Google Calendar and Gmail with independent OAuth, protected tokens, freshness/error state, stable source revisions and bounded refresh/backoff. Current Android `get_calendar_agenda` uses feed entries, including a seeded demonstration Calendar item; it is **not** real calendar access. Android Gmail tools use broader phone-side modify/compose scopes; do not copy their credentials to Windows.
4. Connect verified source changes to `NethraAttention.observe`; test changed vs unchanged evidence and disconnected/stale states. Keep external content untrusted. Do not enable send/modify/delete as passive monitoring.
5. Build profile-specific initiative budgets, proactive notification policy, and offline Android last-synced state. Current profile is persisted and used in briefing/priority, but exploration cadence is not implemented.
6. When the phone is available, install APK 100153 in place and smoke host status, objective policy, reunion, and a 30B objective round trip. Live 30B approval previously performed the protected write but hit the ten-minute wake limit before model completion; full live post-approval completion remains unverified.

Do not mark the master mission complete based on these tests. Calendar/Gmail access, proactive presence, live phone 100153 verification and full recovery acceptance remain open.
