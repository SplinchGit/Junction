# Continuous Agent Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Nethra's ongoing objectives progress across bounded wakes and stop wasting inference on non-actions.

**Architecture:** Extend the existing Windows runner and scheduler, retain SQLite leases and existing phone API. Test every state transition with the real store and mocked model/source responses.

**Tech Stack:** Node/Electron, SQLite, Ollama qwen3:30b, Kotlin companion unchanged.

**Spec:** `docs/superpowers/specs/2026-10-23-continuous-agent-cycle-design.md`

## Global Constraints

- No additional model or runtime; one local 30B inference at a time.
- No automatic external write or elevated tool permission.
- Preserve the owner SQLite database and installed phone data.
- Keep Firebase relay write frequency unchanged.

## Review Focus

- Calendar/Gmail content must be task-authorized, fresh, and remain untrusted data.
- A source failure must not be narrated as a successful check.
- Model prose alone must not prove completion or trigger repeated expensive calls.
- An inference crash must retain a bounded error and future retry after restart.
- A sleeping objective must not spin at the scheduler heartbeat rate.

### Task 1: Evidence and bounded reasoning

**Files:** `apps/windows/src/nethra-runner.js`, `apps/windows/src/nethra-tools.js`, `apps/windows/test/nethra-runner.test.js`, `apps/windows/test/nethra-tools.test.js`

- [x] Add failing tests for fresh source evidence, stale rejection, and two prose-only turns.
- [x] Implement the smallest guard and rerun focused tests.

### Task 2: Error and idle wake recovery

**Files:** `apps/windows/src/nethra-runner.js`, `apps/windows/src/nethra-scheduler.js`, `apps/windows/test/nethra-scheduler.test.js`

- [x] Add failing tests for durable retry and no-inference unavailable-source wake.
- [x] Implement, reopen SQLite, and rerun scheduler tests.

### Task 3: Product verification

- [x] Run Windows full tests and Electron UI smoke.
- [x] Verify a multi-wake objective and restart with mocked model responses.
- [ ] Rebuild the Windows package only with zero owner leases; verify listeners.
- [ ] If ADB attaches, install/smoke the current published APK and inspect task state; otherwise report physical-phone verification separately.
