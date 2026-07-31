# Handoff to the local agent

For a model running on the PC the phone is plugged into. It has what the cloud agent that
wrote this did not: `adb`, and therefore the actual device.

Everything below is on `main` and compiles: CI green through `abc7b50` (build 59), which is
the last commit carrying code. Unit tests pass; `instrumentation-tests` does not run at all
(see Known broken).

**None of it has run on a phone.** That is the job.

## State of play

One Junction. One artifact, one signing key, one URL, one version code that only goes up.

| Thing | Where |
| --- | --- |
| The only download | `https://splinchgit.github.io/Junction/junction-debug.apk` |
| Build manifest the app reads | `https://splinchgit.github.io/Junction/latest.json` |
| Signing key | `app/debug.keystore`, committed |
| Version code | CI run number, via `JUNCTION_VERSION_CODE` |

Recent changes, newest first:

- `abc7b50` — `propose_code_change` tool + Settings token field; deleted `android-release.yml`
- `3369139` — `VoiceCallService` foreground service; `KeyStorage` crash recovery
- `a50418e` — `HandsFreeLoop.Mode.CALL`
- `7754da6` — updater reads `latest.json`, compares `versionCode`
- `f1d3a5a` — committed debug keystore, README one-button

Why the keystore is committed: without a fixed key, every CI run signs with a throwaway
one, Android refuses to install over the previous build, and the only way through is an
uninstall that wipes API keys, chat history and memory. Its credentials are the public
`android` / `androiddebugkey` constants already hardcoded in `app/build.gradle.kts`, so it
protects nothing — it only has to be *stable*. The release keystore stays secret.

## How voice becomes a continuous call

Five pieces, all landed. None of the audio behaviour has run on a phone.

**0. The mic used to die after exactly one reply, and it was a threading bug.** The TTS
engine delivers `UtteranceProgressListener` callbacks on its own binder thread, and
`SpeechRecognizer` throws outright when touched from anywhere but the main thread. So the
re-arm at the end of every reply threw, the throw was swallowed by the `runCatching`
around `startListening`, and a perfectly working recogniser was written off as a fatal
failure: chip cleared, line dead, one sentence per tap. It looked identical to the bug
`HandsFreeLoop` was built to fix, which is why the loop kept getting the blame. Every
engine callback now goes through `LocalVoiceSession.onSession`, which marshals onto one
dispatcher. **Check this first on hardware** — everything below assumes it.

**1. The line does not hang up on silence.** `HandsFreeLoop` has an explicit `Mode`.
`CALL` never returns `GiveUp` for a silent turn — the owner opened the line, only the owner
closes it. Retries back off linearly to a 4s ceiling (`CALL_MAX_RETRY_DELAY_MS`) so a
genuinely dead recogniser doesn't burn battery, while a real pause is picked back up within
seconds. Fatal errors (no mic permission) still end it; `ERROR_CLIENT` no longer counts as
one — it is usually an OEM speech service reloading, and it is retried up to
`MAX_RECOGNISER_FAILURES`. `HANDS_FREE` keeps the old give-up budget. *Unit tested.*

**2. The line survives leaving the app.** Voice runs in `ChatManager` on the Activity
lifecycle, so screen-off or app-switch stopped the system feeding microphone audio and the
recogniser went quiet — deaf, but the UI still said listening. `VoiceCallService` declares a
`microphone` foreground service for as long as the mic is on, with an ongoing notification
that opens Junction or ends the call. It owns no audio; `AndroidVoiceEngine` still runs the
recogniser and TTS, so behaviour is identical on screen and off. `START_NOT_STICKY` on
purpose — resurrecting a call after a process kill would put a hot mic on the phone nobody
asked for.

**3. Every way a turn can end now ends it.** Re-arming hung off a spoken reply finishing,
so a provider error, a turn of tool calls with no text, a plan waiting on approval, an
empty reply or a TTS engine that skipped `onDone` all stranded the line. `CallFloor` gives
whoever holds the floor a deadline — 45s to think, a length-scaled budget to speak, 30s of
recogniser silence with every callback counting as proof of life — and `LocalVoiceSession`
polls it once a second. `ChatManager` also reports the ordinary endings explicitly
(`endVoiceTurn`), and says the important ones out loud, because on a call an error that
only lands in the transcript is indistinguishable from Junction hanging up. *Unit tested.*

**4. Barge-in while Junction is speaking.** `BargeInDetector` opens a second, short-lived
`AudioRecord` on `VOICE_COMMUNICATION` underneath playback — never alongside the
recogniser, which is deliberately un-armed for exactly that window — and reduces each 20ms
frame to a loudness figure. `BargeInGate` calibrates against the first 300ms of playback,
which *is* Junction's own voice leaking back through the speaker, then requires 240ms
sustained at 12dB above that (floored at −38dBFS) before it fires. Refuses to run at all
unless `AcousticEchoCanceler.isAvailable()`; on those devices the mic button stays the way
to cut in. *Gate unit tested; the audio path is what most needs a real room.*

**5. The device is behind a seam now, so the turn-taking is actually tested.** Voice broke
twice in the same place, and neither break was a policy bug — `HandsFreeLoop` and
`CallFloor` were correct and unit tested throughout while calls still died after one
sentence. Both failures were in how `LocalVoiceSession` joined the policy to the platform,
and nothing could reach that. `VoiceEngine` is that join: `AndroidVoiceEngine` holds every
Android type (recogniser, TTS, Azure, `AudioRecord`), `LocalVoiceSession` holds none, and
`LocalVoiceSessionTest` runs whole conversations — five turns, a provider error, a wedged
recogniser, a reply that never finishes, barge-in, hanging up mid-reply — through the real
session against a fake engine. 88 unit tests pass.

What that does *not* cover is everything past the seam: real echo in a real room, a real
OEM speech service, real audio focus. That is the list in §3 below.

`VoiceBackend.REALTIME` still exists and would give server-side full duplex, but it needs
`JUNCTION_REALTIME_ENDPOINT` and a deployed backend. The local path no longer depends on
that landing.

## Updating the app

The friction was never the download — it was everything around it.

- **The check ran on cold start only, behind a four-hour cooldown.** A build published
  while Junction sat in the background was invisible until it was force-closed, reopened,
  *and* four hours had passed. Now it runs on every resume (`MainActivity.onResume` bumps
  `foregroundTicks`) behind a five-minute cooldown, so switching away and back is enough.
- **The banner hid itself after six seconds**, leaving a dot that does nothing when tapped.
  Look away at the wrong moment and the only way back was restarting the app. It now stays
  until acted on.
- **A missing "install unknown apps" permission was a dead end** — the intent opened, went
  nowhere, and only after the whole download. It is now checked *before* fetching a byte,
  and the banner offers the exact toggle (`ACTION_MANAGE_UNKNOWN_APP_SOURCES`).
- **The download had no feedback**, so a slow one read as a dead button, and tapping again
  restarted it. There is now a progress bar, the banner is inert while working, and a
  download already matching the published checksum is reused instead of re-fetched.

## What to do, in order

### 1. Build and install

```sh
python3 companion/junctionctl.py doctor          # phone visible and ready?
./gradlew assembleDebug
python3 companion/junctionctl.py install app/build/outputs/apk/debug/app-debug.apk
```

Local builds use the committed keystore, so they install over a button-installed build and
keep its data. Do **not** run `connectedDebugAndroidTest` against a phone with real data on
it — instrumentation builds replace the install.

### 2. Verify the update path end to end

This is the thing that has never been proven, and it is the whole promise.

1. Install the build currently on the button.
2. Push any commit to `main`; wait for `Build Android APK` to go green.
3. Confirm `latest.json` shows the new `versionCode`.
4. In the app, run `check_for_updates` (or wait — startup checks every 4h).
5. It should offer, download, checksum-verify, and install **over** the running app.
6. Confirm API keys, chat history and durable memory all survive.

If step 5 demands an uninstall, signatures diverged — check the fingerprint printed by the
`Resolve debug keystore` CI step against `keytool -list -v -keystore app/debug.keystore`.

### 3. Test the call

```sh
python3 companion/junctionctl.py voice           # stage tracing; shows where a turn dies
python3 companion/junctionctl.py logs
```

- **Have an actual back-and-forth: five or six turns without touching the screen.** This is
  the one that was broken, and one successful turn does not prove it — the failure was
  always on the *second* one. The chip should read Listening → Speaking → Listening.
- Turn the mic on. Say nothing for 3+ minutes. **The line must stay open** — no "Stopped
  listening" message, mic chip still lit, and it must still hear you when you speak.
- Lock the screen mid-call. Speak. It should still hear you, and the ongoing notification
  should be in the shade.
- Switch to another app mid-call. Same.
- Tap **End call** on the notification. The recogniser must actually stop, not just dismiss
  the notification.
- Watch for the self-answer failure: Junction hearing its own TTS and replying to itself.
  That is the bug the half-duplex design exists to prevent — if it appears, `onSpeechHeard`
  is re-arming too early.
- **Ask for something that fails** — with no API key set, or with the network off. Junction
  should say so out loud and then still be listening. Silence there is the old bug.
- **Ask for something that runs a tool**, and something that needs approval. Both must end
  with the mic back on; the approval one should say it is waiting on screen, and must
  **not** be approvable by voice.
- **Talk over a long reply.** It should stop mid-word and start listening. On a device with
  no echo canceller it won't, by design — confirm which you have:
  `adb logcat -s JunctionVoice | grep bargein`. `bargein_unavailable reason=no_aec` means
  this device keeps the mic button as the only way to interrupt.
- **The reverse of that is the dangerous one:** if Junction cuts *itself* off mid-sentence,
  the gate is firing on its own echo. Raise `BargeInGate.DEFAULT_MARGIN_DB` or
  `DEFAULT_ABSOLUTE_FLOOR_DB` and say what the room and audio route were.

`VoiceTrace` markers under tag `JunctionVoice` show exactly which stage a turn stops at.
`floor_overrun` means a turn had to be recovered by the watchdog rather than ending on its
own — the call survives, but the `holder=` on that line says which callback never arrived,
and that is a real bug worth reporting rather than a normal event.

### 4. Test key persistence recovery

`KeyStorage` used to open `EncryptedSharedPreferences` in a field initialiser, so an
invalidated master key threw out of the constructor and crashed on launch — permanently,
since the bad state is on disk. It is now lazy, rebuilds an unreadable store, and falls
back to in-memory rather than crash-looping.

To exercise the recovery path, corrupt the store and confirm the app still launches:

```sh
adb shell run-as com.splinch.junction ls shared_prefs/
# corrupt junction_keys.xml, relaunch, expect: app starts, keys need re-entering, no crash
```

Changing the lock screen also invalidates the master key on many devices.

### 5. Test the self-improvement tool

Add a fine-grained GitHub token in Settings → Self-improvement (Contents + Pull requests,
read and write, scoped to this repo). Ask Junction to make a trivial change.

It must open a **pull request** and must never push to `main` or merge. `main` rebuilds the
APK and republishes it to the URL this phone auto-updates from, so a direct push would ship
unreviewed code onto a device that reads the screen and sends messages. Registered
`DESTRUCTIVE` in `ToolRegistry` so `TrustGate` gates every call.

## Known broken

- **`instrumentation-tests` has failed on every run since at least #52** — "Timeout waiting
  for emulator to boot" on the macOS runner. Predates all of the above. The injection test
  suite in `app/src/androidTest` is therefore effectively switched off. `unit-tests` passes.
  Worth fixing early: it is the safety net for the trust model.
- **Nothing here has touched hardware.** Foreground services in particular get treated
  differently by OEMs — Xiaomi/MIUI especially.
- `EncryptedSharedPreferences` is deprecated. Recovery is handled; the migration off it is
  not started.
