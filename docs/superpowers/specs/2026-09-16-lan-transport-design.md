# Junction LAN Transport Design

## Goal

Allow a paired Android Junction client to use models and authoritative conversation storage on a Windows Junction instance over the same local network, while preserving the existing Firebase path as the remote fallback.

## Non-goals

- No public internet exposure, port forwarding, hosted relay, VPN overlay, WebRTC/TURN, or Firebase redesign.
- No removal or modification of existing Firebase documentation or Firebase transport code beyond dependency wiring that selects the new transport.
- No shared private keys or reusable secrets between devices.

## Architecture

Android application code continues to use the existing provider and conversation abstractions. A new `JunctionTransport` boundary selects `LanTransport` when a paired Windows service is discovered and reachable, otherwise the existing Firebase-backed provider/synchronizer remains available. A user-selectable mode supports `AUTO`, `LAN_ONLY`, and `REMOTE_ONLY` (the latter is the requested 5G/out-and-about option).

Windows hosts a small TLS WebSocket server in the Electron main process. It delegates model execution to the existing `LocalAgentRuntime` and persistence to `LocalDataStore`; it does not expose the Ollama or companion server. The server binds to a private LAN address, advertises `_junction._tcp.local`, and accepts only authenticated paired Android devices.

## Security model

Windows generates a TLS identity and a device identity at runtime and stores private material in protected application data using Electron `safeStorage`. Android generates an Ed25519 identity in Android Keystore and never exports the private key. Pairing is a short-lived one-time QR bootstrap containing only a Windows instance ID, service metadata, certificate fingerprint, and pairing token. After pairing, Windows stores the Android public key; Android stores the Windows fingerprint and instance metadata. Each WebSocket connection authenticates with a Windows nonce signed by the Android private key. Revoked devices are rejected.

TLS certificate validation is pinned to the fingerprint captured during explicit pairing. No global trust-manager bypass or plaintext WebSocket fallback is permitted.

## Protocol

JSON WebSocket envelopes are versioned and bounded:

```json
{"protocolVersion":1,"type":"chat.delta","requestId":"...","payload":{}}
```

The implementation supports `hello`, `challenge`, `authenticate`, `authenticated`, `ping`, `pong`, `chat.send`, `chat.started`, `chat.delta`, `chat.complete`, `chat.error`, `chat.cancel`, `conversation.sync`, `conversation.created`, `conversation.updated`, `conversation.deleted`, `model.list`, and `model.status`.

Requests have bounded IDs and are idempotent. A duplicate `chat.send` returns the existing run state instead of starting a second generation. Socket shutdown cancels active runs owned by that socket. Heartbeats and bounded exponential reconnect are required.

## Conversation authority and synchronization

Windows is authoritative for conversations using PC-hosted models. Existing UUID conversation and message IDs are retained as the canonical identifiers. Android keeps its Room database as a responsive cache. The LAN sync exchange uses a monotonic Windows event sequence and tombstones:

1. Android sends its last acknowledged sequence and known per-conversation revisions.
2. Windows returns only changes after that sequence, including creates, metadata/message updates, and deletions.
3. Android applies records idempotently, records the authoritative sequence, and retains deletion tombstones locally.
4. Android-originated conversation creation/update/deletion is sent to Windows and receives an authoritative revision/event.

Stale records never overwrite a tombstone. Firebase listeners remain unchanged and remain the remote path when LAN is unavailable or `REMOTE_ONLY` is selected. While LAN is active for a PC-hosted turn, the Android PC provider does not issue the corresponding Firebase relay request.

## Discovery and pairing UX

Windows advertises only instance ID, service port, protocol version, and certificate fingerprint. Android uses `NsdManager` for `_junction._tcp.local` discovery and retains a manual host/port field only as a debug fallback. Windows exposes a settings action to create a short-lived pairing QR and a paired-device list with revoke actions. Android’s existing QR scanner is reused.

## Failure behavior

- LAN unavailable: `AUTO` selects existing Firebase behavior; `LAN_ONLY` reports a direct-connection error; `REMOTE_ONLY` skips discovery.
- Certificate mismatch, invalid signature, expired token, or revoked device: reject authentication and require re-pairing.
- Disconnect during generation: Windows cancels or retains a bounded resumable run record; Android reconnects and requests current run state, then reconciles the conversation.
- Reconnect after missed events: sequence-based sync returns missed changes and tombstones.

## Testing and hygiene

Focused tests cover pairing, rejection, invalid signatures, revocation, expiry, fingerprint mismatch, WebSocket authentication, serialization, streaming deltas, reconnect, duplicate requests, initial/incremental sync, creation/deletion/tombstones, stable IDs, LAN fallback, and secret-file scanning. Generated identities, certificates, keystores, tokens, and machine-specific files remain ignored and outside the repository.
