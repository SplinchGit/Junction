# Persistent foreman implementation ledger

Approved scope: Windows performs explicitly started project work while open; Android is a paired status/control client. Pause, stop, quit, and crash preserve progress. Launch never resumes work. The VM is unchanged.

Implementation sequence: durable lifecycle; Git execution and verification; Codex scheduling; Windows/Android interfaces; recovery tests and packaged build.

Ruling: use the Node/Electron built-in SQLite engine, avoiding a native addon packaging dependency. Keep the existing delegation UI as the explicit original-checkout merge path.

Ruling: perform all project commands through Codex App Server sandboxed command execution, including independent verification. No unrestricted host-shell fallback.

Baseline: original Junction changes copied into a separate managed worktree and checkpointed. Original Civlets files are read-only inputs until explicit onboarding.

Progress: implementation started.
