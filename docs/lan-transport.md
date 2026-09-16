# Junction same-LAN transport

Junction's Windows client advertises `_junction._tcp.local` with mDNS/DNS-SD and
binds a TLS WebSocket service to a selected private IPv4 interface. It does not
bind loopback-only companion ports to the LAN and does not configure port
forwarding, relays, VPNs, or public exposure.

The Android client uses the existing provider abstraction. For the `local`
provider it attempts the paired LAN endpoint first; if the endpoint cannot be
reached or authenticated, the existing Firebase-backed provider remains the
fallback. LAN chat uses the Windows local-agent runtime and forwards deltas as
they arrive.

Pairing is one-time and explicit. Windows creates a short-lived QR payload
containing only the instance ID, private-network endpoint, certificate SHA-256
fingerprint, and one-time token. Android generates an Ed25519 key in Android
Keystore and sends only its public key during pairing. Windows protects its
TLS identity, pairing records, tokens, and revocations with Electron
`safeStorage`. Private material is never uploaded or committed.

The Android trust record pins the Windows certificate fingerprint. TLS
hostname verification remains enabled; the generated certificate contains the
Junction `.local` name and the selected private IP SAN. If Windows Firewall
prompts, allow Junction only on the Private network profile. Do not create a
Public profile rule or expose the port through a router.

Windows is authoritative for LAN conversation state. Its local store keeps a
bounded revisioned event log and tombstones. Android uses the same conversation
ID supplied in `chat.send`. Windows exposes revision-based
`conversation.sync` data and tombstones for the Android cache layer; deletions
are represented by tombstones rather than timestamp-only conflict resolution.

Runtime security material is stored under the platform application-data
directory and is covered by the Windows LAN identity ignore patterns. No LAN
private keys, certificates, pairing tokens, or device credentials belong in
the repository.
