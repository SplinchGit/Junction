# Junction / Nethra handoff — 23 October 2026

Workspace: `C:\Users\jf358\Documents\Junction`, branch `main`. Read `apps/windows/AGENTS.md`, `docs/NETHRA_CONTINUITY_PATCH_2026-10-23.md`, and `docs/NETHRA_RELAY_QUOTA_2026-10-23.md` before changes. Preserve `%APPDATA%\junction-windows`; it contains the owner's four objectives. The owner asked to wrap up and hand work to Claude.

## Current state

- Local HEAD is `b4f74c1`, one commit ahead of `origin/main` (`24e2c08`). The unpushed commit adds the narrowly scoped WiFi firewall setup script and records the phone-network observations. Pushing it will trigger another Android CI release, so it was left local rather than creating a redundant APK while the owner updates.
- Published Android build **101149** corresponds to `24e2c08`; its build, unit tests, Pixel 6 emulator install/launch, Pages publish, and GitHub release succeeded. The owner reported updating from build 101148 to 101149 and then saw the new relay error wording. A physical phone install/version check and chat success have **not** been independently verified.
- Windows package `apps/windows/dist/nethra-agent-chat-20261022` was rebuilt and launched. Junction listens on `10.164.57.103:43111` (hostel WiFi), `100.95.8.42:43111` (Tailscale), and `192.168.56.1:43111`. The Nethra scheduled task is enabled. Owner DB: four tasks, zero leases at handoff.
- Windows tests: **164/164 pass**. Android tests: **174/174 in 31 suites**, debug APK assembles. These are automated checks, not proof of phone connectivity or durable multi-day autonomy.
- Agent mode patch `295b3d9`: Chat objective drawer/sheet, Android `+` menu and persistent verbose telemetry, bounded initiative eligibility, single prioritized 30B inference queue, thinking-only World bridge correction. The existing persistent scheduler and objective store remain in use. Full live approval-to-completion and long-duration initiative still require acceptance testing.

## Connection incident and evidence

- The phone reports the relay presence error even though the PC app is running. Using the PC's DPAPI-protected Firebase session, Firestore document read and query returned HTTP 200; a no-op write returned **HTTP 429 `RESOURCE_EXHAUSTED`**. The paired brain document's heartbeat was over an hour old, so Android correctly rejected relay preflight. No secrets were printed or committed.
- Commit `24e2c08` changed the host's idle command poll from 10 to 15 seconds and heartbeat from 15 to 30 seconds, retaining compatibility with older Android's 45-second presence window. Android build 101149 also extends its window to 150 seconds and explains that stale presence can mean relay failure. This reduces traffic but does not resolve the current Firebase write quota.
- Owner supplied phone WiFi IP `10.164.57.104`; PC WiFi IP is `10.164.57.103`. PC resolved the phone's MAC, while ping received a gateway "destination net unreachable" reply. During phone chat retries, no TCP connection from `10.164.57.104` reached the Junction listener. Cause of direct-path failure remains unproven: phone address/pairing, hostel isolation, or another network layer.
- A Windows Public-profile allow rule named `Junction paired phone WiFi 10.164.57.104` was installed after UAC approval and verified with `netsh`: only that remote IP to local `10.164.57.103:43111`, TCP, packaged `Junction.exe`. Junction's pinned TLS and phone pairing remain required. Revisit/remove the rule if either IP changes.
- The owner could not perform the next browser reachability test at handoff. Do not claim hostel WiFi works. When available, ask them to open `https://10.164.57.103:43111` on the phone and report whether a certificate warning or "site can't be reached" appears, without proceeding past the warning. Then inspect Android's saved **Direct PC address** and LAN pairing, and compare with the PC's connection logs. Alternatively, Tailscale over the same WiFi or the previously working phone hotspot avoids hostel peer restrictions.

## Work to resume

1. Finish physical-phone connectivity diagnosis; never expose Ollama or accept unpaired traffic on hostel WiFi. The phone now has a precise address and the host has a scoped rule, but no successful chat round trip was observed.
2. Inspect Firebase project quota/usage and other pollers. Do not mask stale heartbeats or assume a quota reset means the traffic budget is sustainable. Keep the relay authenticated and encrypted.
3. After the phone connects, smoke-test build 101149: 30B chat, Android `+` menu, telemetry, objective sheet, approvals, and offline/reconnect state.
4. Resume the master persistent-agent acceptance: real 30B approval-to-completion, wake/restart recovery, initiative over time, and source integrations. Report live versus mocked evidence separately.

Do not reset owner data, publish a duplicate APK just for the handoff, or commit existing personal/artifact files. `apps/windows/test-results/ollama-tool-smoke.json` was modified before this handoff and intentionally left unstaged.
