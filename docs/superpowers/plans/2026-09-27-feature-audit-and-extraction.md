# Junction feature audit and extraction

**Goal:** catalogue and verify Junction, remove unrelated product coupling, preserve capabilities and saved data, and stop unwanted startup/notification behavior.

**Constraints:** no paid provider or Azure voice requests; no new voice implementation; preserve existing uncommitted changes, user data, Android/Windows pairing and VM boundaries. Hardware-dependent checks need a connected device. Never copy credentials or signing keys into extracted repositories.

**Execution:** inspect and test the current working tree in place because the features under audit include existing uncommitted work. Use isolated new directories for extracted apps; preserve the existing dirty Mafioso checkout. User has authorized implementation and testing without repeated qualification questions.

- [x] Identify Windows login registration and disable current entries.
- [x] Patch recurring login opt-in and silence Android readiness notification.
- [x] Run baseline Windows, companion and web checks; start Android unit/build checks.
- [x] Catalogue implemented features, test coverage and device/service gaps.
- [x] Compare Mafioso repository state and migrate only Junction's unique Android wrapper/billing integration.
- [x] Extract music editor/playback/persistence/tests into an independently buildable DAW repository, with an owner-controlled saved-project transfer path.
- [x] Remove extracted product entry points and dependencies from Junction after copies are verified.
- [x] Run affected suites/builds, rebuild Windows runtime and check the desktop shortcut startup contract.
- [x] Review trust boundaries, persistence and lifecycle failures; fix supported findings with focused tests.
- [x] Research maintained free voice options using primary sources, without calling any voice service.
- [x] Deliver feature matrix, exact test outcomes, repo destinations, artifacts and remaining physical-device checks.

## Limits

Offline/available checks completed; physical-device and paid-service coverage remains open as listed in docs/audit/2026-09-27-feature-review.md. Android notification fix is built but not installed (no connected device). Cloud auth fix is not deployed. Mafioso extraction is a draft PR with billing release gates.
