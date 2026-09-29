# Provider and model routing

## Goal

Make model selection explicit and safe on Windows and Android: remove LFM2.5, show provider/source separately from model, make the chosen model the one persisted and sent, label OpenRouter routes clearly, and keep first-party/OpenRouter credentials device-only.

## Constraints

- Preserve the removed Work tab.
- Preserve the Junction repository's strict main-only publication policy; work is developed in an isolated worktree.
- Do not sync, log, commit, or expose API keys. OpenRouter models always read the OpenRouter credential; first-party models read their own provider credential.
- Do not add automatic paid fallback or switch providers/models without the owner's selection.
- Before any main push, require a clean OpenAI or Claude frontier-model review.

## Task 1 — Catalog and migration

- Add failing Windows and Android catalog tests for no LFM2.5, grouped source metadata, NVIDIA first-party support, explicit OpenRouter source labeling, credential ownership, and retired-selection normalization.
- Implement the smallest catalog/normalization changes that pass them.

## Task 2 — Two-stage selectors

- Add failing tests for provider-first/model-second selection behavior.
- Windows Chat and Settings use real provider and model selects; changing provider filters models and saving/switching persists the exact selected model.
- Android Chat uses separate provider and model menus; Settings keeps provider and model as distinct choices and shows source labels.

## Task 3 — Secure routing verification

- Add/extend provider request tests to prove OpenRouter uses the OpenRouter endpoint/key with the selected model and NVIDIA first-party uses its own endpoint/key.
- Verify existing secure storage remains the only key store and UI copy states keys stay on-device.

## Task 4 — Verification and review

- Run complete Windows tests, Android unit tests, Windows packaging/build, and Android debug APK build.
- Commit the worktree changes.
- Request whole-branch review from an OpenAI frontier model; fix all Critical/Important findings with regression tests and re-run suites.

## Review focus

- A provider/model mismatch must not send a model through the wrong endpoint or credential.
- A retired LFM2.5 selection must migrate to Qwen3.5 2B.
- OpenRouter labels and key ownership must be unambiguous.
- Provider changes must not silently select or persist a stale model from the previous provider.
- No key material may enter preferences, sync, logs, or Git.
