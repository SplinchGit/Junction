# Nethra delivery map through P6

P6 is the end-to-end acceptance pass for scenarios A through F in the original brief. Each phase below starts from the existing implementation and identifies the next piece needed for acceptance.

| Phase | Implemented | Work and acceptance still needed |
| --- | --- | --- |
| P0 task lifecycle | Android list/detail Delete with confirmation. Windows execution fencing, tombstones and conversation retention. Packaged restart checks pass. | Run the installed Android flow across active, sleeping, paused, completed and failed tasks. Verify both clients after reconnect. |
| P1 notifications | Verified status and milestone events, signed delivery to one preferred phone, quiet hours, per-project phone preferences and milestone grouping, exact approval review, task-chat reply, durable reminders and dismissals. | Measure retry and locked-phone delivery and use that evidence to decide on a wake signal. |
| P2 voice and tasks | Paired PC calls use the same owner and task route as typed chat. Saved project context follows the task. Hosted realtime and optional Azure speech are excluded from paired PC calls. | Verify audio interruption, lock-screen behavior and work continuing after a call on Android. Hosted realtime task parity remains open. |
| P3 voice invitations | Opt-in signed invitation for a verified blocking decision, exact task conversation validation, Later/Decline actions and a separate foreground Start call control. | Verify delivery and microphone behavior on a paired phone. Android Answer acknowledges the exact delivered command before opening the call screen. Expired, declined and mismatched invitations are rejected. |
| P4 durable context | Saved project conversations, owner decisions, open/resolved questions and approved desktop TXT, Markdown, CSV, log, DOCX and selectable-text PDF import with local preview, search and revisions. Tasks can read explicitly approved revisions through the existing local read tool. | Add intentional Android import and evaluate OCR for scanned PDFs. Verify the Windows document picker and task approval controls in the packaged UI. |
| P5 initiative | Verified completion of all explicit prerequisites can wake a sleeping persistent task once. Task details explain stalled prerequisites. Linked background tasks refresh saved owner decisions and open questions before model turns and discard reasoning based on superseded project context. | Document revision changes are visible when opening a task and at inference boundaries. Event-driven review and grouping related owner questions remain open. |
| P6 acceptance | Host SQLite, scheduler, reporting, queue and routing tests plus packaged smoke. | Run and record A–F as listed below. Track host, Android integration and actual device evidence separately. |

| Scenario | Evidence today | Acceptance gap |
| --- | --- | --- |
| A delete active task | Packaged host restart/replay fencing and retained conversation. Android controls compiled. | Android confirmation, both lists and reconnect on a paired device. |
| B start work by voice | Host continuation integration and task creation tool coverage. | New project-linked work from spoken instructions, then call ends while work continues. |
| C proactive notification | Verified host milestone and delivery deduplication tests. | Actual selected-device alert and tap into the right task under retry. |
| D Nethra requests a call | Host integration verifies a signed invitation, exact task chat and a recognized answer saved once on the original task. | Verify microphone, permission and call behavior on paired Android. Shared chats with multiple active tasks still require clarification. |
| E cross-interface continuity | Shared briefing and original conversation retained in the host cycle. | One durable project link across Android chat, voice, Windows and completion notification. |
| F offline/recovery | Host deletion, restart, stale request, approval and notification retry regressions. | Paired-device offline/lock-screen recovery, interrupted calls and the full failure matrix. |

Keep P0/P1/P2/P3 device checks open until a paired device or equivalent emulator setup is available. Continue approved project document workflows and cross-objective decision awareness independently.

Evidence is recorded in `NETHRA_P0_DELIVERY.md`, `NETHRA_P1_DELIVERY.md` and `NETHRA_P2_DELIVERY.md`.

P2 update: native chat/voice task creation now persists the unique host-resolved project link. Tests cover native routing, retries, SQLite reopen and ignoring a project override in an Android create payload. Project navigation and paired-device verification remain open.

Windows Tasks → Edit → Saved project now lets the owner link, change or clear the project on an existing task. The host validates the selection against Foreman and uses task revision checks and SQLite request receipts. Assignment preserves task status and approvals. Android local voice reads the saved link when the task conversation is opened. Android editing and device acceptance remain open.

P1 update: notifications and feed history now route approval review to the exact pending request. Stale requests do not redirect to a different approval. Windows 587 tests, package and smoke passed. Android 227 unit tests and both APK builds passed at local build 208 (101208). Instrumentation compiled. No device or configured emulator was available to run it. Published Android build remains 204 (101204).

Latest verification: task-scoped reply now opens the existing task conversation from an owner-input notification. Windows 588 TAP tests, package and smoke passed. Android 227 unit tests and both APK builds passed at local build 209 (101209). Android instrumentation compiled. Paired-device delivery and notification tap remain unverified. Published build remains 204.

Research agents are a text-first extension of existing task delegation. The owner must enable them. Active and recent agents appear in the parent task, and the owner can stop one agent or turn delegation off.

Latest verification: 617 Windows tests and 227 Android unit tests passed. The Windows package smoke verified agent opt-in, stop-all with the parent lease retained, and approved project document import. The Android app and instrumentation APKs built at local build 210 (101210). Installed Android, paired-device audio and locked-phone delivery remain unverified. Published release remains build 204.

Invitation acceptance now records the delivered command on the PC before opening the task chat. Host integration rejects wrong-device, expired and declined invitations, and retry preserves the same acknowledgement. Local Android build 211 (101211) includes the command identity in its notification action. The published release is unchanged.

Background task project context uses the same bounded owner-note selection as chat. A saved decision edit during model inference invalidates that response before its proposed action runs. The check uses the existing project link and does not schedule an extra wake. Imported document contents are outside this briefing.

Windows Tasks → Edit → Approved project documents grants a task access to a specific imported revision. The runner sees only approved names and read references in its briefing. It reads content locally by exact revision and verifies the saved source hash. Revocation and project reassignment remove future access. To prevent private excerpts from becoming web queries or external advisor prompts, granting access disables those tools for the life of the task, including after revocation. Previously produced task evidence and outputs follow the existing task history policy.

Windows task details now show a newer revision or a removed approved revision. Background tasks compare document metadata before and after inference and before tool execution. A catalog change discards the stale response before its proposed action runs. Newer revisions require a separate approval. Removed revisions are unavailable to the read tool, and prior outputs remain in task history. No document contents enter the automatic briefing.

Original-brief review after full task agent launch: P0 host deletion and P1 notification features are implemented, with installed Android and locked-phone acceptance open. P2 paired-PC voice and P3 invitations use the shared task path, with hosted realtime parity and device audio tests open. P4 supports approved local text and DOCX reading by revision; PDF and Android sharing remain. P5 handles explicit dependencies, project decisions and stale document context; event-driven document review and grouping owner decisions remain. P6 still needs the paired end-to-end pass. The later agent requirement now has explicit owner-launched persistent agents in Tasks. Nethra proposing full assignments for owner approval and bulk stop are still open.

Windows project import now accepts PDFs with selectable text. The native picker passes bytes to a separate PDF.js worker. The worker extracts text locally, with a 4 MiB input limit, 40-page limit, 128 KiB extracted-text limit, and an eight-second timeout. The import records the original file hash and saved revision. Existing task approval remains required for each revision. Encrypted, malformed and image-only PDFs return a clear import error. OCR and Android sharing remain open.
