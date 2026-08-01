# Package Reorganisation Progress

The refactor is intentionally incremental. Each phase must compile and pass its
relevant tests before the next begins.

- [x] Phase 1: add architecture, map, package rules, and this progress log.
- [x] Phase 2: move application entry points into `app`.
- [x] Phase 3: organise assistant runtime by responsibility.
- [x] Phase 4: consolidate voice under `feature/voice`.
- [x] Phase 5: group user-facing capabilities by feature.
- [x] Phase 6: organise persistence and synchronisation under `data`.
- [x] Phase 7: consolidate Android platform integrations.
- [x] Phase 8: reduce root UI to reusable components and theme.
- [x] Phase 9: align unit and Android tests with production packages.
- [x] Phase 10: make the assistant runtime a smaller facade through isolated
  extractions.
- [x] Phase 11: add folder-level ownership READMEs.
- [x] Phase 12: add the VS Code workspace presentation file and assess safe
  repository-level moves.

## Phase 1 validation

- [x] Documentation files exist.
- [x] No production code was changed by this phase.
- [x] `test` passes.
- [x] `assembleDebug` passes.

## Phase 10 validation

- [x] Provider routing lives in `ProviderRouter`.
- [x] Durable memory operations live in `MemoryService`.
- [x] Plan lifecycle coordination lives in `PlanCoordinator`.
- [x] Tool dispatch and tool-specific side effects live in `ToolExecutor`.
- [x] Local and realtime voice state lives in `VoiceCoordinator`.
- [x] Session and message state lives in `ConversationCoordinator`.
- [x] `ChatManager` remains the owner-input, context, provider, streaming, and
  plan-handoff facade.
- [x] `test` passes.
- [x] `compileDebugAndroidTestKotlin` passes.
- [x] `assembleDebug` passes.

## Device validation

- [x] 23 instrumentation tests pass on a physical SM-A528B device.
- [x] The device build uses the existing `JUNCTION_VERSION_CODE` override so
  validation can install over a newer published build without changing source.
- [x] The version-66 debug APK from `apps/android` installs successfully as an
  in-place update after the repository-level module move.
- [x] Android reports a successful cold start for `.app.MainActivity` and the
  Junction process remains alive while the system permission prompt is shown.

## Phase 11 validation

- [x] Ownership READMEs exist for assistant, planning, trust, tools, voice,
  notifications, data, and platform.
- [x] Every folder README is under 100 lines.

## Phase 12 validation

- [x] `Junction.code-workspace` exists, parses as JSON, and exposes direct
  Explorer roots for Android source areas, unit tests, and device tests.
- [x] Explorer and search exclusions hide generated output without hiding
  source, tests, documentation, Gradle configuration, or workflows.
- [x] `.vscode/settings.json` applies the generated-file exclusions when the
  repository is opened directly instead of through the workspace file.
- [x] Required root files are collapsed into Gradle, Firebase, and repository
  file stacks in Explorer.
- [x] Project configuration documentation lives at `docs/CONFIGURATION.md`, and
  the repository licence uses the conventional root `LICENSE` name.
- [x] Non-Android projects are grouped under `apps`, `services`, and `tools`;
  Firebase, CI, scripts, ignore rules, and documentation use the new paths.
- [x] The Android module and web client share `apps/` as `apps/android` and
  `apps/web`, while Gradle retains the stable `:app` module identity.
- [x] `CODEBASE_MAP.md` describes the final package and repository structure.

## Working agreement

Every package-movement phase lists exact moves, updates declarations, imports,
manifest paths, and tests immediately, then records validation here. Existing
unrelated worktree changes remain outside this refactor unless they directly
conflict with a moved file.
