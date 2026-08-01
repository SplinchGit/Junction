# Junction Architecture

Junction is a single Android application. Its runtime accepts owner input through
the UI and voice surfaces, builds assistant context, asks an LLM provider for a
response, then routes any requested action through planning, trust checks, owner
approval, execution, verification, and audit logging.

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

- **Assistant runtime** owns conversation orchestration, context, providers,
  plans, trust decisions, and tool dispatch.
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
