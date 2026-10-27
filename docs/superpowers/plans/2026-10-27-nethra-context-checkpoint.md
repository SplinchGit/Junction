# Nethra Context Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Nethra task model request fit its configured context budget and retain the unresolved working facts needed at the next wake.

**Architecture:** The existing context fitter will compact old tool results, then remove old complete exchanges, and report failure if the protected prompt still exceeds budget. A host-owned checkpoint in the task JSON will retain the most recent code review and experiment facts, and a structured seed builder will include it without truncating the entire seed into opaque text. The runner checks the final fit before Ollama, records measured prompt tokens after replies, and yields a diagnostic when even the protected context cannot fit.

**Tech Stack:** Node.js CommonJS, `node:test`, SQLite through `NethraStore`, Ollama `prompt_eval_count` telemetry.

**Spec:** `docs/superpowers/specs/2026-10-27-nethra-unified-agent-design.md`, phase one only.

## Global Constraints

- Keep the Windows host, local `qwen3:30b`, and `num_ctx: 8192`; raising context size is separate measured work.
- Keep system instructions, the structured seed, and the latest exchange when compacting.
- Do not treat a model statement or advisor advice as a verified code change or benchmark.
- Preserve existing approved roots, receipts, and Work Activity gates.
- No Android UI or chat/task unification changes in this slice.

## Review Focus

- A long sequence of assistant tool calls without large tool results must still fit or fail before model submission (Task 1 test).
- A protected seed alone exceeding the budget must produce a clear failure with zero model calls (Task 1 integration test).
- A `REVISE` review must survive a new wake with its exact verdict and objections (Task 2 replay test).
- A large owner-note/guide combination must retain a valid JSON seed and the latest owner direction (Task 2 seed test).
- A task with no review or experiment must still run with an empty checkpoint (Task 2 regression test).

---

### Task 1: Strict context admission

**Files:**
- Modify: `apps/windows/src/model-context.js`
- Modify: `apps/windows/src/nethra-runner.js`
- Test: `apps/windows/test/nethra-context.test.js`

**Interfaces:**
- `fitContext(messages, tools, options)` mutates the message list, returning `compacted`, `removedExchanges`, `estimatedTokens`, `budget`, and `fits`.
- `NethraRunner` calls the model only when `fits === true`; it saves a diagnostic checkpoint and yields otherwise.

- [ ] **Step 1: Write failing tests** for old assistant/tool exchanges that remain over budget after tool-result clearing; assert the fitter removes complete old exchanges, preserves system/seed/latest exchange, and returns `fits: true`. Add an oversized protected-seed runner case that asserts zero calls to `runtime.chat` and a resumable diagnostic outcome.
- [ ] **Step 2: Run** `node --test test/nethra-context.test.js`; expect those tests to fail for missing exchange removal and missing admission check.
- [ ] **Step 3: Implement** complete-exchange removal in `fitContext` and fail-closed admission in `NethraRunner`; never send a request with `fits: false`.
- [ ] **Step 4: Run** `node --test test/nethra-context.test.js`; expect all tests to pass.
- [ ] **Step 5: Commit** the changed source and test files.

### Task 2: Durable structured working checkpoint

**Files:**
- Create: `apps/windows/src/nethra-checkpoint.js`
- Modify: `apps/windows/src/nethra-store.js`
- Modify: `apps/windows/src/nethra-runner.js`
- Test: `apps/windows/test/nethra-brief.test.js`
- Test: `apps/windows/test/nethra-store.test.js`

**Interfaces:**
- `checkpointAfterTool(previous, {name,args,result,at})` returns bounded host-recorded working facts; it never marks advice as an applied change.
- `seedForWake(seed, maxChars)` returns a valid structured JSON string, shedding optional history before current checkpoint or latest owner direction.
- `NethraStore.update` accepts `contextCheckpoint`; it persists across close/reopen.

- [ ] **Step 1: Write failing tests** that run a `REVISE` proposal, restart the runner on the saved task, and inspect the second wake's seed for the review and proposal; test SQLite reopen; test optional-history shedding with latest owner direction retained; test empty checkpoint.
- [ ] **Step 2: Run** `node --test test/nethra-brief.test.js test/nethra-store.test.js`; expect failures for missing checkpoint persistence and seed construction.
- [ ] **Step 3: Implement** `checkpointAfterTool` and `seedForWake`; update the runner's checkpoint with the evidence transaction and refresh the seed before model calls. Keep review feedback bounded but sufficient to preserve all enumerated objections.
- [ ] **Step 4: Run** `node --test test/nethra-brief.test.js test/nethra-store.test.js test/nethra-context.test.js`; expect all tests to pass.
- [ ] **Step 5: Run** `npm test`; expect the full Windows suite to pass. Commit the changed source and test files.

## Verification and delivery

Inspect the final diff against the five Review Focus cases, run `git diff --check`, and report the exact test counts. Then review the whole branch before integrating. Installed Windows package replacement and Android delivery are separate from this first slice unless required for the user to test this Windows-only runner change.
