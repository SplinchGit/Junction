# Nethra P0 delivery — 10 November 2026

## Implemented

Delete is a labelled fixed-header control in Android task details, shared by the Tasks screen and chat task sheet. Task rows expose deletion, editing and conversation/details navigation, including ended tasks. Confirmation is required. Details and diagnostics no longer push controls below the work log. Windows exposes equivalent controls above progress. Both clients follow bounded list pagination so older tasks remain reachable.

The existing deletion API now uses schema-6 tombstones, fences leases and in-flight execution, rejects stale saves and mutation replays, retains ordinary conversations, cancels queued task-owned device commands and stops related Work Activity through Foreman. Failed workspace/related cleanup is persisted and retried by the existing maintenance path. Deleting a dependency blocks dependent work until explicit owner redirection; waivers are journaled. No replacement agent, scheduler, inference or memory system was added.

Edits preserve ended state for wording corrections; explicit continuation/redo can reopen the same objective using saved evidence and permissions. Ambiguous stopped-task instructions ask for clarification. This uses conservative command recognition, not unrestricted natural-language interpretation. Existing model selection, approval checks and task budgets remain intact.

Normal views show useful progress and decisions. Diagnostics is collapsed and full journal text is available through bounded cursor pages. Routine tool activity no longer produces progress messages. Completion reporting deduplicates durable episodes, including repeated completion after reopening.

## Relevant changed files

Windows production:
- apps/windows/src/nethra-store.js
- apps/windows/src/nethra-scheduler.js
- apps/windows/src/nethra-api.js
- apps/windows/src/main.js
- apps/windows/src/device-commands.js
- apps/windows/src/nethra-tools.js
- apps/windows/src/nethra-code-work.js
- apps/windows/src/nethra-chat.js
- apps/windows/src/nethra-conversation-report.js
- apps/windows/renderer/nethra.js
- apps/windows/renderer/appearance.css

Android production:
- apps/android/build.gradle.kts
- apps/android/src/main/java/com/splinch/junction/feature/projects/NethraPanel.kt
- apps/android/src/main/java/com/splinch/junction/feature/projects/ObjectiveStatusMonitor.kt
- apps/android/src/main/java/com/splinch/junction/feature/projects/ObjectiveRefreshGate.kt (new: rejects stale asynchronous responses)
- apps/android/src/main/java/com/splinch/junction/feature/projects/TaskDetailHeader.kt (new: shared, independently testable fixed controls)

Tests and verification:
- apps/windows/test/nethra-deletion.test.js (new)
- apps/windows/test/nethra-task-edit.test.js (new)
- apps/windows/test/nethra-report-noise.test.js (new)
- apps/windows/test/nethra-task-lifecycle.test.js
- apps/windows/test/nethra-api.test.js
- apps/windows/scripts/nethra-delete-ui-smoke.js (new)
- apps/windows/scripts/nethra-package-smoke.cjs (new)
- apps/android/src/test/java/com/splinch/junction/feature/projects/ObjectiveRefreshGateTest.kt (new)
- apps/android/src/androidTest/java/com/splinch/junction/feature/projects/NethraPanelTest.kt (new)

Documentation: docs/ARCHITECTURE.md, apps/windows/README.md, this report, and docs/superpowers/plans/2026-11-09-nethra-p0-implementation.md.

Existing uncommitted work was preserved; the list above describes this task's changes, not the entire dirty repository.

## Validation and artifacts

- Windows full regression: `npm test`; final results in apps/windows/test-results/nethra-p0-final-tests.log.
- Real Electron renderer/preload/IPC/SQLite smoke: apps/windows/test-results/nethra-p0-ui-final.log and p0-delete-visible.png. It verifies visible Delete above progress, confirmation, retained conversation and deletion surviving database reopen, using an isolated profile with network/inference disabled.
- Windows directory package: apps/windows/dist/win-unpacked. Keep Junction.exe with its resources and pc-companion directory. This candidate is not installed over the active runtime.
- Packaged SQLite smoke: apps/windows/test-results/nethra-p0-package-smoke.log.
- Android unit tests and both app/instrumentation APKs: artifacts/nethra-p0-android-delivery-build.log. App: apps/android/build/outputs/apk/debug/app-debug.apk.
- Candidate version code 101204/build 204 is above the published 101203/build 203 observed during delivery verification. Existing Gradle default local version 100000 would not update that published installation; the candidate is built with explicit version properties.
- Connected instrumentation was attempted and failed with `No connected devices!`; see artifacts/nethra-p0-android-final.log. UI test APK compilation is not device execution.

## Device acceptance still required

Connect the intended Android phone, record its installed version and signing certificate, and install the candidate in place only if its version is newer and signature matches. Do not uninstall or clear app data. Verify Delete without scrolling in both Tasks and the chat task sheet, including large fonts and a long work log. Exercise active, sleeping, paused, waiting, completed and failed disposable tasks; check both clients, retained conversations, host restart, disconnect/reconnect and repeated requests. Verify pending exact-action approvals are not bypassed. Run `:app:connectedDebugAndroidTest` with NethraPanelTest selected.

No physical phone was connected. The installed-phone build cannot be identified from the repository alone. The confirmed source-layout cause is Delete below diagnostics/configuration, with controls absent during detail-load failure. Publication metadata does not prove installation.

## Upgrade and limits

Schema 6 is additive and backfills existing deletion receipts. Do not lower user_version to run an old binary; restore a matching pre-upgrade backup/runtime for rollback. Minimal deletion/idempotency records remain to prevent replay. Deleting an objective preserves independent project records and reviewed code artifacts. An already-delivered device read may finish; its result cannot recreate or wake the deleted task.

No shared branch was pushed, release published, live owner task deleted, or installed runtime replaced. P1–P5 remain unimplemented. There is no claim of a verified voice → task → background work → notification → conversation cycle; that belongs to the subsequent phases after P0 device acceptance.

## Final recorded results

- Full Windows regression command exited 0; TAP groups: 27, 3, 4, 40, 471 (545 total), zero failures. Earlier non-TAP regression commands also exited successfully.
- Android: 225 unit tests, zero failures/errors; app and instrumentation APK build exited 0.
- Final renderer deletion smoke and packaged SQLite/restart/replay smoke passed.
- APK SHA-256: `b5a118949ec1a9c760bd71a6351a31dfa9179ac6bd38b4247323b6593156bec4`.
- Signing certificate SHA-256: `33d61d48c7862089738df6434152fa85ea239e49a83456d0b50e3a95f2aedbf8`, matching the recorded published certificate.
- Candidate version code: 101204. No physical-device installation or verification performed.
