# Nethra task notifications — incremental P1 delivery

Implemented 10 November 2026 on top of the P0 deletion changes. This covers task outcomes and verified monitoring milestones, not completion of P1–P5. Physical-device testing is optional follow-up, not a prerequisite to continuing development.

## Behaviour

In Android Tasks, expand **Notification settings** and select **Send task notifications to this phone**. One host-persisted device ID controls delivery; selecting another phone replaces it. The existing Windows All/Important/Off and quiet-hour preferences apply. This slice sends completed, blocked, failed, and owner-input/approval outcomes, with an **Open task** action. The task screen provides conversation and approval controls.

The existing host reporting callback and deferred report maintenance enqueue notifications from saved task transitions. Text states the recorded status and next action; it does not repeat unverified model-written summaries. No inference call, agent loop, scheduler, cloud reasoning service, or memory store was added.

The existing device-command SQLite queue signs notifications with the paired host key and transports them over authenticated LAN or the existing encrypted relay. Notification payloads contain the bounded task title, task ID and a generic status explanation, not tool output, private document contents or credentials. Android verifies the signature, host, target device, expiry and replay identity before handling them. The generic enqueue API/model tool cannot create this notification kind.

Android records the event in the existing Room feed, preserving seen/archive state on retry, and opens the exact task from both notification and history. Notification PendingIntents have task-specific identities. Lock-screen visibility is private. No notification action opens the microphone. The existing command result acknowledgement records handling, not proof that the owner read it; it does not wake the task.

## Persistence and recovery

- Additive host settings: `notificationDeviceId` (default null) and server-maintained `notificationDeviceSince`. No new database or schema migration.
- Existing task journal saves now include authoritative status when status changes, including approvals and deleted dependencies. Maintenance saves do not create new status episodes.
- Stable task/event IDs deduplicate queued outcomes across restarts and retries. Only the latest current outcome is eligible; stale/deleted tasks, changed devices, disabled updates and events preceding fresh opt-in are suppressed at delivery.
- Quiet hours defer both enqueue and delivery. Notifications expire after 24 hours in the existing queue and are not repeatedly recreated.
- Room uses insert-ignore for notification history; repeat delivery cannot unarchive an item. History is persisted before the alert. A crash between history insertion and Android notification posting can leave a history item without an alert. This deliberate at-most-once alert policy avoids re-alerting dismissed events; exactly-once OS alert delivery is not claimed.
- Disabled Android notifications retain history and report `alertPosted:false`. Delivery exceptions remain visible in command results. Background worker exceptions are logged and retried; cancellation propagates.

## Files changed for this slice

Windows production:

- `apps/windows/src/nethra-store.js`
- `apps/windows/src/nethra-conversation-report.js`
- `apps/windows/src/device-commands.js`
- `apps/windows/src/nethra-api.js`
- `apps/windows/src/main.js`

Android production (under `apps/android/src/main/java/com/splinch/junction/`):

- `data/sync/lan/DeviceCommandVerifier.kt`
- `data/sync/lan/DeviceCommandRunner.kt`
- `data/database/feed/FeedDao.kt`
- `feature/scheduler/NotificationHelper.kt`
- `feature/scheduler/DeviceCommandWorker.kt`
- `feature/projects/NethraPanel.kt`
- `feature/feed/ui/FeedScreen.kt`
- `app/MainActivity.kt`

Tests and verification:

- `apps/windows/test/nethra-notifications.test.js` (new)
- `apps/windows/scripts/nethra-package-smoke.cjs`
- `apps/android/src/test/java/com/splinch/junction/data/sync/lan/DeviceCommandVerifierTest.kt`
- `apps/android/src/test/resources/nethra-notification-vector.json` (new Windows-signed fixture)
- `apps/android/src/androidTest/java/com/splinch/junction/feature/projects/TaskNotificationTest.kt` (new)
- `apps/android/src/androidTest/java/com/splinch/junction/evaluation/PlanExecutionScenarioRunnerTest.kt` (existing DAO fake updated)

No new production module was needed. Existing dirty workspace changes and P0 changes remain in place.

## Validation actually run

- Windows `npm test`: exit 0; 551 TAP tests (27 + 3 + 4 + 40 + 477), plus the preceding non-TAP regression commands. Log: `artifacts/nethra-p1-windows.log`.
- Six focused notification tests pass: reopen dedupe/policy, explicit target/host-only enqueue, delivery revalidation/retries, acknowledgement without task attention, real approval transitions, and clock-bound expiry. Log: `artifacts/nethra-p1-focused.log`. Approval and ticking-clock regressions were observed failing before their fixes.
- Android `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`, with version code 101205/build 205: exit 0. 226 unit tests, 43 suites, no failures/errors/skips. Log: `artifacts/nethra-p1-android.log`.
- Windows `npm run pack`: exit 0. Packaged SQLite smoke confirms deletion/restart fencing and notification queue/retry dedupe. Logs: `artifacts/nethra-p1-package.log`, `artifacts/nethra-p1-package-smoke.log`.
- `git diff --check`: exit 0. Focused code review found and corrected approval event recording, maximum TTL clock drift, and fresh-opt-in delivery filtering.
- Android instrumentation tests compiled into the test APK but were not executed; no device/emulator run was required for this continuation.

Artifacts: `apps/windows/dist/win-unpacked` (directory runtime), `apps/android/build/outputs/apk/debug/app-debug.apk`. APK SHA-256: `faf064acd3fbdde7e9a7eac2d04ff10a48ef92238e1add280f41559cce11ef43`. These builds were not installed, published or pushed.

## Remaining work and optional device checks

The existing periodic worker has a 15-minute minimum interval and OS scheduling may defer it further. No FCM wake signal was added; timely locked/background delivery is not established. Android's notification permission still applies. References: [WorkManager scheduling](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work), [notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission).

P1 still needs richer contextual summaries, reply and voice actions, project preferences, cross-task coalescing, and wake-signal integration if low-latency delivery is required. Finite-task intermediate steps still use the existing chat progress reports; proactive milestones currently come from the ongoing monitor runner's verified milestone events. P2 shared continuation routing now has a host integration test (see NETHRA_P2_DELIVERY.md); call-start briefing, realtime parity, call invitations and broader context work remain. There is no demonstrated microphone-to-notification device cycle yet. P0 evidence remains in `docs/NETHRA_P0_DELIVERY.md`.

Optional device verification: select a preferred phone, finish a new task, pull commands or wait for the worker, verify one feed item and alert, tap into that task, open its conversation, then retry delivery/restart. Repeat with denied notification permission, quiet hours, switched preferred phone, deleted/resumed task and network loss. Confirm feed archive state survives retries. These are manual checks still to run, not claims of completed testing.


## Verified monitoring milestone follow-up

The existing runner's `MILESTONE_VERIFIED` event now also uses the signed notification path. All-updates mode includes these notifications; Important-only and Off suppress them. Nonterminal active/planning/sleeping tasks are eligible. There is no extra model call and no new Android handler: the existing task-notification receiver, feed record and task link handle both outcomes and milestones.

Low-priority events for one task are grouped in fixed 15-minute windows. The existing minute report sweep queues the latest batch after its window closes, with a count of verified milestones and an invitation to review saved evidence. It does not reuse model-written summary prose as proof of completion. A newer batch supersedes undelivered older progress; a blocker, approval wait, completion, pause, deletion or owner redirect prevents stale milestone delivery. Quiet hours retain deferred eligibility. Unchanged monitoring results do not create a new event or notification. Grouping is per task, not across projects or tasks.

`NethraStore.latestMilestoneBatch` uses journal sequence for recency so clock rollback cannot select a pre-redirect event. Three additive partial SQLite indexes accelerate milestone sequence, milestone time-window counts and owner direction lookup. They create no new state authority, do not require a user-version change and can be dropped without losing data. Old task/event records remain intact.

Follow-up changed files:

- `apps/windows/src/nethra-store.js`: bounded result/aggregate queries and partial indexes.
- `apps/windows/src/nethra-conversation-report.js`: milestone enqueue and delivery policy.
- `apps/windows/src/main.js`: reuse settle callback and existing minute report sweep.
- `apps/windows/test/nethra-milestone-notifications.test.js`: six focused regressions, including the actual runner/tool-evidence path, quiet/importance policy, coalescing, redirect, clock rollback, fresh opt-in and deletion.
- `apps/windows/scripts/nethra-package-smoke.cjs`: packaged milestone grouping verification.
- This report and `docs/ARCHITECTURE.md`.

Follow-up validation: full Windows `npm test` exited 0 with 556 TAP tests plus preceding non-TAP commands (`artifacts/nethra-p1-milestones-windows.log`). A final additional opt-in/deletion coverage test was then added; the complete 12-test outcome/milestone focused suite passed (`artifacts/nethra-p1-milestones-focused.log`). Windows package rebuilt successfully and packaged smoke passed deletion/restart, notification retry deduplication and milestone grouping (`artifacts/nethra-p1-milestones-package-smoke.log`). No Android source changed in this follow-up; the prior 226-test Android build result and APK remain applicable. No physical-device results are claimed.

Optional manual milestone check: enable All updates, run an ongoing objective through two verified monitoring milestones in one 15-minute window, allow the window and report sweep to finish, then pull device commands. Expect one task-linked alert with two milestones. Repeat an unchanged monitoring pass: no new alert. Switch to Important-only or redirect/delete the task before delivery: no stale progress alert.


## Android notification preferences and API wiring correction

Android Tasks now has a collapsed **Notification settings** card containing All meaningful updates, Important updates only, Quiet mode, preferred phone selection, and a quiet-hours editor. Settings save to the existing Windows API/store and refresh from the host; there is no independent phone policy store. Quiet hours use the host's local time, accept overnight windows, and validate 24-hour input before submission. The dialog scrolls for smaller screens. Quiet mode does not pause task execution.

Tracing this path exposed a defect in the earlier slice: `notificationDeviceId` was accepted by the store but absent from the public API allowlist. Earlier store-level tests missed it. The API now accepts the preference while rejecting direct edits to its server-managed cutoff. Public Android API tests verify selection, disable, retry cutoff stability and shared policy reads.

A second correction preserves the original notification cutoff when a settings side effect fails. An internal restore option on `NethraStore.setSettings` restores the known prior snapshot; it is not exposed in the API payload. Settings API updates are serialized around asynchronous side effects so a failed Windows startup registration cannot overwrite a newer phone preference. The concurrent rollback regression was reproduced failing, then passed after serialization.

Files changed in this follow-up:

- `apps/windows/src/nethra-api.js`
- `apps/windows/src/nethra-store.js`
- `apps/windows/test/nethra-api.test.js`
- `apps/windows/scripts/nethra-package-smoke.cjs`
- `apps/android/src/main/java/com/splinch/junction/feature/projects/NethraPanel.kt`
- `apps/android/src/androidTest/java/com/splinch/junction/feature/projects/NethraPanelTest.kt`
- This report and `docs/ARCHITECTURE.md`.

Validation: Windows `npm test` exited 0, with 560 TAP tests plus preceding non-TAP regressions (`artifacts/nethra-p1-preferences-windows.log`). Android unit tests remain 226 passing; app and instrumentation APK builds passed at version code 101206/build 206 (`artifacts/nethra-p1-preferences-android.log`). The new Compose preference test compiled but was not device-executed. Windows packaging and the packaged smoke passed; the smoke now chooses the phone through `NethraApi.dispatch(..., 'android')` before verifying notifications and milestones (`artifacts/nethra-p1-preferences-package-smoke.log`). `git diff --check` passed.

Current APK SHA-256: `357f2f0304101f0317c9747d4eff18f20e3352739d0b0d4e497eb3880b0caa75` at `apps/android/build/outputs/apk/debug/app-debug.apk`. This supersedes the earlier artifact hash. No installation, publication or device test is claimed. Remaining P1 actions/wake delivery and P2-P5 work listed above are unchanged.


## Durable reminder and dismiss actions (10 November)

Notifications now offer **Remind later** (one hour) and **Dismiss**, and swiping acknowledges dismissal. The Windows-signed envelope advertises action support; old host envelopes retain the original open-task behavior. Actions enter a persisted Android outbox before the OS alert is removed, then the existing DeviceCommandWorker sends them through authenticated `nethra.device.result`. Network failures retain pending choices and worker retries. Host identity is bound to each choice; a changed pairing never forwards an old choice to another host.

The existing device-command SQLite transaction records the first owner choice and inserts at most one reminder. The reminder has a unique delivery identity, retains the original persisted source event, and becomes eligible one hour later. Current task, preferred phone, quiet-hours and event eligibility are checked again at delivery. Deleted, superseded or disabled events cannot produce a stale reminder. Reminding does not wake task execution. Delivery receipts and owner choices are separate, so an action still works after the phone acknowledged displaying the notification. Deferred reminders cannot block ordinary diagnostic commands. Feed acknowledgement changes NEW to SEEN without unarchiving history.

No new production module, scheduler or database was introduced. Additional changed files are `apps/windows/src/device-commands.js`, `nethra-api.js`, `nethra-conversation-report.js`; Android `data/sync/lan/DeviceCommandSync.kt`, `DeviceCommandVerifier.kt`, `DeviceCommandRunner.kt`, `feature/scheduler/NotificationHelper.kt`, `NotificationTapReceiver.kt`, `DeviceCommandWorker.kt`, and `data/database/feed/FeedDao.kt`. Tests include new `apps/windows/test/nethra-notification-actions.test.js`, Windows-generated signed fixture `apps/android/src/test/resources/nethra-notification-actions-vector.json`, verifier tests, notification instrumentation tests and the existing packaged smoke script.

Validation: seven action regressions and 27 focused delivery tests passed. Full Windows regression passed 567 TAP tests (`artifacts/nethra-p1-actions-windows.log`); packaging and packaged smoke passed, including public API snooze/dismiss (`artifacts/nethra-p1-actions-package-smoke.log`). Android 227 unit tests in 43 suites passed; app and instrumentation APK builds passed at version code 101207/build 207 (`artifacts/nethra-p1-actions-android.log`). Instrumentation tests compiled but were not device-executed. APK SHA-256: `6ecda3aacc63f548df533d08e4711bcfc3f9e0491c97ede90739d47c860d4d4b`, superseding earlier hashes. No installation/publication occurred.

Optional manual check: receive an eligible outcome, choose Remind later while offline, reconnect, and verify one reminder after an hour. Repeat the action delivery and host restart: still one reminder. Dismiss it, then confirm history is seen and no new reminder appears. Delete or redirect the task before its reminder becomes due: no stale alert. Lock-screen, OS process termination and background timing remain device checks.

## Exact approval review from notifications

A verified waiting outcome now carries the ID of the pending approval in its signed command. The host cancels pending delivery if that request stops being pending. Android offers Review approval and keeps the same target in feed history. Task detail requests that approval from the existing task API. A resolved or mismatched ID shows an unavailable message, and the host does not substitute a different request. Tapping only opens the review screen. Existing approval buttons and Windows-only review limits still apply.

Changed files: Windows `device-commands.js`, `nethra-conversation-report.js`, `nethra-api.js` and `nethra-notifications.test.js`. Android `NotificationHelper.kt`, `MainActivity.kt`, `NethraPanel.kt`, `FeedScreen.kt` and `TaskNotificationTest.kt`.

## Task-scoped notification reply

Verified owner-input outcomes carry a signed reply flag. Completion, milestones and protected-action approvals use their existing actions. Reply opens the task’s authoritative conversation using `nethra.openChat` and the existing Android conversation sync. The owner composes and sends a message through the ordinary owner instruction path. A stale or unreachable task shows the existing error and can be retried from Tasks. The notification body tap and feed history still open task details.

Windows coverage verifies the reply flag is limited to owner-input outcomes and stale delivery is cancelled after completion. Android instrumentation checks that the reply, task and approval PendingIntents have distinct targets and no microphone request.

## Per-project phone notification preferences

In Windows Tasks, open a task linked to a saved project, choose Edit, then set Phone notifications for that project. The choices are Use global preference, Important only, and Muted. The preference applies to all tasks linked to that project. It can reduce the global notification level. Global quiet mode, quiet hours and preferred-device selection still apply. Conversation reports continue through their existing policy.

The host validates the project against Foreman and persists the preference in existing Nethra settings. Enqueue and delivery both check current task association and project policy, including reminders. If an alert is cancelled at delivery because of a preference change, enabling the project again does not replay that cancelled command.

## Project milestone alerts

The existing minute report sweep now groups verified milestones from related tasks in the same closed 15-minute window. Each project/window has a stable identity. The alert gives milestone and task counts and opens the task with the newest milestone. Completed outcomes, blockers and approvals retain their own alerts. Tasks without a project retain their per-task grouping.

The device queue stores the group membership with the existing command and carries it into reminders. Delivery checks each member against the journal, task state and current project. If a member is deleted, reassigned or superseded, the pending group is cancelled as a whole. Previously queued milestones are excluded from later groups, including after a task changes project.
