# Nethra continuity patch — 23 October 2026

This patch keeps the Windows host authoritative for objectives, wake decisions, and the single local Qwen3 30B inference queue. Android remains a chat and objective-control client. It does not run its own objective scheduler.

## What changed

- The Windows objective interface is now a drawer in Chat. The task button and the chat `+` menu open it. Completed, failed, and cancelled objectives remain in durable storage and the journal but do not crowd the active list. Google source controls moved to Settings.
- Android has a chat `+` menu for attachments, Force research, and verbose telemetry. Verbose telemetry is persisted and enabled by default. Its objective controls are a sheet inside Chat rather than a separate Nethra tab. Offline state is labelled with the last sync time when available.
- Android attempts the paired, pinned LAN connection first, then the encrypted Firebase relay when LAN fails before a chat request is sent. Once a chat request may have reached the PC, the client does not retry it over a second transport. Objective mutations retain their request ID across transport attempts. Relay telemetry is encrypted with the paired key.
- Quiet objectives do not wake for speculative reflection. Balanced and Active objectives may receive one initiative review after a new meaningful progress checkpoint, at least one hour or fifteen minutes later respectively. An unchanged checkpoint is deduplicated. Six consecutive short wakes without progress move an objective to `WAITING_FOR_USER`.
- Local inference remains serial. Interactive turns take priority, with a background turn after at most three waiting interactive turns. The Junction World bridge now enables thinking for the installed thinking-only model and routes inference through that queue.

## Verification

- Windows unit and contract suite: 163/163 passed.
- Windows offline Electron UI smoke: passed; chat task drawer opens, prefill works, completed objectives are hidden, and there were no renderer errors.
- Android unit suite: 174/174 in 31 suites passed; debug APK assembled as version code 100157.
- Rebuilt Windows package matches source for the changed renderer, scheduler, runtime, and World bridge. The launched host listens on three private interfaces; the owner database still contains four objectives and no active lease.
- Qwen3 30B was probed locally with native thinking on; a warm 256-token raw API run took 17.7 seconds of evaluation at 14.4 tokens/s. That probe exhausted its cap in thinking and produced no answer, so it is **not** a successful end-to-end chat test or evidence of a speed improvement.

## Unverified and remaining work

- No physical phone was connected during this patch. The APK has not been installed or tested on the owner's phone. Hostel WiFi client isolation and live Firebase failover cannot be confirmed from PC-only checks.
- No live Google Calendar or Gmail grant was available. Source monitoring remains opt-in and unverified against the owner's accounts.
- The full real-30B approval-to-completion objective and spontaneous multi-day initiative remain unverified. The new initiative conditions and relay paths have automated coverage, not long-duration live evidence.
- The Windows package is deployed locally. The Android APK is local and has not been published.

## Run and smoke test

Windows: open `Desktop\Nethra.lnk`. The task drawer is available from Chat. The host scheduler is installed as the `Junction Nethra <SID>` scheduled task. Preserve `%APPDATA%\junction-windows` when rebuilding.

Android: install `apps\android\build\outputs\apk\debug\app-debug.apk` on an authorized device. Pair it to the PC in Settings. Check Chat `+` options and telemetry, open Tasks inside Chat, then test a short 30B turn over hotspot and hostel WiFi. On hostel WiFi, confirm that the connection status changes to encrypted relay when paired LAN is unreachable. Do not use wireless ADB on the untrusted hostel network without a private, authenticated transport.

For a Windows package rebuild, follow `apps/windows/AGENTS.md`: disable the Nethra scheduled task, ensure no objective lease is active, stop Junction, set `JUNCTION_PACK_OUTPUT=nethra-agent-chat-20261022`, run `npm run pack:workspace` and `npm run desktop`, launch the desktop shortcut, verify port 43111, and re-enable the task.
