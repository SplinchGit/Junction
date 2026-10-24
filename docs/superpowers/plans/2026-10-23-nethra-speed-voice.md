# Nethra response speed and voice

Goal: improve response latency for the existing Qwen3 30B without removing tools, research checks, privacy boundaries, or reasoning on substantive requests.

Approach: retain the installed model and 4096 context. Existing Flash Attention is automatic; keep existing host settings unless comparative measurements justify changing them. Avoid lower weight precision or switching to a smaller model. Use a 96-event reasoning budget only for exact greetings, retain 256/1100 limits elsewhere. Enforce finite budgets even without progress subscribers. Throttle thinking metadata to 250 ms while preserving final counts. Prewarm from desktop status as well as mobile status.

Voice: keep existing providers and local/cloud choice. Prefer installed offline voices in the device locale, then quality and latency. Clean presentation markup before speech without altering displayed replies, numbers, or ordinary punctuation. Keep interruption and microphone handover logic.

Steps:
- Add regression tests for headless budget enforcement, metadata rate, greeting budget, and speech cleanup/voice ranking.
- Implement and run targeted Windows and Android checks.
- Compare live warm greetings and a model-identity question with baseline; preserve substantive reasoning caps.
- Run Windows suite, build Android APK, rebuild the existing Windows runtime safely and verify launch. Install Android only if a device is connected.

Review risks: cancellation at budget boundary; completion event at boundary; final metadata delivered; multilingual voice fallback; markup-only speech; no new cloud transfers; startup task race during packaging.
