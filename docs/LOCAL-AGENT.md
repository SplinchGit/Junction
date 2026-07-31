# Handoff to the local agent

For a model running on the PC the phone is plugged into. It has what the cloud agent that
wrote this did not: `adb`, and therefore the actual device.

Everything below is on `main`. CI is confirmed green through `3369139` (build 58);
`abc7b50` was still building when this was written, so **check that run before trusting the
`propose_code_change` tool** — it is the one commit here whose compile is unverified.

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

Three pieces, two of them landed.

**1. The line does not hang up on silence.** `HandsFreeLoop` has an explicit `Mode`.
`CALL` never returns `GiveUp` for a silent turn — the owner opened the line, only the owner
closes it. Retries back off linearly to a 4s ceiling (`CALL_MAX_RETRY_DELAY_MS`) so a
genuinely dead recogniser doesn't burn battery, while a real pause is picked back up within
seconds. Fatal errors (no mic permission) still end it. `HANDS_FREE` keeps the old give-up
budget. *Done, unit tested.*

**2. The line survives leaving the app.** Voice runs in `ChatManager` on the Activity
lifecycle, so screen-off or app-switch stopped the system feeding microphone audio and the
recogniser went quiet — deaf, but the UI still said listening. `VoiceCallService` declares a
`microphone` foreground service for as long as the mic is on, with an ongoing notification
that opens Junction or ends the call. It owns no audio; `LocalVoiceSession` still runs the
recogniser and TTS, so behaviour is identical on screen and off. `START_NOT_STICKY` on
purpose — resurrecting a call after a process kill would put a hot mic on the phone nobody
asked for. *Done, never run on hardware.*

**3. Barge-in while Junction is speaking.** Not done. Today turn-taking is strictly
half-duplex: the recogniser is deliberately not armed while TTS plays, because it would
transcribe Junction's own voice and answer itself. You can only interrupt by tapping the
mic. A real call lets you cut in mid-sentence. Two routes:

- **On-device:** arm the recogniser during playback with `EXTRA_PARTIAL_RESULTS`, and use
  `AcousticEchoCanceler` plus playback-vs-input gating to reject self-audio. Fiddly, and
  echo cancellation quality varies wildly by device.
- **Realtime API:** `VoiceBackend.REALTIME` already exists and gives true full-duplex with
  server-side interruption. Needs `JUNCTION_REALTIME_ENDPOINT` configured.

Recommendation: get the Realtime path working before hand-rolling echo cancellation.

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

`VoiceTrace` markers under tag `JunctionVoice` show exactly which stage a turn stops at.

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
