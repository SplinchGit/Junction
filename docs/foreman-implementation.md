# Persistent foreman implementation ledger

## Native coordination and shared main checkout (2026-11-12)

The Self Improvement task has an explicit Windows **Enable coordination** control. It requires persistent work, its ordinary linked conversation, approved development access and a non-private task. Coordination runs through the existing scheduler and task lease without asking the local model to search for an implementation plan. Existing task JSON stores `coordination` and `coordinateSelfImprovement`; no separate database or destructive migration is introduced.

The latest owner direction is bounded and saved as the common advisor brief. `GPT brief: …` is accepted, but ordinary owner direction also changes the brief. Read-only Codex and Claude consultations save independent receipts. Missing advisors retry at their reported reset plus one minute, or after 30 minutes when no reset is known. An uncertain interrupted request requires an explicit retry. Full advice remains labelled as advice in Windows task diagnostics. The task asks which concrete advisor proposal to draft, preserving measurable acceptance and requiring the existing Codex READY review and owner Start gate. Malformed proposals cannot become engineering authority; retry repairs only incomplete advice.

New coordinated drafts use `sharedCheckout: true`. Both providers inspect the same canonical checkout on `main`. Shared Codex runs in a read-only sandbox and returns a patch; Claude's subscription client remains tool-less and returns a patch. The executor checks unchanged source, the current owner direction/permission, exact existing-file scope and protected verification paths before applying a provider-authored patch. Providers cannot use this route to change tests, configuration, dependencies or protected paths. Larger/new-file scope needs a separately reviewed engineering change. This deliberately preserves existing permission boundaries rather than granting an unrestricted shell.

One cross-process writer lock in the Git common directory covers dispatch, patch application and verification. No provider-specific source checkout is created. A detached checkpoint is used only to run fixed verification commands and retain review evidence. Its source manifest is synchronized exactly, including removing stale files left by a failed verification. The canonical checkout is never committed, staged, reverted or pushed by shared Foreman execution. Owner edits present at the baseline are preserved. The canonical diff and detached verification receipt must be reviewed by the authorised engineer before a main commit. Old isolated work records retain their prior review/apply semantics; they are not silently converted.

Verified live provider windows govern handoff at 95% usage. Fresh account data supersedes an older saved deadline after a usage reset. **Check provider availability** rechecks an active capacity wait through `task.control` with `action: retry`; it cannot resume paused/stopped work. Pause and Stop clear timers and abort active dispatch. Objective Pause records its origin so objective Resume can resume only engineering that it paused, not work independently stopped by the owner. Revoking development permission, editing scope or redirecting the task pauses linked engineering; a changed brief also blocks patch application and subsequent dispatch. Crash recovery remains PAUSED until explicit reconciliation; a Resume before a saved reset waits for that reset rather than assuming capacity. With neither provider available the wait ends at the earliest confirmed reset, or at a bounded recheck when a provider reports none; nothing is dispatched on an assumed availability.

Shared patches are applied by the Foreman host process itself, so the lock records that host's `pid`. After a host crash, the next writer reclaims the lock only when that recorded process has exited, under a second exclusive `nethra-writer.lock.reclaim` file so two recoveries cannot race. A lock held by a live process, by this process, without a host `pid` (an interactive engineering session's manual lock), an unreadable lock, or an interrupted reclamation is never removed automatically: the work blocks with the writer-lock message until a person confirms that writer has stopped.

The existing notification pipeline emits deduplicated 75-minute active-work check-ins only when a saved checkpoint or verification receipt exists. Capacity waits do not accumulate active time. Existing preferred-device selection, quiet hours and delivery acknowledgements remain authoritative. Windows and Android task details expose advisor/work status and next wake; technical advice and execution evidence remain diagnostics.

`codeWorkSummary` in `nethra-work-status.js` is the single bounded status that `nethra.get` returns as `codeWork` to both Windows Tasks and the paired phone: current provider and phase, the last attempt whose fixed verification passed (`lastVerified`), the blocker for BLOCKED work, the next action, and `retryAt` only while a capacity check is actually scheduled. While a draft waits for Start the task summary says so; a Work Activity change wakes the task through the existing code-work attention so its summary follows the record.

Validation for this slice: focused coordination, API, executor and recovery tests; Windows `npm test`; Android `:app:testDebugUnitTest :app:assembleDebug`. Real signed-in Codex and Claude advice was persisted and reached the owner-decision stage in `artifacts/coordination-live-advisors.json`. Live shared engineering evidence is recorded separately in `artifacts/coordination-live-engineering.json`; inspect its status rather than assuming success. No phone was connected during this run. The inspected local task store contained no Self Improvement task, so this change does not claim that an owner task has been activated.

`node scripts/nethra-coordination-live-smoke.js --out=<file>` (from `apps/windows`) repeats the whole path on a throwaway `main` repository with the real store, scheduler, desktop API, Foreman and signed-in providers: consultation, owner decision, Codex READY review, Start, Pause during the provider turn, Resume, shared-checkout engineering, fixed verification, Tasks status, notification queueing and restart. Each stage is reported as PASSED, UNAVAILABLE (a real service could not run; exit code 2, never a pass) or FAILED (exit code 1). A live Claude engineering handoff happens only when Codex really reaches 95%, and phone delivery only with a paired device; the report says when either was not exercised. `--rehearsal` swaps in fixture providers to check the script itself and is not evidence.

Live status at 2026-11-12T00:54Z: Claude's consultation ran and was saved; Codex was at 100% of its five-hour window, so the task recorded the real wait (`Waiting for codex consultation`, next wake 05:15:26Z, one minute after the reported reset) and every later stage was NOT RUN. The owner decision, Codex review, live shared engineering, live Pause, verification and notification stages through this path are therefore still unverified against real providers; rerun the script after the reset. Nothing has been verified on a phone.

Manual acceptance: create/open Self Improvement, approve the repository read scope and development access, enable coordination, provide the brief, inspect both advisor proposals, choose one, review the draft and Start with provider handoff. Confirm both providers use the original main checkout; pause during a turn and verify no further patch applies. Resume, exercise a real capacity wait and recheck after reset. Review the exact diff after fixed tests pass. Verify check-in deduplication and task/conversation routing on the selected paired phone. New independent objectives still require approval; this is not unlimited unattended development authority.

The historical implementation notes below describe the original isolated mode, which remains available for pre-existing work.

Approved scope: Windows performs explicitly started project work while open; Android is a paired status/control client. Pause, stop, quit, and crash preserve progress. Launch never resumes work. The VM is unchanged.

Implementation sequence: durable lifecycle; Git execution and verification; Codex scheduling; Windows/Android interfaces; recovery tests and packaged build.

Ruling: use the Node/Electron built-in SQLite engine, avoiding a native addon packaging dependency. Keep the existing delegation UI as the explicit original-checkout merge path.

Ruling: perform all project commands through Codex App Server sandboxed command execution, including independent verification. No unrestricted host-shell fallback.

Baseline: original Junction changes copied into a separate managed worktree and checkpointed. Original Civlets files are read-only inputs until explicit onboarding.

Implemented: durable SQLite project/task/event state, explicit activation, crash recovery to PAUSED, bounded retry scheduling, isolated Git candidate repositories, sandboxed Codex and verification execution, exact-diff review/apply, Windows status and controls, paired Android status and controls, and preservation of the existing Android audit surface.

Verification evidence:

- Windows unit and integration suite, including crash/reopen, pause fencing, capacity waits, idempotent control, shutdown races, protected verification inputs, and transport ambiguity.
- Real Codex App Server fixture: generated a source fix in an isolated candidate repository, passed the owner command, committed the verified candidate, kept the original fixture unchanged, and reopened the completed durable state.
- Electron offline UI smoke with an isolated user-data directory.
- Android Kotlin compilation, unit tests, and debug APK assembly.

Ruling: owner verification scripts, test trees, runner/dependency configuration, and explicit command paths are immutable during a candidate attempt. This prevents a generated change from making a broken implementation look green by weakening its checks. A legitimate test change must be reviewed as a separate owner-approved change.

Ruling: when `turn/start` has an ambiguous outcome, persist the thread before dispatch and terminate the owned App Server process before retrying. This spends a fresh attempt rather than risk two turns editing one checkout.

Ruling: review/apply operations are drained during shutdown. Once shutdown begins, new mutations are rejected while read-only status remains available.

Known validation boundary: no Android device was connected, so the APK and LAN code are build-tested but physical reconnect/control behavior remains to be exercised on a paired handset.
