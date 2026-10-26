# Nethra Task Unblock and Code Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Nethra moving when its own experiment records contain the answer, and require Codex review plus owner action before Nethra-originated code is implemented or applied.

**Architecture:** Pass bounded host experiment state into the runner, with list and abandon operations. Review a proposed code task through the signed-in Codex advisor before saving a Work Activity draft. Keep verified Nethra-originated changes in an isolated checkout until the owner reviews and applies the exact patch.

**Tech Stack:** Electron/Node, SQLite, native tool schemas, Android Compose UI already changed in the working tree.

**Spec:** [Nethra task continuation and code review](../specs/2026-10-26-nethra-task-unblock-and-code-review-design.md)

## Global Constraints

- Preserve Claude's existing uncommitted changes and the live SQLite task database.
- The deferred THINKING_BUDGET.complex proposal remains deferred.
- A Work Activity draft creates no code and never starts Codex implementation by itself.
- No Nethra-originated code reaches the original checkout without exact-patch review and an owner Apply action.

## Review Focus

- Missing experiment ID: the live task keeps working from saved records instead of stopping for owner input.
- Baseline without applied change: abandoning it is recorded and cannot be reported as an improvement.
- Local cache over 32 MB: code draft creation succeeds without copying transient cache content.
- Advisor unavailable: no code draft is marked reviewed, and no implementation begins.
- Dirty original checkout: reviewed patch application fails without overwriting Claude's work.

---

### Task 1: Experiment state and continuation

**Files:** `apps/windows/src/nethra-store.js`, `nethra-tools.js`, `nethra-runner.js`; `apps/windows/test/nethra-experiments.test.js`, `nethra-runner.test.js`.

- [ ] Add failing tests for listing existing experiment IDs, abandoning an unused baseline, and returning known IDs to the model instead of yielding on that question.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Implement bounded seed/list/abandon behavior and a host-fact retry for redundant experiment-ID questions.
- [ ] Run focused tests green.

### Task 2: Reviewed code draft and safe snapshot

**Files:** `apps/windows/src/nethra-tools.js`, `nethra-code-work.js`, `foreman-executor.js`; `apps/windows/test/nethra-codex-bridge.test.js`, `foreman-executor.test.js`.

- [ ] Add failing tests: exact proposal reaches Codex read-only review before draft creation; advisor failure leaves no draft; snapshot excludes transient npm cache.
- [ ] Run focused tests red, then implement and run green.

### Task 3: Owner-controlled implementation and application

**Files:** `apps/windows/src/foreman.js`, `apps/windows/renderer/foreman.js`, `apps/windows/src/assistant-environment.js`, `self-capabilities.js`; relevant tests.

- [ ] Add a failing Foreman test that a verified Nethra-originated candidate stays in its isolated checkout, while existing ordinary project behavior remains unchanged.
- [ ] Implement the no-auto-promotion rule and visible Start / Review patch / Apply reviewed patch controls.
- [ ] Make chat capability descriptions accurate and test the user-visible answer.
- [ ] Run focused tests, full Windows suite, Android build, desktop packaging and Android release checks; then resume the live objective with the saved experiment IDs in context.
