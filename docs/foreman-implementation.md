# Persistent foreman implementation ledger

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
