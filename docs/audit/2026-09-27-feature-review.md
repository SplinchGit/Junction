# Junction feature review — 27 September 2026

## What was actually verified

This is a source review, offline regression pass and packaging check, not a claim
that every integration works on a physical phone. No Azure speech, paid model,
live email, purchase or cloud deployment request was made by these tests.
ADB reported **no connected devices** twice. Real microphone/Bluetooth testing
was deliberately excluded. Existing voice state-machine unit tests use local
fixtures and do not exercise a speech service.

| Area | Implemented features | Evidence this pass | Still needs live/device validation |
|---|---|---|---|
| Android chat | Sessions/history, model/provider settings, context, citations, attachment UI | Android build; prompt, catalog and citation unit tests | Each provider's live streaming, attachments, cancellation and error UI |
| Assistant tools/trust | Risk decisions, proposals, confirmation, postconditions, memory, untrusted input handling | Existing evaluation, audit and postcondition tests | Full device execution/undo matrix; adversarial coverage is not exhaustive |
| Android Audit / World | Action history, VM activity and conversation client | Android build; Windows bridge/relay tests; 36 Python runtime tests | Phone ↔ Windows ↔ Debian integration on the installed APK |
| Android ↔ Windows LAN | Pairing, TLS pinning, discovery/candidates, authentication, cancellation, revocation, continuity events | Android LAN protocol/TLS/transport tests; Windows protocol/server/reliability/relay suites | Wi-Fi changes, screen-off/background delivery, reconnect on hardware |
| Account sync | Opt-in Firebase auth, shared conversations, owner memory, preferences, read-only Feed | Paired record tests; Windows sync/store tests; web build | Live OAuth/Firestore rules, account switching and offline reconciliation |
| Feed / notifications | Capture/filter/archive, digests, quiet hours, reply/dismiss | Android build and four schedule-policy tests; desktop UI navigation | Notification permission, actual reply intents, OEM battery behavior |
| Remote readiness service | Persistent Android remote-command listener | Builds; notification now silent/only-alert-once; coroutine collector cancelled on destroy | Install updated APK and confirm on James's phone; ongoing service notice remains required |
| Gmail / calendar / other feeds | Triage/draft/send/archive/unsubscribe, agenda/reminders; server integration adapters | Source review and compilation only | Authorized live account tests; no messages sent |
| Accessibility / overlay | Read screen, tap/set text/scroll/back/home, summon/overlay | Compiles; trust/postcondition fixtures | OEM apps, permission toggles, actual input and accessibility selectors |
| Updates / GitHub | Update integrity/checking; source inspection, change proposals, review/merge flow | APK integrity/checker and mocked GitHub contribution/source-context tests | Installer/rollback on phone; live GitHub authorization and workflow |
| Windows chat / local agent | Persistent conversations/memory, cloud/local/Codex selection, research/citations, bounded native tool runtime | Entire npm suite; actual Electron renderer→preload→IPC smoke with temporary data | Paid provider behavior excluded; no new live model-quality benchmark |
| Windows Projects | Repository checks, isolated delegation, review-bound merge approval | Delegation fixtures in npm suite | Real agent delegation/merge not started; owner repo presets remain |
| PC context | Explicit, bounded, read-only Windows accessibility inspection | Five companion tests, including authentication and audit | Real foreground-app inspection wasn't re-exercised |
| Web companion | Auth, shared Feed/chat, remote command surface | TypeScript/Vite production build | Browser sign-in, phone delivery and deployed backend |
| Build calculator | Hardware prices, ranking, sale estimate, fees/profit/ROI | Three new mocked eBay calculator tests | Live eBay credentials/listings and rate limits |
| Voice | Azure/realtime paths; local voice orchestration, barge-in and call-floor logic | Only existing pure state-machine tests in Android suite | All real voice paths deliberately untested; alternatives researched only |
| DAW (extracted) | Arrangement, piano roll, mixer, automation, synth/sampler, WAV import/record/export, undo/redo, autosave | Standalone APK; 11 editor/renderer/archive tests | Microphone, playback latency, SAF document picker and real saved-project transfer |
| Mafioso (extracted) | Android WebView shell and Play Billing bridge to existing game | Standalone APK; copied-source SHA-256 comparison | Login/billing/device testing and release gates below |

### Registered Android tool catalogue

`ToolRegistry.kt` remains the authority. The registered tools are:
`set_speech_mode`, `set_feed_filter`, `archive_feed_item`, `read_notifications`,
`get_calendar_agenda`, `schedule_calendar_reminder`, `check_for_updates`,
`set_setting`, `remember_fact`, `forget_fact`, `list_junction_source`,
`read_junction_source`, `propose_code_change`, `check_github_change`,
`merge_github_change`, `ask_clarification`, `reply_notification`,
`dismiss_notification`, `open_app`, `open_deeplink`, `launch_intent`,
`gmail_triage_inbox`, `gmail_draft_reply`, `email_send`, `email_archive`,
`gmail_unsubscribe`, `read_screen`, `tap_element`, `set_text`, `scroll`,
`press_back`, `press_home`.

Registration is not proof of successful execution. In particular, mail sends,
notification replies, permission changes and installation were not simulated as
successful device operations.

## Changes delivered

1. Removed both Junction-related Windows Run entries on this PC. Packaged launch
   now sets `openAtLogin: false`, so it does not re-register itself. Rebuilt the
   original `apps/windows/dist/workspace-win-unpacked` runtime, regenerated
   `Desktop/Junction.lnk`, and launched through it. No OS reboot test was done.
2. Android readiness notice is silent, suppresses repeated alerts/timestamps,
   disables channel sound/vibration/badges, and cancels its service coroutine on
   destruction. **This needs the new APK installed; it is not yet on the phone.**
3. Removed embedded DAW/Mafioso UI/source and Play Billing dependency from
   Junction. Generic Projects delegation remains available, including existing
   repository presets. No conversation or other Junction features were removed.
4. Preserved existing music files with a Settings export control. ZIP contains
   only `music-projects/` and `music-assets/`. Independent DAW imports into a fresh
   studio, refuses overwrite, rejects traversal/duplicate entries, and limits
   extraction to 512 MiB / 4096 files. The original Junction data is retained.
5. Fixed Feed styling rejected by the existing CSP: stylesheet class replaces
   inline style. Security policy was not relaxed.
6. Fixed legacy `services/junction-functions/chatJunction` source: verified,
   revocation-checked Firebase token required before provider access; POST only;
   bounded input/output and timeout; sanitized upstream errors. It now uses
   Node 22's native fetch instead of an undeclared node-fetch dependency.
   **Not deployed.** Existing deployed behavior, if any, has not been verified.

## Repositories and preservation

- DAW: private [SplinchGit/Junction-DAW](https://github.com/SplinchGit/Junction-DAW),
  local sibling `../Junction-DAW`, initial commit `9098538`.
- Mafioso: [draft PR #1](https://github.com/SplinchGit/Mafioso/pull/1), branch
  `junction-android-extraction`; independent build in
  `../0Mafioso/Mafioso/apps/android`. Existing game HEAD matched origin/main at
  `b0c4cb48`; newer uncommitted frontend/backend work was preserved and excluded
  from the extraction commits. There was no newer embedded game engine to merge.
- `product-extraction-manifest.json` records the source SHA-256 values verified
  against destination copies before original product files were removed.
- No signing keys, local properties, Firebase account files, passwords or
  credentials were copied. Both standalone apps retain the proprietary license.
- Junction's pre-existing dirty work remains in place. No blanket commit, reset,
  push or cleanup of that work was performed.

## Exact checks executed

| Command / check | Result |
|---|---|
| Junction `gradlew :app:testDebugUnitTest :app:assembleDebug` using Android Studio JBR | PASS, 134 tests across 22 suites, zero failures/errors; debug APK built |
| DAW `gradlew :app:testDebugUnitTest :app:assembleDebug` | PASS, 11 tests across 3 suites; debug APK built |
| Mafioso Android `gradlew :app:assembleDebug` | PASS; no standalone instrumented/billing tests yet |
| `apps/windows: npm test` | PASS, entire configured suite, rerun after extraction and CSP fix |
| `apps/windows: electron scripts/offline-ui-smoke.js` | PASS: six navigation destinations, real preload/IPC, create/list/delete conversation and add/delete memory in temporary profile; no renderer errors |
| `apps/windows: npm run pack:workspace`, `npm run desktop`, shortcut launch | PASS; original runtime location restored; running packaged process observed |
| `services/pc-companion: npm test` | PASS, 5 tests |
| `services/build-calculator: npm test` | PASS, 3 new tests with mocked listings |
| `services/junction-functions: npm test`, `npm run lint` | PASS, 5 new tests; all provider calls mocked |
| `node --check services/server/index.js`, `services/functions/index.js` | PASS syntax only, not integration tests |
| `apps/web: npm run build` | PASS; large-chunk warning remains (~600 kB before gzip) |
| `python -m unittest discover -s scripts/junction-world -p 'test_*.py'` | PASS, 36 tests |
| `adb devices -l` | No device available; no APK installed or instrumentation run |

The new auth tests first reproduced unauthorized paid-provider access (four
failures); all five passed after the fix. The offline renderer test first failed
on the inline-style CSP violation, then passed after the stylesheet fix.
The transfer tests first failed because the archive implementation was absent.
Debug builds retain existing AGP experimental-option/deprecated Compose warnings.

## Review findings still open

- **Release-blocking for standalone Mafioso billing:** inherited
  `addJavascriptInterface` validates the top-page host, not the caller's frame
  origin. Use an origin/main-frame-checked message bridge; move WebView URL reads
  to its UI thread; test purchase recovery after page load. Documented in the
  draft PR. No production billing changes or purchases made.
- **Play package migration:** the new wrapper is `com.splinch.mafioso`; backend
  defaults still refer to `com.splinch.junction`. Preserve old purchase-token
  verification while adding the new package, products and signing configuration.
- **Cloud audit integrity:** `firestore.rules` describes `audit_log` as append-only
  but currently allows updates. Fix with rule-emulator coverage, including the
  existing client's retry semantics, before treating that mirror as immutable.
  Other shared-history rules are distinct; this finding is about the legacy mirror.
- **Desktop audit retention:** `main.js` appends indefinitely and reads the entire
  file before showing the last 50 rows. Add bounded rotation/streaming reads with
  retention tests. This is separate from the VM supervisor's bounded log design.
- **DAW recovery:** inherited `MusicProjectStore.loadOrCreate()` silently returns
  a starter project on decode failure. Preserve damaged data and display recovery
  choices before autosave; extracted original behavior is not a verified recovery
  system. ZIP tests cover safe transport, not every corrupted musical project.
- **Deployment cost controls:** authentication is necessary, but per-user usage
  budgets/rate limits are not proven by the legacy endpoint fix. Review before
  exposing hosted model services broadly.
- **Documentation debt:** the old known-limitations page predates the LAN and
  GitHub work. This dated matrix is the current evidence, without the old blanket
  claims that everything else was tested end-to-end.

## Next physical-device pass (no Azure)

Install the new APK; verify notification silence, text chat, local project export,
LAN pair/revoke/reconnect, Audit continuity, screen-off remote delivery and owner
stop. Then exercise approved test notifications, calendar/Gmail read-only flows,
accessibility selectors and update rollback on test data. Treat outbound mail,
merges, purchases and paid providers as separate explicitly controlled checks.
Voice remains excluded until James chooses a free stack and asks to test it.
