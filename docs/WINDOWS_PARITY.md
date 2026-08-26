# Android to Windows feature parity

Android remains Junction's authoritative mature client. This map records what is
implemented rather than treating visual navigation as feature parity.

## Requirement-by-requirement matrix

| Android surface / workflow | Windows state | Notes |
| --- | --- | --- |
| Junction Material theme, typography, shapes | **Implemented** | Exact brand blue/violet and Android's dark primary/secondary containers, typography scale, and 6/10/14/20/28 shape language adapted to desktop |
| Feed / “Your Junction” | **In progress** | Real local activity plus explicitly refreshed, read-only shared Android Feed; Windows notification ingestion remains platform work |
| Chat shelf, local history, rename/delete | **Implemented** | Durable Chat-only collapsible desktop drawer with keyboard operations |
| Provider and model selection | **Implemented** | Android-derived provider/model cards expressed as desktop selectors with catalog cost tiers and custom model entry |
| Provider routing and encrypted keys | **Implemented** | Text routing for five provider paths; credentials are per-PC DPAPI data |
| Model usage / estimated spend | **Implemented** | Local request/token/cost summary using catalog estimates; provider billing remains authoritative |
| Durable memory review and management | **Implemented** | Add, search, categorized review, forget, and opt-in owner-memory convergence with durable deletion reconciliation |
| Onboarding / setup wizard | **In progress** | Contextual “Let's set up your AI” path and configured-state handling; voice and integrations steps remain adapted/backend work |
| Action audit and evaluation metrics | **Implemented** | Local decisions, completed/blocked/failed summaries and detailed rows; no captured text |
| Firebase account/device opt-in | **Implemented** | Native Google/Firebase identity and explicit device registration foundation |
| Cross-device authoritative chat | **Implemented v1** | Owner-scoped opt-in shelf, immutable provenance/messages, title merge, and tombstones; pagination/retention remain |
| Cross-device Feed and memory | **Implemented v1 / in progress** | Feed is read-only on Windows; OWNER memory converges with durable outboxes; live desktop notification ingestion remains |
| Multi-project delegation | **Implemented foundation** | Local plans, repo readiness, max three isolated Codex worktrees, decision states, audit, exact-diff review, explicit merge |
| Notification listener and digest | **Platform-adapted** | Requires a Windows notification adapter and desktop scheduling design |
| Gmail, calendar, GitHub integrations | **Requires backend / adapted** | Do not copy mobile credentials; needs per-device auth and device-aware routing |
| Voice / realtime | **Platform-adapted** | Requires Windows microphone permission, capture indication, cancellation, and cost controls |
| Accessibility actions / intents / Shizuku | **Platform-adapted** | Windows currently remains read-only UI Automation; mutations await confirmation and postcondition infrastructure |
| Build Calculator | **In progress / adapted** | Existing service can be surfaced after network/pricing behavior review |
| App updates | **Platform-adapted** | Requires signed Windows installer/update channel, not Android APK logic |

## Directly portable now

| Android capability | Windows status |
| --- | --- |
| Local conversation history and chat shelf | Implemented locally in this phase |
| Multi-provider text chat | Implemented for OpenAI, Anthropic, DeepSeek, Groq, and custom OpenAI-compatible endpoints |
| Device-encrypted provider keys | Implemented with Electron `safeStorage`; keys never sync |
| Durable owner memory (200-fact cap) | Implemented locally with explicit add/forget controls |
| Provenance-labelled context | Implemented: OWNER messages, JUNCTION replies/memory, UNTRUSTED UI Automation context |
| Action audit review | Implemented for local Windows companion proposals/outcomes |
| Settings/onboarding fundamentals | Implemented for account, provider, memory, privacy, and device sync state |

Desktop chat is intentionally text-only and non-agentic in this slice. Provider
output cannot call tools or execute PC actions. Requests send at most the latest
20 messages, 200 owner-confirmed memory facts, and—only when explicitly attached—a
compact UI Automation snapshot capped at 30 elements. Replies are capped at 1,200
tokens and are not streamed, keeping API use bounded and user-triggered.

## Requires further shared backend/account work

- Server retention, Android message cursor pagination, and richer retry telemetry
  for extended offline operation.
- Live Windows Feed notification state; current shared Feed is explicit/read-only.
- Shared preferences beyond the existing narrow Android snapshot, and model-usage
  aggregation/cost history.
- Gmail, calendar, and remote phone-command clients with device-aware identity and
  explicit routing to Android's existing trust gate.

## Mobile-only or desktop-adapted

- Android notification listener/digests become a Windows notification/event
  adapter, not a direct port.
- Android accessibility actions, intents, app launch, notification reply/dismiss,
  and Shizuku installs need individually allowlisted Windows UI Automation or OS
  capabilities with confirmation and postcondition verification. None exist yet.
- Phone Bluetooth audio routing, Android speech recognizer/TTS, overlays, and
  APK update/install flows need Windows-native equivalents.
- The PC Build Calculator can be surfaced as a desktop feature, but its external
  pricing/network behavior should be reviewed independently before integration.
- Voice can reuse the conversation/trust pipeline later, but microphone permission,
  capture indication, cancellation, and cost controls must be desktop-native.

## Recommended next phase

Add Android message cursor pagination, then build a signed distribution/update
lane and deeper chat interaction parity (stream, cancel, regenerate). Do not
synchronize provider keys or raw desktop context, and
do not add Windows mutation tools until confirmation and postcondition
infrastructure is complete.
