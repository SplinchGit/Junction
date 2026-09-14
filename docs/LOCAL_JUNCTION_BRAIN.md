# Local Junction Brain: implementation plan

## Existing seams

- Android chat routes through `ProviderRegistry` / `ProviderRouter`; owner remote
  commands already use an idempotent Firestore claim transition.
- The Windows app owns the PC-local secrets through DPAPI and already launches
  Codex in isolated worktrees. Its companion is loopback-only by design.
- Firebase sync is the existing cross-network Junction fabric. It carries
  owner-authenticated, field-limited records and does not expose a machine port.

## Design

`brain_requests` is a durable owner-command envelope, not a raw LLM or Codex
endpoint. Android and Windows clients submit an idempotency-keyed request to the
owner's Firebase namespace. The selected home PC claims it atomically, runs the
PC-local Junction brain, and writes a bounded result/status back to the same
record. This works across Wi-Fi and mobile data without opening router ports.

The PC brain uses a loopback-only OpenAI-compatible local-model endpoint. Codex
and its login remain local. A PC-only durable job coordinator can escalate an
explicit coding job to Codex's existing isolated-worktree executor. Quota or
connectivity failures remain queued with bounded backoff and never mutate the
repository automatically.

## Delivery phases

1. Add a first-class `junction_brain` provider and secure, durable request
   envelope to Android, Windows, Firebase rules, and tests.
2. Add PC brain service health, local-model execution, and a job coordinator
   with idempotent claim/retry states.
3. Add explicit device pairing: Android generates a device key in Android
   Keystore; the PC stores the pairing grant in DPAPI and verifies every
   request signature before execution. Revocation is local and fail-closed.
4. Add delegated coding jobs that reuse `DelegationCoordinator`, retaining
   exact branch/worktree/diff-review guarantees and returning only a bounded
   result to the remote client.

The existing Firebase owner identity is sufficient for phase 1 transport but is
not treated as device pairing. Phase 3 is required before privileged remote
actions leave the owner-command scope.
