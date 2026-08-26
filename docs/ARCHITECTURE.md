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
