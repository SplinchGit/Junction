# Task–Chat Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open each objective in its assigned chat and show compact task progress in that chat on both clients.

**Architecture:** Windows owns an idempotent task-to-chat binding. Both clients use the existing objective API, chat sync and task status monitor. Full controls remain in the task detail drawer/sheet.

**Tech Stack:** Electron/Node/SQLite, Kotlin/Compose, existing LAN and encrypted relay.

**Spec:** `docs/superpowers/specs/2026-10-23-task-chat-continuity-design.md`

## Global Constraints

- Preserve owner data and existing conversations.
- Keep the 30B model and one Windows objective authority.
- Do not increase Firebase write frequency or unpin TLS.
- Commit explicit paths only; local APK version stays below CI version.

## Review Focus

- A double tap or lost relay response must select one conversation.
- A deleted chat must not be recreated under its tombstoned ID.
- A linked phone chat not yet synced to the PC must retain its assigned ID.
- An offline phone must show cached task state and explain that navigation needs sync.
- Terminal objectives must remain inspectable in their chat.

### Task 1: Host association and API

**Files:** `apps/windows/src/nethra-store.js`, `apps/windows/src/nethra-api.js`, `apps/windows/src/local-data.js`, `apps/windows/src/main.js`, `apps/windows/test/nethra-api.test.js`

- [ ] Write failing tests for existing association, lazy binding, duplicate requests, restart recovery and deleted chat.
- [ ] Run focused tests and verify failure.
- [ ] Implement the host operation and bounded summary field.
- [ ] Rerun focused and full Windows tests.

### Task 2: Windows chat-first interface

**Files:** `apps/windows/renderer/nethra.js`, `apps/windows/renderer/styles.css`, `apps/windows/scripts/offline-ui-smoke.js`

- [ ] Extend UI smoke expectations for chat strip and task navigation; verify failure.
- [ ] Implement compact index, focused detail, task strip and navigation.
- [ ] Run Electron smoke and inspect screenshot.

### Task 3: Android navigation and strip

**Files:** `apps/android/src/main/java/com/splinch/junction/feature/projects/NethraPanel.kt`, `apps/android/src/main/java/com/splinch/junction/feature/chat/ui/ChatScreen.kt`, chat sync and related tests.

- [ ] Write tests for objective/chat mapping and duplicate navigation; verify failure.
- [ ] Implement open-or-create through the paired host and a compact chat strip.
- [ ] Run Android unit tests and assemble a local APK.

### Task 4: Live verification

- [ ] Deploy Windows using `apps/windows/AGENTS.md` procedure without interrupting a lease.
- [ ] Confirm host listeners, task data and one real linked-chat navigation.
- [ ] Push tested commit, verify CI APK/emulator, then smoke physical phone without interrupting its foreground app.
