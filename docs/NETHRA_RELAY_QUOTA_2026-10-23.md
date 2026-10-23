# Nethra phone connection incident — 23 October 2026

The owner reported that Android displayed "Your Junction PC is offline" on hostel WiFi and through Firebase while the Windows app was open.

## Verified cause

- Junction's Windows process was running and its authenticated LAN server listened on `10.164.57.103:43111` (hostel WiFi) and `100.95.8.42:43111` (Tailscale).
- The paired Firestore brain document still said `active`, but its `lastSeenAtMs` was over an hour old. Android's 45-second preflight window therefore rejected the relay before sending a command.
- Using the same DPAPI-protected host session, a Firestore document read and command query returned HTTP 200. A no-op update of the existing `status: active` field returned HTTP **429 `RESOURCE_EXHAUSTED`**. This confirms a Firebase write quota/resource limit, not an Ollama or Windows host outage.
- No phone was attached to ADB or present as a Tailscale peer. The owner supplied the phone's hostel-WiFi address, `10.164.57.104`. The PC resolved its MAC address but an ICMP probe received a gateway "destination net unreachable" reply. The phone did not open a TCP connection to the Junction listener during a chat retry. These observations show that direct transport remains unverified; they do not prove which WiFi or Android layer rejected it.

## Change

The idle host command poll is now every 15 seconds instead of 10, and the presence write is every 30 seconds instead of 15. This halves the host's idle query and heartbeat rates while staying within the older Android build's 45-second presence window. New Android builds allow a 150-second presence window to cover a missed renewal. These limits do not guarantee that the shared Firebase project's quota will be sufficient, and they cannot restore writes until the quota/resource limit clears. Android now reports that a stale heartbeat can also mean relay failure, instead of asserting the PC is off.

The Windows package was rebuilt and launched with the owner's four objectives intact. Windows tests passed 164/164; Android unit tests and APK assembly passed. Physical-phone connectivity remains unverified.

A Windows firewall rule named `Junction paired phone WiFi 10.164.57.104` was applied and verified with `netsh`. It allows TCP 43111 only from that phone address to the PC's current `10.164.57.103` WiFi address and only for the packaged `Junction.exe` on the Public profile. The TLS server still authenticates the saved phone pairing and presents its pinned certificate. The rule is address-specific; remove or update it if either device's hostel IP changes. Its reproducible setup command is in `apps/windows/scripts/allow-paired-phone-wifi.ps1` and requires administrator approval.

## Current connection options

- **Same WiFi:** use the paired direct connection if the network permits device-to-device traffic. The PC is listening; verify with the phone's actual WiFi IP before attributing failure to client isolation.
- **Tailscale over WiFi:** install Tailscale on the phone and join the PC's tailnet, then set the Android "Direct PC address" to `100.95.8.42`. Junction still verifies the saved PC certificate. This does not require wireless ADB.
- **Phone hotspot:** an earlier session verified direct PC-to-phone connectivity over the owner's hotspot. Re-test with the current APK when available.
- **Firebase:** retry after the project write limit recovers. The phone should no longer imply that an open PC is necessarily offline.

## Root cause of the write exhaustion (Claude, 23 October)

The Spark plan allows 20,000 Firestore writes per day across the whole project. Two code paths could exceed that on their own.

1. **Relay progress: one write per thinking token.** The runtime reports progress for every streamed thinking chunk. `LocalBrainRelay` turned each one into a `PATCH` of the command document and awaited it inside the token stream. A relay reply with 300–1000 thinking tokens therefore cost 300–1000 writes, so 20–60 phone messages could exhaust a day's quota. The awaited writes also slowed relay replies.
   - Fix: `progressReporter` writes at most once per stage change and per 5 s, serialized and never awaited by the stream. Before the final status write it waits for pending progress writes, so a late progress write cannot overwrite `done`.
   - Partial answer flushes now happen every 2.5 s instead of 0.75 s. Lease renewal is every 60 s instead of 10 s; the lease is still 8 minutes.
   - Tests in `test/relay-write-budget.test.js`.
2. **Android account sync re-uploaded the whole history every 15 s.** `ChatSyncManager.backfillLocal` called `set()` on every local message and `get()` plus `set()` on every conversation each cycle. Firestore bills identical rewrites. With 100 messages this is about 576,000 writes a day while the app is open and signed in, and the `get()` calls also consumed the read quota.
   - Fix: `SyncUploadLedger` records what was already uploaded. Messages are uploaded once; a conversation is re-sent only when `sharedUpdatedAt` advances. An unchanged history now costs no reads or writes.
   - Tests in `SyncUploadLedgerTest`.

The Nethra panel also refreshed over the relay every 15 s, at about 3 writes per request. It now polls at 120 s or slower when the last request used the relay; LAN is unchanged.

Unchanged, but kept within budget: the 30 s heartbeat is 2,880 writes a day.

Not verified live: the current quota state, and the phone's actual sync settings. The quota resets daily at Pacific midnight. Whether Android account sync was enabled on the owner's phone is not confirmed. If it was, path 2 alone explains the exhaustion. If it was not, path 1 does.
