# Known limitations against the v2 build spec

This tracks the specific spec items that could not be completed by autonomous coding in this
session, and why — as distinct from everything else in the spec, which has been implemented and
wired end-to-end. Each entry names the concrete external requirement (hardware, credentials, a
business decision, or a licensed dependency) that blocks it.

## Wake-word detector (Phase 2.C, "Then:")

Not implemented. A real wake-word detector needs either a licensed model (Porcupine, Snowboy-style)
or a custom-trained TFLite model plus a continuous low-power audio pipeline, and the spec itself
frames this as a "Then:" (future) item, not a Phase 2 requirement — side-key summon and the
persistent overlay (`summon/JunctionOverlayService.kt`, `accessibility/JunctionAccessibilityService.kt`)
cover the "Now:" requirement. Adding a wake-word engine is a business decision (which vendor,
what it costs, on-device model size) as much as an engineering one.

## Bixby remap (Phase 2.C)

Not implemented. Double-press volume-down summon exists and is opt-in
(`JunctionAccessibilityService.onKeyEvent`). Remapping Bixby specifically has no public Android API —
it requires Samsung's own Good Lock / Bixby Routines integration, which varies by OEM software
version and isn't something a generic Android client can hook into from outside.

## Bundled IME for reliable text entry (Phase 2B.3)

Not implemented. `set_text` uses `AccessibilityNodeInfo.ACTION_SET_TEXT`, which works for standard
Android widgets. A bundled `InputMethodService` (the spec's suggested fallback for apps where that
proves flaky) is a full standalone keyboard subsystem — its own UI, IME lifecycle, security review
surface — and is only worth building once real per-app failure data justifies it. `ToolRegistry.kt`'s
selector-tier logging (`JunctionAccessibilityService.locate()`) is in place specifically to gather
that evidence first.

## Fully silent Shizuku install (Phase 4.1)

Partially implemented. `platform/ShizukuInstaller.kt` runs the real public `PackageInstaller`
session flow (`SessionParams(MODE_FULL_INSTALL)` → `createSession` → `openWrite` → `commit`), gated
behind `ShizukuCapability` being AVAILABLE, tier DESTRUCTIVE. Verified against the actual
`dev.rikka.shizuku:api:13.1.5` artifact in this project: `Shizuku.newProcess(...)` is `private` in
this version, so the "run `pm install` as shell via Shizuku" shortcut isn't available. A genuinely
*silent* (no system dialog) install requires driving the platform's hidden `IPackageInstaller` AIDL
interface directly through `ShizukuBinderWrapper`, which needs the platform's `.aidl` contracts
vendored into this module and a real device to validate the transaction codes against — getting an
AIDL binding wrong is a silent wrong-method-call at runtime, not a compile error, so it isn't
something to fabricate from memory without hardware to test on.

## Self-update draft-PR + independent-model review (Phase 4.2)

Partially implemented. What's real: `android-release.yml` now gates on the full test suite
(including `InjectionTestSuite`) before a release can publish, and `UpdateInstaller.kt` backs up the
currently-installed APK before every update and exposes a one-tap revert. What's not implemented:
commit-via-GitHub-API into a draft PR, and independent review by a different model than the one
that authored the change. Both require a live GitHub App or fine-grained PAT scoped to
`contents:write`/`pull_requests:write` (a credential the running agent doesn't hold and shouldn't
generate for itself), plus an explicit business decision on which model reviews and how that review
is triggered and gated. This is exactly the kind of self-modifying-the-trust-layer decision the
spec itself says should never be made unilaterally.

## Real end-to-end validation on a physical device

Everything above — and the accessibility service, Shizuku status flow, notification reply, and
on-device voice backend generally — is implemented and unit/instrumentation-tested where feasible,
but instrumentation tests in this environment run against an emulator, not a physical device with a
real Shizuku install, a real OEM's accessibility quirks, or a real Bluetooth/speaker audio path.
The "Device validation" checklist in `README.md` lists exactly what to walk through by hand before
trusting any of this in daily use.

## Local-network, end-to-end-encrypted PC pairing (Phase 4.3)

Partially implemented. The PC companion now mirrors chat, feed, and a field-limited, append-only
audit log (`sync/firebase/AuditSyncManager.kt`, `firestore.rules`), and it already refuses to
execute any tool call — enforced independently by `TrustGate`'s trigger-provenance rule, not just by
the web client's own restraint. What's not implemented: the spec's preferred local-network pairing
channel with its own end-to-end encryption, as an alternative to routing through Firestore. That's a
protocol design decision (discovery mechanism, key exchange, offline behavior) explicitly called out
in the spec as a queued design session, not something to improvise unilaterally.
