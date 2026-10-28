# Nethra Unified Task Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a linked task chat enter the same durable Nethra session and capability path as a scheduled wake, with one truthful response and no parallel conversational agent answer.

**Architecture:** Keep `NethraStore` as the objective session and `NethraRunner` as its executor. Extract the linked-chat turn into a host-owned adapter that records the owner's message, wakes the objective when runnable, and returns a state-grounded acknowledgement. Both desktop and Android chat already call `handleOwnerWorkInstruction`, so they use the same adapter. The runner refreshes owner input at model boundaries, drops stale tool calls, and can post one later answer in the linked chat. Casual unlinked chat keeps its ephemeral conversational runtime until the broader shared-loop migration.

**Tech Stack:** Electron, Node.js CommonJS, SQLite, `node:test`, local Ollama.

**Spec:** `docs/superpowers/specs/2026-10-27-nethra-unified-agent-design.md` (task-linked entry point of phase 2).

## Global Constraints

- Do not change task storage schema, grants, approved roots, approval receipts, or Work Activity Start/Apply gates.
- Keep the existing task scheduler and single inference queue; a chat message cannot grant capabilities.
- A paused or approval-gated objective does not resume from an ordinary chat note.
- A chat message to a sleeping runnable objective must be visible at its next wake exactly once.

## Review Focus

- Repeated request IDs must not duplicate a task-chat input.
- A task chat question must not be answered by a separate local conversational model while the objective is active.
- A pending approval must not be interpreted as granted by a chat reply.
- An ongoing sleeping objective must react to an owner message without waiting for its routine monitor interval.
- Android and desktop chat entry points must share the same behavior.

---

### Task 1: Durable linked-chat turn

**Files:** Create `apps/windows/src/nethra-task-turn.js`; modify `apps/windows/src/nethra-store.js`, `apps/windows/src/main.js`; test `apps/windows/test/nethra-task-turn.test.js`.

**Interfaces:** `handleTaskTurn({store,conversationId,content,requestId})` returns `null` when no open task is linked, otherwise a host-authored response string. It records exactly one owner input and gives runnable sleeping work an early wake. `main.js` calls it after explicit Nethra commands and before generic owner-work or chat routing.

- [x] Write failing tests for linked task note and response, duplicate request ID, sleeping ongoing wake, paused and approval-gated behavior, and unlinked chat.
- [x] Run `node --test test/nethra-task-turn.test.js`; confirm the expected failures.
- [x] Implement the adapter and store request deduplication without changing existing task records.
- [x] Run the focused test and `npm test`; confirm zero failures.

### Task 2: Active-turn steering and task-owned reply

**Files:** Modify `apps/windows/src/nethra-runner.js`, `apps/windows/src/nethra-tools.js`, `apps/windows/src/nethra-scheduler.js`; test `apps/windows/test/nethra-task-turn.test.js`.

- [x] Write and fail a test where an owner message arrives during inference and the old tool call is discarded.
- [x] Refresh the runner's seed from durable owner inputs before each model call and reject stale actions at the execution boundary.
- [x] Write and fail a test for a task-owned reply appearing once in the linked conversation.
- [x] Add `reply_to_owner` only when a linked conversation exists; use a stable message ID and retain task evidence.
- [x] Verify an owner wake of an ongoing monitor is not swallowed by routine idle bookkeeping.
- [x] Run focused tests and the full Windows suite.

### Task 3: Verify task completion and shared entry points

**Files:** Modify `apps/windows/src/nethra-runner.js` and test `apps/windows/test/nethra-runner.test.js` only if live acceptance exposes a completion gap; add `apps/windows/scripts/nethra-unified-host-smoke.js` for desktop IPC verification.

- [x] Run the linked-chat tests through the same host handler used by desktop and relay, and verify desktop IPC in a disposable Electron profile.
- [x] Run a real-model disposable objective; it exposed a false completion when the model copied a witness from success criteria without reading the requested source.
- [x] Write the failing completion test, require recorded `read_file` evidence for explicit local file-read objectives, and pass the focused test.
- [x] Rerun the real-model disposable objective and confirm source read, report write, completed plan, and `COMPLETED` status. The acceptance run completed in 149 seconds with `read_file`, `write_draft`, and a verified witness.
- [x] Run a real interactive chat smoke and check the separate casual-chat path still works. The `qwen3:30b` post-2023 Python scenario passed with one web search and a valid citation.
- [ ] Compare the packaged host's agent modules with source before claiming the installed application contains the change.

The live run also found that a relative `read_file` path found by `list_directory` did not resolve in a separate approved read root. A failing regression test now covers approved-root resolution and ambiguity; the full 339-test Windows suite passes after the fix.

## Scope note

This plan unifies task-linked chat with the durable objective session. The full spec's ephemeral-chat migration, one capability registry for every surface, replay curriculum, and Android rollout remain separate deliverables and must not be claimed complete from these checks.
