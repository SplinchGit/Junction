# Codebase Map

This map records the current structure and the intended homes used by the
package reorganisation. It should be updated whenever a package move lands.

## Application

Current location: `MainActivity.kt`, `core/`

Target location: `app/`

Entry points: `MainActivity.kt`, `JunctionApplication.kt`

Owns Android application bootstrapping and app-wide configuration.

## Assistant

Current location: `chat/`

Target location: `assistant/`

Entry point: `AssistantRuntime` (currently `ChatManager`)

Owns assistant orchestration, conversation state, provenance and context,
planning, trust, provider integrations, tool definitions, and memory.

## Voice

Current location: `chat/voice/`, `chat/realtime/`, and shared UI

Target location: `feature/voice/`

Entry point: `VoiceCoordinator` (to be introduced only after package moves)

Owns local and realtime voice sessions, the foreground call service, and
voice-specific UI.

## Feed

Current location: `feed/`, `ui/FeedScreen.kt`

Target location: `feature/feed/` and `data/database/feed/`

Entry point: `FeedRepository.kt`

Owns feed retrieval, feed models, persistence access, and its screen.

## Notifications

Current location: `notifications/`

Target location: `feature/notification/`

Entry point: `JunctionNotificationListenerService.kt`

Owns notification access, captured notification actions, and notification taps.

## Persistence and sync

Current location: `data/`, `settings/`, `sync/firebase/`

Target location: `data/`

Entry point: `JunctionDatabase.kt`

Owns Room entities and DAOs, preferences, secret storage, and Firebase-backed
synchronisation.

## Platform

Current location: `accessibility/`, `platform/`, `summon/`

Target location: `platform/`

Entry points: `JunctionAccessibilityService.kt`, `ShizukuCapability.kt`

Owns direct Android integrations and platform SDK wrappers.

## UI and evaluation

Current location: `ui/`, `evaluation/`

Target locations: `ui/component/`, `ui/theme/`, `evaluation/`

Reusable Compose components and theme remain in `ui`; feature screens move to
their feature. Evaluation hosts audit and plan-execution scenarios.
