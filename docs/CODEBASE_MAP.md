# Codebase Map

The Android app remains one Gradle module named `:app`, physically located at
`apps/android/`. Production packages are grouped into seven areas with
feature-first placement for user-facing capabilities and responsibility-first
placement for the assistant.

## Application

Location: `apps/android/src/main/java/com/splinch/junction/app/`

Entry points: `MainActivity.kt`, `JunctionApplication.kt`

Owns Android application startup and app-wide configuration. It wires repositories, services, navigation, and the assistant runtime without owning their implementations.

## Assistant

Location: `apps/android/src/main/java/com/splinch/junction/assistant/`

Entry point: `runtime/ChatManager.kt`

`ChatManager` is the runtime facade for owner input, context assembly, provider calls, streamed responses, and plan handoff. Focused responsibilities live in:

- `conversation/` — sessions, messages, persistence coordination, and trimming;
- `context/` — provenance and model context envelopes;
- `provider/` — provider implementations, catalogues, routing, health, and escalation;
- `planning/` — plan lifecycle and ordered execution;
- `trust/` — provenance and risk decisions;
- `tools/` — definitions, dispatch, and postcondition verification;
- `memory/` — durable memory operations and context formatting.

## Features

Location: `apps/android/src/main/java/com/splinch/junction/feature/`

Each user-facing capability has one primary home:

- `chat/` — chat screen;
- `voice/` — local and realtime voice, call service, models, and voice UI; entry point `VoiceCoordinator.kt`;
- `feed/` — feed repository, models, and screen; entry point `FeedRepository.kt`;
- `notification/` — notification access, capture service, and tap handling; entry point `service/JunctionNotificationListenerService.kt`;
- `gmail/` — Gmail assistant capability;
- `scheduler/` — digest scheduling and worker;
- `settings/` — settings screen and feature-specific settings UI;
- `update/` — update checking, signing verification, installation, and UI;
- `audit/` — audit screen;
- `onboarding/` — onboarding screen and migration;
- `selfimprove/` — bounded GitHub source inspection and proposed changes.

## Data

Location: `apps/android/src/main/java/com/splinch/junction/data/`

Entry point: `database/JunctionDatabase.kt`

Owns Room entities and DAOs grouped by stored domain, preference persistence, encrypted secret storage, and Firebase-backed synchronisation. The reorganisation leaves schema names, migrations, and preference keys unchanged.

## Platform

Location: `apps/android/src/main/java/com/splinch/junction/platform/`

Entry points: `accessibility/JunctionAccessibilityService.kt`, `shizuku/ShizukuCapability.kt`

Owns direct Android and privileged API integration for accessibility, Bluetooth audio, overlay services, and Shizuku. User-facing controls stay with their feature.

## Evaluation

Location: `apps/android/src/main/java/com/splinch/junction/evaluation/`

Entry points: `ActionAuditEvaluator.kt`, `PlanExecutionScenarioRunner.kt`, `TelemetryExporter.kt`

Owns runtime measurement, scenario execution, and telemetry export. Unit and instrumentation tests mirror production package paths under `apps/android/src/test/` and `apps/android/src/androidTest/`.

## Shared UI

Location: `apps/android/src/main/java/com/splinch/junction/ui/`

Entry points: `theme/Theme.kt`, `component/JunctionTextField.kt`

Contains only reusable Compose components and the shared theme. Feature screens and feature-specific controls live under `feature/<name>/`.

## Repository Layout

The Android Gradle module keeps its stable `:app` identity while
`settings.gradle.kts` maps it to `apps/android/`. User-facing applications now
share one parent:

- `apps/android/` — Android application module;
- `apps/web/` — React/Vite PC companion.

Supporting projects are grouped by role:

- `services/server/` — optional self-hosted relay and integrations;
- `services/functions/` — primary Firebase Functions backend;
- `services/junction-functions/` — secondary Junction Firebase codebase;
- `tools/companion/` — local device-control and diagnostic CLI.

Firebase source declarations, the web CI workflow, maintenance scripts, ignore
rules, and documentation resolve these locations directly. Folder-level VS Code
settings apply the generated-file exclusions when the repository is opened
without the workspace file.

Required root configuration remains where Gradle, Firebase, Git, and VS Code
expect it. Explorer file nesting presents those files as three collapsed stacks:
Gradle under `settings.gradle.kts`, Firebase under `firebase.json`, and repository
metadata under `README.md`. Longer configuration guidance lives in
`docs/CONFIGURATION.md`.
