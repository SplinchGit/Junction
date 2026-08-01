# Package Reorganisation Progress

The refactor is intentionally incremental. Each phase must compile and pass its
relevant tests before the next begins.

- [x] Phase 1: add architecture, map, package rules, and this progress log.
- [ ] Phase 2: move application entry points into `app`.
- [ ] Phase 3: organise assistant runtime by responsibility.
- [ ] Phase 4: consolidate voice under `feature/voice`.
- [ ] Phase 5: group user-facing capabilities by feature.
- [ ] Phase 6: organise persistence and synchronisation under `data`.
- [ ] Phase 7: consolidate Android platform integrations.
- [ ] Phase 8: reduce root UI to reusable components and theme.
- [ ] Phase 9: align unit and Android tests with production packages.
- [ ] Phase 10: make the assistant runtime a smaller facade through isolated
  extractions.
- [ ] Phase 11: add folder-level ownership READMEs.
- [ ] Phase 12: add the VS Code workspace presentation file and assess safe
  repository-level moves.

## Phase 1 validation

- [x] Documentation files exist.
- [x] No production code was changed by this phase.
- [ ] `test` passes.
- [ ] `assembleDebug` passes.

## Working agreement

Every package-movement phase lists exact moves, updates declarations, imports,
manifest paths, and tests immediately, then records validation here. Existing
unrelated worktree changes remain outside this refactor unless they directly
conflict with a moved file.
