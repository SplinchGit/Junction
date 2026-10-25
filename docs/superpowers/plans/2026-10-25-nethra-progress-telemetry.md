# Nethra Progress and Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Nethra a measured performance report and give owners a clearer, evidence-led task view on Windows and Android.

**Architecture:** Reuse the objective's existing SQLite inference intervals, which already separate model time from queue and tool time. A focused report module aggregates those intervals and bounded local chat usage. The objective tool and task API consume that module; both task UIs consume the API's progress and report without recomputing measurements.

**Tech Stack:** Node.js, SQLite, Electron DOM/CSS, Kotlin Compose.

**Spec:** `docs/superpowers/specs/2026-10-25-nethra-progress-telemetry-design.md`

## Global Constraints

- Preserve owner-approved task scopes and Windows-only permissions.
- Never describe missing samples as zero or a verified improvement.
- Keep mobile API responses below the existing 50 KB bound.
- Do not include prompts, message bodies or private reasoning in telemetry.

## Review Focus

- No samples: report says unavailable and UI remains readable.
- Malformed or negative timing: ignored rather than skewing aggregates.
- Old chat samples: timestamp and window prevent an implication of current performance.
- Budget sleep: distinguish daily budget from ordinary scheduled monitoring.
- Advisory Codex evidence: timeline labels consultation, not development completion.

---

### Task 1: Measured report

**Files:** `apps/windows/src/nethra-performance.js`, `apps/windows/src/nethra-store.js`, `apps/windows/src/nethra-runner.js`, `apps/windows/test/nethra-performance.test.js`

**Interfaces:** `performanceReport({store,localData,taskId,now})` returns bounded objective and chat sample summaries; `store.inferenceSamples(taskId,since,limit)` reads completed model intervals.

- [ ] Add failing tests for valid, empty, malformed and stale samples.
- [ ] Implement read-only objective interval retrieval and bounded aggregation.
- [ ] Run focused and full Windows tests.

### Task 2: Objective tool and task API

**Files:** `apps/windows/src/nethra-tools.js`, `apps/windows/src/nethra-runner.js`, `apps/windows/src/nethra-api.js`, `apps/windows/src/main.js`, `apps/windows/test/nethra-performance.test.js`

**Interfaces:** `performance_report` is read-only and returns the same measured report as `nethra.get.performance`.

- [ ] Add failing tool and API contract tests.
- [ ] Wire the report provider to the runner and API, with bounded mobile payload.
- [ ] Run focused and full Windows tests.

### Task 3: Verified activity and task UI

**Files:** `apps/windows/src/nethra-progress.js`, `apps/windows/renderer/nethra.js`, `apps/windows/renderer/appearance.css`, `apps/android/src/main/java/com/splinch/junction/feature/projects/NethraPanel.kt`, focused Windows/Android tests.

**Interfaces:** `progress.activity` is a bounded list of host events with time, label and kind; both screens render it alongside state, next action and measured performance.

- [ ] Add failing progress and rendering checks.
- [ ] Implement activity and compact performance presentation on both platforms.
- [ ] Run Windows suite, Electron UI smoke, Android unit/build checks and inspect screenshots where available.

### Task 4: Delivery

**Files:** documentation and platform packages.

- [ ] Update user-facing notes with sources and limitations.
- [ ] Package and smoke-test the Windows runtime under the launch contract.
- [ ] Build and publish Android through the existing internal-testing flow.
- [ ] Verify Git diff, commit and push the scoped changes.
