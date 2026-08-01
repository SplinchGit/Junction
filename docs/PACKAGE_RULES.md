# Package Rules

Use these placement rules when moving or adding production code.

- User-facing capability: `feature/<name>`.
- Assistant orchestration: `assistant/<responsibility>`.
- Conversation models and persistence adapters: `assistant/conversation`.
- Provider integrations: `assistant/provider`.
- Context and provenance: `assistant/context`.
- Planning, trust, tools, and memory: their matching `assistant` subpackage.
- Room databases, DAOs, entities, preferences, secrets, and sync: `data`.
- Direct Android or third-party platform API wrappers: `platform`.
- Reusable Compose UI: `ui/component`; app theme: `ui/theme`.
- Runtime evaluation and scenario tooling: `evaluation`.

Do not create generic catch-all packages such as `misc`, `helpers`, `common`,
`manager`, or `other`. Avoid loose implementation files in
`com.splinch.junction`; only true application entry points may live near the
root, and they should ultimately be in `app`.

Use feature-first packages for capabilities the owner experiences directly and
responsibility-first packages for assistant internals. Keep names consistent and
avoid nesting that does not convey a clear ownership boundary.

Package moves must preserve runtime behaviour. Update package declarations,
imports, Android manifest component names, and tests in the same change. Do not
rename persisted Room tables or alter migrations as part of a reorganisation.
