# Nethra Review Continuation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, with failing tests before behavior changes.

**Goal:** A technical review rejection must lead to useful permitted work and durable continuation rather than an unnecessary owner-input gate.

**Architecture:** Keep the two-proposal limit per work pass, then withhold that tool for the rest of the pass while exposing the full review and available recovery actions. Preserve the normal write approvals, scheduler budgets, and saved checkpoints. Verify against the existing Self Improvement objective with a report artifact and a later pass.

**Tech Stack:** Electron/CommonJS, Node test runner, SQLite, Ollama.

**Spec:** The owner's current instruction: test that Nethra gets on with the actual Self Improvement task.

## Global Constraints

- No fabricated code changes or speedups; report only stored measurements and verified artifacts.
- Keep the existing objective, evidence, and task chat.
- Limit proposal reviews to two per pass; continue local evidence, planning, and drafting afterward.
- Exact overwrites and external actions retain their existing approval rules.

## Review Focus

- A third native or textual proposal call must not invoke an advisor.
- Both 30B and 80B receive the same review recovery state.
- The last review must survive context compaction and a later wake.
- A saved report must contain measured data and exist on disk.
- A later scheduler pass must execute without a new owner input.

### Task 1: Continue after technical review feedback

- [x] Reproduce the forced WAITING_FOR_USER transition in `test/nethra-brief.test.js`.
- [x] Change `src/nethra-runner.js` to cap proposal calls while preserving other work.
- [x] Verify a test runner continues through a real file write and scheduled wake, retaining review feedback.
- [x] Resume the existing technical review gate through both chat routes; leave actual unanswered owner decisions gated.

### Task 2: Deploy and verify actual task work

- [x] Run the Windows suite and package into a separate output directory.
- [x] Replace the stable runtime's archive with verified backup/hash checks and launch through the existing shortcut.
- [x] Give Self Improvement the latest owner direction: measure current performance, write a fresh report, then continue from that evidence.
- [x] Verify its saved artifact, milestone/work checkpoint, and a later unattended execution.
- [x] Record actual outcomes and limitations in an acceptance report.

### Task 3: Review the complete task handling path

The owner asked on 8 November for a full look at task handling and how it enables the model. This audit extends the diagnostic scope, without silently changing execution permissions.

- [x] Trace chat/UI creation, persistence, scheduling, model input, execution tools, continuation and reporting.
- [x] Reproduce capability gaps in an isolated store without changing live tasks.
- [x] Distinguish concrete bugs from deliberate owner-control boundaries.
- [x] Save findings and an ordered repair approach in `artifacts/nethra-task-handling-review.md`.

### Task 4: Repair the confirmed execution data gaps

Ruling: Repair the two high-impact contract bugs found by the requested audit without changing task defaults or owner Start/review/Apply policy. File reads will use bounded structured pages with a stable hash and a durable next-page cursor. The work-status adapter will recognise the existing reviewed Apply receipt as well as legacy promotion. Wider policy/step orchestration changes remain documented design work.

- [x] Reproduce reading a source tail through the runner, continuing its cursor on a later pass.
- [x] Implement structured paged reads inside the same approved text-file limits.
- [x] Reproduce a real Foreman Apply becoming visible to the objective and experiment.
- [x] Replace the stale work-status mapping with one tested shared adapter.
- [x] Run the full suite, install the tested archive, and refresh the acceptance evidence.

## Execution Ledger

Ruling: Preserve the current integrated checkout on a new `codex/nethra-review-continuation-20261108` branch. It contains the already deployed model and task repairs; creating a clean worktree would omit those uncommitted dependencies. No unrelated changes are staged or committed.

Ruling: The owner's latest instruction replaces the prior stop-after-two technical-review direction. Advisor reviews remain capped at two per pass; permitted evidence, planning, drafting and scheduling continue.

Verification: The recovery regression failed on the old forced WAITING status, then passed with a real report file and a later scheduler completion without owner input. The updated Windows suite passes 373 tests. A fresh reviewer found no actionable issue in the runner cap.

Live evidence: Self Improvement called `performance_report`, saved `baseline-20261108.md`, and its SHA-256 matches the completed action receipt. It contains the actual 69,331 ms median from nine task inference samples and explicitly disclaims a measured speedup. Two automatic continuations were observed with 44 owner inputs unchanged. Host gate recovery and controlled restarts are recorded separately in the acceptance evidence.

Ruling: Routine draft refreshes save immutable revisions even when the model selects request_approval; only a current verified task-owned receipt qualifies. Manual/external changes and uncertain interrupted writes retain exact approval. The failing regression reproduced WAITING_FOR_USER, then passed while preserving the original and continuing with the new receipt.

Verification: Full `npm test` passed; the final Node group has 390 passes and zero failures. The nonblocking check-in and approval/revision deltas received review. The installed archive SHA-256 is C5F7F3DCA4D5952A4828C0CC3D92788703D59321C97DA0BFAC022A8BE8B6771D. The host launched through Nethra.lnk and the scheduled task was re-enabled.

Audit: Isolated reproductions initially confirmed unreachable long-file tails, incorrect diagnostic model identity, limited chat-to-task configuration, and whole-task stopping on a routine continuation question or three prose-only turns. Source review also found the reviewed-Apply/work-status mismatch. The review distinguishes bugs from policy: 30B remains the documented new-task default until a task model is explicitly selected, and owner Start/review/Apply remains intentional. Task 4 repairs file paging and the Apply mapping; other configuration and lifecycle gaps remain explicitly documented. No new permission grant was made.

Task 4 verification: Paged reads and reviewed Apply regressions failed before the fixes and pass afterward. The page regression reopens the SQLite store and hands off from 30B to 80B before reading the exact tail. Review found a stale-source restart blocked by the duplicate-read guard; a typed source-change invalidation was reproduced and fixed while retaining the unchanged-file guard.

Ruling: The final live restart exposed a 9,122-character protected seed blocked by the 9,000-character limit despite an estimated 4,840 input tokens against a 14,592-token budget. Treat the character limit as a shedding target in the runner and retain fitContext's estimated-token guard; preserve the full saved review and cursor. This avoids dropping task constraints. The actual oversized-context regression still blocks before inference.

Final package: Full npm test passed, final Node group 395/395. Archive SHA-256 FC157B4038388422EB3300203D1E607C133219A5F43E779D940C702DE7DB9469. The known context-cap block was recovered without adding an owner input, preserving task state. Fresh acceptance passed at 2026-11-08T17:54:28Z: task ACTIVE on 80B, owner-input count unchanged at 44, three automatic continuations, two controlled restarts, four recorded host gate recoveries, no pending approval, and actual tool work after the final deployment. Installed source matches the tested modules. This is bounded continuation evidence; the optimization itself remains under technical review and has no verified speedup.
