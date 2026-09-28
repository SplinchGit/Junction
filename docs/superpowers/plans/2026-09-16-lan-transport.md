# Junction LAN Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure same-LAN Android-to-Windows Junction transport with discovery, pairing, streaming, authoritative conversation synchronization, and Firebase fallback.

**Architecture:** Keep application code behind the existing Android provider/conversation interfaces. Add a standalone TLS WebSocket LAN protocol on Windows and Android; select it centrally using `AUTO`, `LAN_ONLY`, or `REMOTE_ONLY`. Windows owns LAN conversation state and reuses existing local model routing; Firebase files remain unchanged.

**Tech Stack:** Electron/Node 20, Node `ws` and mDNS library, Node TLS/crypto, Electron `safeStorage`, Kotlin coroutines/OkHttp WebSocket, Android `NsdManager`, Android Keystore Ed25519, Room, existing QR scanner.

**Spec:** `docs/superpowers/specs/2026-09-16-lan-transport-design.md`

## Global Constraints

- Bind only to a private LAN interface; never add public internet exposure or port forwarding.
- Use TLS WebSockets; never ship plaintext WebSockets or globally disable certificate verification.
- Generate private credentials at runtime and keep them device-local.
- Do not modify or remove existing Firebase code/documentation; preserve fallback behavior.
- Keep canonical conversation/message IDs and use tombstones/revisions to prevent resurrection.
- Do not commit, stage, or log keys, certificates, pairing tokens, credentials, or generated identities.

### Task 1: Add shared protocol and Windows protected identity primitives

**Files:**
- Create: `apps/windows/src/lan-protocol.js`
- Create: `apps/windows/src/lan-identity.js`
- Modify: `apps/windows/src/device-identity.js`
- Modify: `apps/windows/package.json`
- Modify: `apps/windows/.gitignore`
- Test: `apps/windows/test/lan-protocol.test.js`

- [ ] Define bounded envelope validation and serializers for protocol version 1, request IDs, chat events, auth messages, and conversation sync records.
- [ ] Add Windows DPAPI-backed storage helpers for TLS key/certificate, instance metadata, paired Android public keys, revocation state, and one-time tokens; never return secrets in status/log objects.
- [ ] Add only lightweight runtime dependencies required for WebSocket serving and mDNS advertisement.
- [ ] Add tests for serialization, invalid envelopes, expiry, revocation, and ignored secret-file patterns.
- [ ] Run `node test/lan-protocol.test.js` and existing Windows tests.

### Task 2: Add Windows LAN WebSocket host and discovery advertisement

**Files:**
- Create: `apps/windows/src/lan-server.js`
- Create: `apps/windows/src/lan-discovery.js`
- Modify: `apps/windows/src/main.js`
- Modify: `apps/windows/src/local-data.js`
- Test: `apps/windows/test/lan-server.test.js`

- [ ] Generate/load the local TLS identity and bind the server to a private address/ephemeral configured port.
- [ ] Advertise `_junction._tcp.local` with only non-secret instance metadata and certificate fingerprint.
- [ ] Implement `hello → challenge → authenticate → authenticated` using Ed25519 verification and pinned identity metadata.
- [ ] Implement heartbeat, clean shutdown, bounded frame sizes, connection state, revocation, and duplicate request protection.
- [ ] Route `chat.send` into existing Windows model/provider execution and emit `chat.started`, incremental `chat.delta`, `chat.complete`, `chat.error`, and `chat.cancel`.
- [ ] Add Windows conversation event/revision recording around `LocalDataStore` mutations without changing Firebase sync code.
- [ ] Test auth success/failure, fingerprint mismatch, revoked/expired pairing, streamed deltas, cancellation, duplicate requests, and clean disconnect.

### Task 3: Add Android Keystore identity, discovery, pinned TLS WebSocket, and LAN transport

**Files:**
- Create: `apps/android/src/main/java/com/splinch/junction/data/sync/lan/LanIdentityStore.kt`
- Create: `apps/android/src/main/java/com/splinch/junction/data/sync/lan/LanDiscovery.kt`
- Create: `apps/android/src/main/java/com/splinch/junction/data/sync/lan/LanTransport.kt`
- Create: `apps/android/src/main/java/com/splinch/junction/data/sync/lan/LanProtocol.kt`
- Modify: `apps/android/src/main/AndroidManifest.xml`
- Modify: `apps/android/build.gradle.kts`
- Test: `apps/android/src/test/java/com/splinch/junction/data/sync/lan/LanProtocolTest.kt`

- [ ] Generate or load an Android Keystore Ed25519 key without exporting the private key.
- [ ] Parse pairing QR payloads, validate short-lived tokens/fingerprints, and persist only public metadata plus Keystore alias.
- [ ] Discover `_junction._tcp.local` through `NsdManager`, support a debug manual endpoint, and expose connection state.
- [ ] Configure OkHttp TLS with certificate/public-key pinning for the paired Windows identity; reject mismatches.
- [ ] Implement challenge signing, request IDs, heartbeat, reconnect with bounded exponential backoff, cancellation, and streamed event decoding.
- [ ] Add protocol serialization and authentication tests.

### Task 4: Insert centralized transport selection into provider routing

**Files:**
- Create: `apps/android/src/main/java/com/splinch/junction/assistant/provider/JunctionTransport.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/assistant/provider/JunctionPcProvider.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/assistant/provider/ProviderRegistry.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/app/AppContainer.kt`
- Test: `apps/android/src/test/java/com/splinch/junction/assistant/provider/JunctionTransportTest.kt`

- [ ] Define one transport-facing streaming API so `JunctionPcProvider` does not branch on LAN/Firebase throughout chat logic.
- [ ] Implement `AUTO`, `LAN_ONLY`, and `REMOTE_ONLY` selection; `AUTO` probes paired LAN first and falls back to the existing Firebase implementation on reachability/auth transport failure.
- [ ] Preserve existing Firebase request encryption, status handling, cancellation, and error messages as the remote implementation.
- [ ] Ensure active LAN requests bypass corresponding Firebase relay reads/writes.
- [ ] Test LAN preference, remote-only mode, LAN-only failure, and fallback behavior.

### Task 5: Add authoritative LAN conversation synchronization

**Files:**
- Create: `apps/windows/src/lan-conversation-sync.js`
- Create: `apps/android/src/main/java/com/splinch/junction/data/sync/lan/LanConversationSyncManager.kt`
- Modify: `apps/windows/src/local-data.js`
- Modify: `apps/android/src/main/java/com/splinch/junction/data/database/chat/ChatDao.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/assistant/conversation/SyncingConversationStore.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/app/AppContainer.kt`
- Test: `apps/windows/test/lan-conversation-sync.test.js`
- Test: `apps/android/src/test/java/com/splinch/junction/data/sync/lan/LanConversationSyncTest.kt`

- [ ] Add monotonic Windows event sequence/revision records and durable tombstones.
- [ ] Implement Android known-sequence exchange and incremental create/update/message/delete application.
- [ ] Route Android conversation create/rename/delete through the LAN authority when active while retaining Room cache responsiveness.
- [ ] Reject stale live records for tombstoned IDs and make all record application idempotent.
- [ ] Test initial sync, incremental sync, same IDs, deletion propagation, reconnect/missed events, and tombstone resurrection prevention.

### Task 6: Add pairing/revocation UX and connection-mode settings

**Files:**
- Modify: `apps/windows/src/main.js`
- Modify: `apps/windows/renderer/preload.js`
- Modify: `apps/windows/renderer/renderer.js`
- Modify: `apps/windows/renderer/index.html`
- Modify: `apps/android/src/main/java/com/splinch/junction/feature/settings/ui/SettingsScreen.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/data/preference/UserPrefsRepository.kt`
- Modify: `apps/android/src/main/java/com/splinch/junction/app/AppContainer.kt`
- Test: `apps/android/src/test/java/com/splinch/junction/feature/settings/LanSettingsTest.kt`

- [ ] Add Windows pairing-session creation, QR rendering, paired-device listing, and revoke actions without exposing private material.
- [ ] Reuse Android’s existing QR scanner to complete pairing and persist the paired Windows fingerprint.
- [ ] Add `Auto`, `LAN only`, and `Remote / 5G` settings with minimal UI changes.
- [ ] Display LAN/remote/offline status without changing Firebase behavior.
- [ ] Test mode persistence and pairing/revocation state transitions.

### Task 7: Documentation, security scan, and verification

**Files:**
- Create: `docs/LAN_TRANSPORT.md`
- Modify: `.gitignore`
- Test: repository-wide search and existing Windows/Android test suites

- [ ] Document LAN-only binding, Windows Firewall allowance, discovery, pairing, revocation, connection modes, and fallback behavior.
- [ ] Search for private keys, certificates, tokens, API keys, keystores, pairing secrets, and machine-specific identity files.
- [ ] Run `git status --short` and confirm no generated security material is staged or tracked by this feature.
- [ ] Run Windows tests, targeted Android unit tests, and Android build verification.
- [ ] Record remaining limitations, especially LAN isolation behavior on guest Wi-Fi and Android background execution.
