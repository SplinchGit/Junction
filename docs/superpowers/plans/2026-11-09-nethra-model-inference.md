# Nethra Model Inference Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline for the host; an independent UI agent implements the explicitly requested chat disclosure. Use failing regressions before behavior changes and a fresh final review.

**Goal:** Nethra can direct measured local inference, finish its real benchmark and report back; action details are collapsible in chat.

**Architecture:** A bounded job adapter calls the existing local priority queue, checkpoints each sample in SQLite and writes result drafts through existing permissions/receipts. The task contract carries available inference capability and saved job cursors. Existing shared chat routing and desktop/Android rendering remain the entry points.

**Tech Stack:** Node/CommonJS, SQLite, Ollama, Electron, Kotlin Compose.

**Spec:** `docs/superpowers/specs/2026-11-09-nethra-model-inference-design.md`.

## Constraints and review focus

- No recursive inference lock: the parent turn releases its queue slot before tool execution.
- Charge every sample through scheduler inference accounting; preserve owner preemption, pauses and daily limits.
- Keep model/context/options fixed per measured job; never fabricate metrics or mix partial/error responses into averages.
- Retries and restart continue saved samples; a completed job does not repeat inference.
- Independent prompt work has no tools, parent history, URLs or shell access.
- Host capability reconciliation cannot grant unrelated file/API/code permissions.
- Preserve the dirty integrated checkout; no broad staging/reset. User repeatedly opted out of approval interruptions.
- Keep unrelated chat text and owner questions visible when action detail is collapsed.

### Task 1: Durable queued inference tool

- [x] Add red regressions for exact repeated context, actual model metrics, partial/restart resume, completed replay, pause/preemption accounting and bounded input.
- [x] Add job storage, adapter, tool schema, task contract/checkpoint wiring and old model-access gate reconciliation.
- [x] Verify focused tests and task chat routing regression.

### Task 2: Collapsible task action logs

- [x] Independent UI agent implements existing-text parsing and accessible default-collapsed details on Windows/Android.
- [x] Keep complete copy/export text and verify focused parser/render/Kotlin checks.

### Task 3: Verify, deliver and run the actual benchmark

- [x] Run the full Windows suite and Android build/checks; get fresh code review and fix findings.
- [x] Install the Windows archive through the existing stable runtime, refresh shortcuts and startup task. Deliver the signed Android update without ADB.
- [x] Resume the existing benchmark task using the new capability and observe genuine saved samples to all 50, computed metrics and a task-chat report. Distinguish controlled setup from model-directed tool use.
- [x] Record installed hashes, output receipts, live model evidence and material limitations.

Execution ledger (2026-11-09): Full npm test passed; final Windows group 441/441. Android Kotlin compile + APK assembly and 212 JVM tests passed. A fresh review found temperature and qwen3:30b output-budget mismatches in the shared runtime; both were reproduced and fixed through a raw-measurement path that retains native final metrics and exact requested settings. Isolated Electron tests verified collapse, keyboard toggling, state across redraw and complete-message copy.

Live testing exposed two further integration errors: completed jobs still had a resume hint, and a three-sample job was allowed to mark a fifty-prompt execution step done. The final runtime now distinguishes job completion from objective completion, rejects an undersized new benchmark job, corrects old plan bookkeeping and refuses completion without the required measured count. Three controlled deployment restarts occurred; all earlier samples were preserved. Owner input count remains four. The actual fifty-sample job is model-bf6293f79f41973cea10e064774ab357 and is running under the installed scheduler.

Android source delivery: isolated Git index committed only the three UI source/test files as c8b0ad1fa9bb2bc57e6cf7c06b06e4284552f249 and advanced origin/main from 8b903cd. Root working tree/index and Windows changes remained untouched. CI build 189 produced a signed APK, then GitHub Actions internal server errors prevented downstream emulator/publication jobs; build 190 failed to start during the confirmed Actions incident. Same certificate as published build 188 was verified. APK build 189 is published as a prerelease fallback at https://github.com/SplinchGit/Junction/releases/tag/android-task-actions-189; normal Pages feed is still 188 and pending service recovery. No ADB or phone installation was performed.

Final Windows runtime archive: 97A932D35C7D83A49B36D08D64B0ACF421C6F8C8A96BDECDBA597928E794C373. Shortcuts still target the complete stable runtime; startup task is enabled/Ready. See model-total-count installation metadata and the live acceptance report when complete.


Final acceptance, 2026-11-09 19:02 UTC: the existing benchmark task is COMPLETED and its final Done message is posted in its linked chat. All fifty native measurements, normal write receipts, the model-written summary values and the final chat average were verified. Mean per-run output rate 17.453 tokens/sec; aggregate generation throughput 17.023 tokens/sec; mean timed-call completion latency 1434.92 ms. Total timed calls 71746 ms, excluding controller/debugging overhead. Five controlled deployment restarts occurred during implementation; no new owner steering input was injected. Saved jobs resumed without repeating completed measurements.

The 48-sample stall was confirmed by the corrected adapter's audit data: resume supplied fields [samples], requestedSamples 2, remainingBefore 2, savedTotal 50. Resuming now accepts unchanged context metadata and a remaining-count hint without changing the job's immutable request. The screenshot also exposed stale plan projection and a separator-free finish_objective JSON call; verified model-sample counts now take priority in the live progress text, and the bounded known-tool parser accepts optional whitespace. Fresh inference-only objectives can complete from their own verified result receipt.

Final validation: full npm test passed, final Windows group 447/447. All 93 installed source/renderer files match. Archive SHA256 BA90C640131748166DE39614063CF714341F400F7E3A1F77EFAED454EC72A647. Android build 191 (101191) completed all CI stages including emulator install/launch smoke and normal Pages publication. The downloaded APK hash and signing certificate match the updater and installed lineage. Physical phone installation is left to its normal OS update prompt; no ADB was used. The build-189 prerelease fallback remains available but is superseded by the normal 191 feed.

Evidence: artifacts/nethra-model-inference-acceptance.md, artifacts/nethra-model-inference-acceptance.json, artifacts/nethra-android-task-log-delivery.json, and https://github.com/SplinchGit/Junction/actions/runs/42677170957.
