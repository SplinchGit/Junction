# Nethra Continuous Tasks and Chat Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Use failing regressions before behavior changes and one final code review.

**Goal:** 80B can make durable progress over unattended passes, and the owner can ask questions, answer missing decisions, and steer the same task through chat.

**Architecture:** Share a versioned task contract between the runner, task detail API and ordinary chat tools. Represent owner questions explicitly, including their reason and affected plan step; continue executable work when a question does not block it. Reuse SQLite checkpoints, existing model profiles and the current permission boundaries.

**Tech Stack:** CommonJS/Node, Electron, SQLite, Ollama, existing Android/LAN protocol.

**Spec:** The owner approved the findings and scope in `artifacts/nethra-task-handling-review.md`, then requested implementation and live continuous-task/chat testing with 80B.

## Global Constraints

- Keep model-independent task state and explicit task model selection. New tasks retain the documented 30B default unless 80B is selected for that task.
- Preserve current source roots, draft revisions, exact overwrite approvals, owner pauses and code Start/review/Apply policy.
- Questions about progress are nonblocking. A blocking question must name a genuine missing preference, clarification, access or authorization; a step-scoped question cannot stop independent pending steps.
- Owner chat messages are durable, idempotent inputs. Status queries do not become answers. A message cannot grant a pending exact action approval.
- Reports distinguish verified output, model narration, advisor review and applied code.
- No ADB is needed. Host changes are used by the current Android client; validate the common chat path and the running app.

## Review Focus

- Owner messages arriving during inference must fence stale model actions without losing saved progress or the new message.
- A blocked plan step must remain incomplete while another executable step runs.
- Cross-chat task instructions must reach the right task and replies must return to the originating owner conversation.
- Repeated chat requests and work events must remain idempotent across restart.
- REVISE feedback cannot be reported as approved or as completed implementation.

### Task 1: Share capabilities and typed owner questions

**Files:** create `apps/windows/src/nethra-task-contract.js`; modify `nethra-tools.js`, `nethra-runner.js`, `nethra-store.js`, `nethra-api.js`, `nethra-progress.js`; tests in `test/nethra-task-contract.test.js` and runner/store suites.

**Interfaces:** `taskContract(task,{toolNames,state,workStatus})` returns current model/profile, permitted tools/scopes, continuation policy, executable/blocked steps and pending questions. `ownerQuestion(task,state,args,at)` creates a bounded, stable question record and reports whether all useful work is blocked. Questions use `reason`, `blocking`, optional `step`, and an idempotent question ID.

- [x] Write and run failing tests for routine questions continuing through a real draft write, one blocked step alongside another executable step, a genuine task-wide blocker, and an owner answer unblocking it.
- [x] Persist typed questions in task JSON, expose them in the shared contract and task progress, and prevent unresolved blocked steps being marked complete.
- [x] Use the contract in the model seed and API; derive diagnostics/advisor model identity from the selected task profile.
- [x] Verify the full Windows suite after the compatible tool/test updates.

### Task 2: Connect ordinary task chat and model chat tools

**Files:** `nethra-conversation.js`, `nethra-task-turn.js`, `nethra-store.js`, `local-agent-tools.js`, `main.js`; tests in conversation/task-turn/tool suites.

**Interfaces:** `store.chatTurn(id,text,requestId,{conversationId})` preserves the reply destination and answers the latest open question when appropriate. `objectives.message({reference,message,conversationId,requestId})` routes a model chat tool into that same path. The task runner replies to the conversation recorded on the owner input.

- [x] Reproduce a linked task-chat instruction containing “task” being swallowed as a status check, and a cross-chat direction being omitted from task state.
- [x] Restrict status interception to status/control requests; save ordinary directions and questions as task inputs.
- [x] Add `send_objective_message` to ordinary chat, with current task resolution and idempotent request IDs.
- [x] Permit explicit model/continuous selection when a chat starts a task; preserve the existing default otherwise.
- [x] Verify answers, steering during inference, pause/resume and exact approval retention.

### Task 3: Connect code-work lifecycle and truthful continuation

**Files:** `nethra-work-status.js`, `nethra-scheduler.js`, `main.js`, `nethra-runner.js`; tests in work-status/attention/runner suites.

**Interfaces:** a code-work reconciliation callback emits stable objective attention for relevant Foreman status/verification/apply changes. It runs before scheduler claims and survives missed delivery or restart.

- [x] Reproduce an applied/completed project failing to wake its sleeping objective; verify one stable event and no approval/owner-pause bypass.
- [x] Wire the read-only work reconciliation into the scheduler.
- [x] Reproduce REVISE being followed by an unsupported “approved and complete” milestone, and keep actionable technical review pending.
- [x] Run the full suite and obtain a final review.

### Task 4: Deploy and test real 80B continuous work with chat

- [x] Package separately, back up and replace the stable archive, refresh shortcuts, launch normally and restore the startup task.
- [x] Create a clearly labelled acceptance task with a local source fixture and the selected 80B model. Verify real draft contents and receipts.
- [x] Observe a later productive pass without another owner instruction.
- [x] Send a real task-chat question and direction, verify its reply and a saved result reflecting that direction, then test pause/resume.
- [x] Verify installed source, model metadata, scheduler state and final task progress. Save an acceptance report separating controlled test inputs from unattended work.

## Execution Ledger

Ruling: Continue on `codex/nethra-review-continuation-20261108` with the integrated uncommitted fixes already installed. A clean worktree would omit those dependencies; unrelated changes remain unstaged and untouched.

Ruling: Implement this inline using the reviewed scope the owner has now approved. Keep existing action permissions; this task does not grant unattended code Apply or new phone/file access.

Pre-flight: Task 1 produces typed question and capability state consumed by chat in Task 2 and truthful continuation in Task 3. The API remains compatible with the existing Android request types; additional detail fields are additive. Task 4 verifies the installed composition.

Implementation verification: The full npm test command passed on 2026-11-08; its final Windows group contains 431 passing tests and zero failures. A fresh final review identified five real issues (late answers, latest-question selection, composite directions, substantive chat queries, relative-reference replay). Each was reproduced and fixed; the focused review suite passed all 54 tests. Runtime archive SHA256: 201E2EF86DF308AAEAC89A6534FAFE400F7F56B912C35895EFF830D8F0FEF69A. All 69 installed source files match the tested source. Startup task restored to Ready.

Live-test ruling: Native Windows capture/activation is unavailable. Use the same owner-work chat handler and Android API selection against the installed app scheduler. No second process writes LocalDataStore. The clearly labelled acceptance task uses an existing owner chat, only fixture data, explicit 80B selection and continuous mode. This verifies the shared host chat path; it is not a phone UI/transport test.


Acceptance complete at 2026-11-08T21:36:24Z: task c2befafe-6cdb-4f33-bffd-c415c5ad5b2e is COMPLETED on the actual 79,674,391,296-parameter Qwen3-Next 80B Q3_K_M. Four claims were observed; two continuations began before any owner input, and draft-1.md and draft-2.md were written in separate passes. The title question was answered while paused; no claim occurred during the 24-second pause. Composite chat resume/formatting survived, final.md contains the requested title and three source-fact bullets, and the installed app delivered its path to the owner chat. No host recovery or task restart occurred in the acceptance run. The model asked for the title before ending the second pass, instead of waiting until the third as requested; this sequencing deviation is recorded in the report. The native phone/Windows UI and LAN transport were not automated; the exact shared handler/API was exercised with Android source selection against the installed scheduler. All 92 packaged source/renderer files match the tested checkout. Evidence: artifacts/nethra-continuous-chat-verified.json and artifacts/nethra-continuous-chat-acceptance.md.
