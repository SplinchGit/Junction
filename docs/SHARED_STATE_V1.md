# Junction shared state v1

Shared state is disabled until the owner signs in and opts in on each device.
Local databases remain the working copies; Firestore is the convergence layer for
the same Firebase owner, not an action transport.

The protocol requires no custom always-on Junction server and is designed to fit
Firebase's Spark plan for a small owner deployment. Firestore currently documents
no-cost quotas of 50,000 reads/day, 20,000 writes/day, 1 GiB stored data, and
10 GiB/month egress for the eligible free database. This is quota-backed, not an
absolute promise of permanent zero cost; the owner should keep the project on
Spark and monitor Firebase usage. See https://firebase.google.com/pricing.

## Collections and trust boundaries

- `shared_conversations/{id}`: last-write-wins title metadata by `updatedAt`; a
  non-null `deletedAt` tombstone wins over live state. Physical deletion is denied.
- `shared_conversations/{id}/messages/{id}`: immutable set-union messages. Role,
  content, provenance, source, device, and timestamp cannot be updated or deleted.
- `shared_memory/{id}`: immutable OWNER-provenance, owner-confirmed facts. Only
  `deletedAt` may change. Facts replay locally as JUNCTION context.
- `feed_items`: read-only in the Windows client. The existing Android producer
  remains the source until a dedicated shared Feed protocol replaces it.
- `remote_commands`: deliberately separate. Linking devices does not create a
  command or authorize any PC action.

Only `OWNER`, `JUNCTION`, and `UNTRUSTED` provenance values are accepted. Synced
history is context only: neither Android nor Windows treats an imported message as
the live owner trigger for a tool call. Provider API keys, Firebase refresh tokens,
raw screenshots, raw PC context, tool arguments, and plan text are absent from all
shared contracts.

## Conflict, retention, and deletion

- Messages are immutable and merge by ID (set union).
- Conversation title metadata uses the greatest `updatedAt` observed by clients.
- Tombstones win over live records to prevent resurrection.
- Memory content is immutable; deletion is a tombstone.
- Firestore documents are retained until an owner-approved server retention job
  is implemented. Clients do not silently purge shared history.
- Windows paginates Firestore collection reads in 200-document pages. Server
  retention is still required before large-scale rollout.

Android persists an account-scoped publication index and reconciles deletions to
tombstones before attaching the remote listener, so a deletion survives process
death. Windows persists both tombstones and a durable per-item outbox.

## Preferences and Feed

Preference sync is restricted to the account-level `chatModel` string. Device
permissions, provider/integration state, endpoints, and credentials are invalid
shared preference fields. Windows does not yet consume this preference. Windows
retrieves shared Feed documents only during an explicit manual sync and never
changes them.

Android maintains a live shared conversation-shelf listener while opted in and
imports at most 500 immutable messages per changed conversation. Windows syncs
once at launch and after a local shared-state change while opted in, with a manual
button for retry. It does not poll. Only durable outbox changes are written;
successful documents are acknowledged individually and failures remain queued.
Reads paginate. The Android 500-message import cap remains an intentional cost
control and needs cursor pagination before broad rollout.
