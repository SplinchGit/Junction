# Nethra progress and performance telemetry

## Intent

Nethra should be able to inspect measured performance on its Windows host without asking the owner to locate logs. The owner should see what each task has actually accomplished, what it will do next, why it is waiting, and whether any performance claim has enough data behind it. The same task facts should work on Windows and Android.

## Approach

Use a native, read-only performance report assembled from Junction's saved local chat usage and Nethra's own recorded inference calls. Expose it through an objective tool and the task detail API. Present the task itself as a progress-first view: current state and next action, completed-plan count, a short host-recorded activity timeline, then a compact performance card. This is preferable to exporting a metrics file (which can go stale) or making a large chart dashboard the primary task view (which obscures actions and blockers).

## Boundaries

- Only measured host records count as telemetry. Each aggregate includes its time window and sample count. Missing or old samples are shown as unavailable, never zero or proof of improvement.
- Aggregate local chat timing without message content or private reasoning. Nethra's inference timing is recorded separately from chat and from its daily budget. The report does not expose arbitrary file paths or credentials.
- A task's own notes remain visibly separate from host-recorded actions. A consultation is advice, not a code change or benchmark result.
- Task activity is bounded and derived from durable events; it must not imply that repeated model planning equals completed work.
- Android receives bounded, read-only progress and telemetry through the existing paired-host API. It cannot grant new Windows-only permissions.
- Existing task controls, connected chat, scheduling and daily inference budget remain intact.

## Success

Nethra can call a native tool and get a recent performance report with source, samples and timings. The Windows and Android task screens show the same verified status, last meaningful action, next action, and a short timeline, with measured performance clearly labelled. An empty history stays intelligible. Focused tests and the existing Windows and Android checks pass.
