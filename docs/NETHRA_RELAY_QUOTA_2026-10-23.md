# Nethra phone connection incident — 23 October 2026

The owner reported that Android displayed "Your Junction PC is offline" on hostel WiFi and through Firebase while the Windows app was open.

## Verified cause

- Junction's Windows process was running and its authenticated LAN server listened on `10.164.57.103:43111` (hostel WiFi) and `100.95.8.42:43111` (Tailscale).
- The paired Firestore brain document still said `active`, but its `lastSeenAtMs` was over an hour old. Android's 45-second preflight window therefore rejected the relay before sending a command.
- Using the same DPAPI-protected host session, a Firestore document read and command query returned HTTP 200. A no-op update of the existing `status: active` field returned HTTP **429 `RESOURCE_EXHAUSTED`**. This confirms a Firebase write quota/resource limit, not an Ollama or Windows host outage.
- No phone was attached to ADB or present as a Tailscale peer. Hostel WiFi client isolation has not been directly proven because the phone's WiFi IP was unavailable.

## Change

The idle host command poll is now every 15 seconds instead of 10, and the presence write is every 30 seconds instead of 15. This halves the host's idle query and heartbeat rates while staying within the older Android build's 45-second presence window. New Android builds allow a 150-second presence window to cover a missed renewal. These limits do not guarantee that the shared Firebase project's quota will be sufficient, and they cannot restore writes until the quota/resource limit clears. Android now reports that a stale heartbeat can also mean relay failure, instead of asserting the PC is off.

The Windows package was rebuilt and launched with the owner's four objectives intact. Windows tests passed 164/164; Android unit tests and APK assembly passed. Physical-phone connectivity remains unverified.

## Current connection options

- **Same WiFi:** use the paired direct connection if the network permits device-to-device traffic. The PC is listening; verify with the phone's actual WiFi IP before attributing failure to client isolation.
- **Tailscale over WiFi:** install Tailscale on the phone and join the PC's tailnet, then set the Android "Direct PC address" to `100.95.8.42`. Junction still verifies the saved PC certificate. This does not require wireless ADB.
- **Phone hotspot:** an earlier session verified direct PC-to-phone connectivity over the owner's hotspot. Re-test with the current APK when available.
- **Firebase:** retry after the project write limit recovers. The phone should no longer imply that an open PC is necessarily offline.
