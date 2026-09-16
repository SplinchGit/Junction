# Junction same-LAN transport

Junction's Windows client advertises `_junction._tcp.local` with mDNS/DNS-SD and
binds a TLS WebSocket service to a selected private IPv4 interface. It does not
bind loopback-only companion ports to the LAN and does not configure port
forwarding, relays, VPNs, or public exposure.

The Android client uses the existing provider abstraction. For the `local`
provider Settings has two modes: Wi-Fi (direct LAN) and 5G (the existing Firebase
provider). Wi-Fi reports an unavailable PC rather than silently switching modes.
LAN chat uses the Windows local-agent runtime and forwards deltas as they arrive.

Pairing is one-time and explicit. Windows creates a short-lived QR payload
containing only the instance ID, private-network endpoint, certificate SHA-256
public-key fingerprint, and one-time token. Android generates a P-256 signing key in Android
Keystore and sends only its public key during pairing. Windows protects its
TLS identity, pairing records, tokens, and revocations with Electron
`safeStorage`. Private material is never uploaded or committed.

An existing Local Junction Brain pairing can establish LAN trust automatically
without another QR scan. Both peers prove possession of the already device-local
pairing key using role-separated HMAC-SHA256 proofs bound to a fresh nonce,
instance ID, Android public key, and TLS public-key pin. Discovery alone cannot
establish persistent trust. Subsequent connections use signed challenges with
the Android Keystore key. QR expiry never expires an established trust record.

The Android trust record pins SHA-256 of the Windows certificate's SPKI public key.
A dedicated TLS client accepts only that pin and validates certificate expiry. TLS
hostname verification remains enabled; the generated certificate contains the
Junction `.local` name and the selected private IP SAN. If Windows Firewall
prompts, approve the installer. It adds program-specific inbound rules for TCP
43111 and UDP 5353 with RemoteIP=LocalSubnet and edge traversal disabled. The rules
also work when Windows labels the home adapter Public; they never permit arbitrary
remote addresses. Do not expose the port through a router.

Windows is authoritative for LAN conversation state. Its local store keeps a
bounded revisioned event log and tombstones. Android uses the same conversation
ID supplied in `chat.send`. Windows exposes revision-based
`conversation.sync` data and tombstones for the Android cache layer; deletions
are represented by tombstones rather than timestamp-only conflict resolution.

Runtime security material is stored under the platform application-data
directory and is covered by the Windows LAN identity ignore patterns. No LAN
private keys, certificates, pairing tokens, or device credentials belong in
the repository.

Verification: Windows tests cover bootstrap proofs, P-256 challenge authentication,
revocation, streaming and replay protection. Android tests include a real TLS
handshake accepting a generated pinned self-signed certificate and rejecting a
different pin. Physical Android testing confirmed Qwen3 1.7B replies over LAN,
then a second reply after restarting Android without re-pairing. This smoke test
does not certify every conversation-sync or remote-access scenario.
