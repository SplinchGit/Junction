# Junction Architecture

Junction is a single Android application. Its runtime accepts owner input through
the UI and voice surfaces, builds assistant context, asks an LLM provider for a
response, then routes any requested action through planning, trust checks, owner
approval, execution, verification, and audit logging.

The first PC companion integration lives in `services/pc-companion`. It is a
separate loopback-only Windows platform adapter rather than a second assistant
runtime. Its typed proposals, provenance labels, and audit events preserve this
pipeline; its initial capability is bounded, read-only UI Automation inspection.

```text
UI
  -> Assistant runtime
  -> Provider
  -> Tool calls
  -> Plan
  -> Trust evaluation
  -> Owner approval
  -> Tool execution
  -> Postcondition verification
  -> Audit log
```

## Boundaries

- **Assistant runtime** is a thin orchestration facade for owner input, context
  assembly, provider calls, response streaming, and plan handoff. Focused
  coordinators own conversation state, provider routing, memory operations,
  plan lifecycle, tool dispatch, and voice state.
- **Features** own user-facing capabilities such as chat, voice, feed,
  notifications, Gmail, scheduling, settings, and updates.
- **Data** owns Room persistence, preferences, secret storage, and synchronisation.
- **Platform** owns direct Android and SDK integrations, including accessibility,
  Bluetooth, Firebase initialisation, and Shizuku support.
- **UI** contains reusable Compose components and the app theme; feature-specific
  screens belong with their feature.
- **Evaluation** contains runtime measurement and scenario tooling. Unit and
  instrumentation tests mirror their production package where practical.

## Refactor constraint

The package reorganisation is deliberately behaviour-preserving. Package moves
may update declarations, imports, manifests, and tests, but must not change Room
table names, migration behaviour, persisted preferences, or tool semantics.

## Assistant runtime components

`assistant/runtime/ChatManager.kt` connects the following focused components:

- `ConversationCoordinator` manages sessions, persisted messages, and trimming;
- `ProviderRouter` selects providers and handles health, escalation, and fallback;
- `MemoryService` owns durable fact CRUD and memory-context formatting;
- `PlanCoordinator` manages plan proposal, approval, cancellation, and execution;
- `ToolExecutor` dispatches approved calls to existing capabilities;
- `VoiceCoordinator` manages local and realtime voice state and services.

These components preserve the existing flow and dependencies. They do not add a
new framework, Gradle module, persistence schema, or tool abstraction.


## Nethra task lifecycle and presentation (P0, November 2026)

The existing Nethra SQLite store remains authoritative. Schema 6 adds `task_deletions` for durable deletion receipts and pending cleanup. Deletion fences the scheduler lease and inference accounting before removing the task, wakes, journal, approvals, model jobs and workspace-owned records. Its ordinary conversation remains. Stale mutations and task saves cannot restore tombstoned IDs; request binding still rejects a reused ID with a different payload.

The existing scheduler maintenance pass retries workspace cleanup and the API's related-work cleanup. Task-owned Work Activity is stopped through Foreman, queued device commands are cancelled, and late results cannot wake a deleted task. Independent project records and reviewed code artifacts are retained. Cleanup failures remain in the tombstone and `nethra.status.deletionCleanup`; they are not falsely reported as completed cleanup. Deleting a dependency blocks dependent work. An explicit owner replan/redirect can waive deleted dependencies, with a journal event; metadata corrections cannot.

Android's Tasks page and chat task sheet share a fixed `TaskDetailHeader`. Delete is visible above the scrolling detail, including while details are unavailable. The list also exposes Delete. Confirmation is required; cache removal follows host acknowledgement. `ObjectiveRefreshGate` discards responses begun before deletion or navigation changes. Existing persisted request IDs continue to cover transport retries. `nethra.list` accepts an optional `offset` and returns `nextOffset`, so older records are accessible within the paired transport's byte limit.

Normal task details show activity, progress, owner decisions and the next wake. Diagnostics starts collapsed. `nethra.get` accepts `diagnosticsCursor: {seq, offset}` and returns bounded event fragments plus `nextCursor`; clients can retrieve full journal text without truncating approval payloads. The existing chat reporting module emits meaningful accomplishments and outcomes rather than transcripts of routine tools. Durable message identities distinguish repeated completion episodes after an owner resumes work.

`nethra.edit` adds optional `instruction` and `execution` (`preserve`, `replan`, `continue`). The API resolves clear restart/wording intent, asks for clarification on ambiguous instructions for stopped tasks, and binds the resolved operation to its original request. Store transitions remain deterministic, preserve verified evidence, and never grant additional file roots or coding permissions. Explicit continuation can reopen a finished task; metadata corrections preserve its status.

Schema upgrades are additive. Older binaries reject schema 6 rather than silently dropping deletion protection. Rollback requires the pre-upgrade database backup and its matching runtime, not manually lowering `user_version`. Existing task/model/checkpoint/settings and conversation data are retained.

See `docs/NETHRA_P0_DELIVERY.md` for changed files, actual validation and device acceptance instructions. P1–P5 notification, voice and shared-project evolution are not part of this P0 change.


### Nethra task outcome notifications (November 2026)

Host task transition events now feed the existing signed device-command queue for a single explicitly selected Android phone. Existing update and quiet-hour settings gate enqueue and delivery. Android stores outcomes in the existing feed and routes taps to the exact task; acknowledgements do not wake objectives. No new inference or scheduler pipeline was added. See [P1 delivery and recovery details](NETHRA_P1_DELIVERY.md) for the implemented subset, additive settings, crash semantics, tests and remaining work.

Verified monitoring milestones also use this delivery path: the existing minute report sweep groups same-task events into closed 15-minute windows, suppresses unchanged monitoring, and rechecks policy and current task state at delivery. Indexed journal queries retain sequence-based ordering across clock changes. Cross-task grouping and notification reply actions remain unimplemented. Snooze/dismiss use the existing signed device-command result path and durable Android outbox; reminder commands retain their source event and revalidate policy when due.

Android Tasks exposes the same host notification policy through its collapsible Notification settings card, including mode, preferred phone and quiet hours. The settings API accepts phone selection but protects its server-maintained opt-in cutoff. Settings updates serialize asynchronous side effects and restore the previous snapshot on failure, preventing rollback from erasing a later phone update.


### Shared conversational continuation

Local voice recognized text already enters the normal owner instruction route. Task references now prefer the conversation's linked objective, including completed objectives, before unrelated active work; named targets take precedence and ambiguity asks for clarification. Existing paginated task listing finds older objectives. Continuation binds original target, status and revision in the existing request table, preserving replay safety across later completion or owner pause. Control-associated direction is stored through `nethra.message` with optional `noteOnly: true`, preventing a concurrent owner decision from being implicitly answered. Ordinary answer messages retain their existing behavior. No new state authority or inference path was added. See `docs/NETHRA_P2_DELIVERY.md` for scoped integration evidence and remaining work.


The shared per-turn situation briefing resolves a unique linked objective or explicitly lists bounded ambiguous candidates. It prioritizes task/model/decision, call state, approval counts, scheduler status and permission boundaries within 2,400 characters, adding optional facts only as complete lines. This also applies to local voice via the established Android LAN/relay route; it does not start another model call or create persistent voice state.
