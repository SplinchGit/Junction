#!/usr/bin/env python3
"""
junctionctl -- Junction's PC companion.

Runs on the machine the phone is plugged into. Python 3.8+, standard library only:
no pip install, no toolchain, no Android Studio. The point is that it works on a
laptop that has nothing set up but a USB cable.

    python3 junctionctl.py doctor          # is the phone visible and ready?
    python3 junctionctl.py voice           # diagnose why voice isn't working
    python3 junctionctl.py install app.apk # sideload a build
    python3 junctionctl.py logs            # filtered logcat

`voice` is the one that matters: it checks the four device-side things voice needs,
then watches Junction's own stage markers and reports the exact point a turn stops.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from typing import List, Optional, Sequence

VOICE_TAG = "JunctionVoice"
PACKAGE = "com.splinch.junction"

# ---------------------------------------------------------------------------
# adb plumbing
# ---------------------------------------------------------------------------

# Where platform-tools normally lands per OS, so someone who installed Android
# Studio (or unzipped platform-tools) doesn't also have to fix their PATH.
_ADB_HINTS = [
    "~/Android/Sdk/platform-tools/adb",
    "~/Library/Android/sdk/platform-tools/adb",
    "~/AppData/Local/Android/Sdk/platform-tools/adb.exe",
    "/usr/lib/android-sdk/platform-tools/adb",
    "/opt/android-sdk/platform-tools/adb",
]


class AdbMissing(RuntimeError):
    pass


def find_adb() -> str:
    """Locate adb on PATH, via $ANDROID_HOME, or in the usual SDK locations."""
    found = shutil.which("adb")
    if found:
        return found

    for var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        root = os.environ.get(var)
        if root:
            for exe in ("adb", "adb.exe"):
                candidate = os.path.join(root, "platform-tools", exe)
                if os.path.isfile(candidate):
                    return candidate

    for hint in _ADB_HINTS:
        candidate = os.path.expanduser(hint)
        if os.path.isfile(candidate):
            return candidate

    raise AdbMissing(
        "adb was not found.\n"
        "  Install Android platform-tools and either put adb on your PATH or set\n"
        "  ANDROID_HOME. Download: https://developer.android.com/tools/releases/platform-tools"
    )


class Adb:
    def __init__(self, serial: Optional[str] = None):
        self.exe = find_adb()
        self.serial = serial

    def _argv(self, args: Sequence[str]) -> List[str]:
        argv = [self.exe]
        if self.serial:
            argv += ["-s", self.serial]
        return argv + list(args)

    def run(self, *args: str, timeout: int = 30) -> subprocess.CompletedProcess:
        return subprocess.run(
            self._argv(args),
            capture_output=True,
            text=True,
            timeout=timeout,
            errors="replace",
        )

    def out(self, *args: str, timeout: int = 30) -> str:
        return self.run(*args, timeout=timeout).stdout.strip()

    def shell(self, command: str, timeout: int = 30) -> str:
        return self.out("shell", command, timeout=timeout)

    def stream(self, *args: str) -> subprocess.Popen:
        return subprocess.Popen(
            self._argv(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            errors="replace",
        )


class Device:
    """One line of `adb devices -l`."""

    def __init__(self, serial: str, state: str, model: str = ""):
        self.serial = serial
        self.state = state
        self.model = model

    @property
    def ready(self) -> bool:
        return self.state == "device"

    def describe(self) -> str:
        name = self.model or self.serial
        if self.state == "unauthorized":
            return f"{name} -- UNAUTHORIZED (unlock the phone and accept the USB debugging prompt)"
        if self.state == "offline":
            return f"{name} -- offline (replug the cable, or try a different USB port)"
        return f"{name} ({self.serial})"


def list_devices(adb: Adb) -> List[Device]:
    adb.run("start-server", timeout=60)
    devices = []
    for line in adb.out("devices", "-l").splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        serial, state = parts[0], parts[1]
        model = ""
        for token in parts[2:]:
            if token.startswith("model:"):
                model = token.split(":", 1)[1].replace("_", " ")
        devices.append(Device(serial, state, model))
    return devices


def require_device(adb: Adb) -> Device:
    devices = list_devices(adb)
    if not devices:
        raise SystemExit(
            "No device detected.\n"
            "  1. Plug the phone in with a cable that carries data (some are charge-only).\n"
            "  2. On the phone: Settings > About > tap Build number 7 times to unlock\n"
            "     Developer options, then enable USB debugging.\n"
            "  3. Unlock the screen and accept the 'Allow USB debugging?' prompt."
        )
    ready = [d for d in devices if d.ready]
    if not ready:
        raise SystemExit("Device found but not usable:\n  " + "\n  ".join(d.describe() for d in devices))
    if len(ready) > 1 and not adb.serial:
        raise SystemExit(
            "More than one device is connected. Pick one with --serial:\n  "
            + "\n  ".join(d.describe() for d in ready)
        )
    return ready[0]


# ---------------------------------------------------------------------------
# Voice diagnosis
# ---------------------------------------------------------------------------

# A voice turn in order. Reaching a stage means everything before it worked, so the
# highest stage seen is the whole diagnosis.
STAGE_ORDER = [
    "session_start",
    "tts_ready",
    "listening_armed",
    "listening",
    "heard",
    "dispatched",
    "reply_ready",
    "speak_requested",
    "speaking",
    "spoke_done",
]

# What it means when a turn gets no further than each stage.
STAGE_STALL = {
    None: (
        "Junction never started a voice session.",
        "Speech mode is off, or the app isn't running. Open Junction and tap the mic "
        "chip, then run this again.",
    ),
    "session_start": (
        "The voice session started but the recogniser never armed.",
        "Check the recognizer_available flag above. If it is false, this phone has no "
        "speech recogniser -- install Google (or your OEM's) speech services.",
    ),
    "tts_ready": (
        "Text-to-speech initialised but listening never started.",
        "The mic is off. Turn on the Mic chip in the chat screen.",
    ),
    "listening_armed": (
        "The recogniser was armed but the microphone never went live.",
        "Almost always the RECORD_AUDIO permission. Run: junctionctl grant",
    ),
    "listening": (
        "The mic was live but nothing was recognised.",
        "Speak clearly and close to the phone. If it never recognises anything, the "
        "recogniser may need a network connection, or a language pack.",
    ),
    "heard": (
        "Speech was recognised but never reached the model.",
        "Junction's chat lane dropped it. Check the logs for a provider error.",
    ),
    "dispatched": (
        "The utterance reached the model but no reply came back.",
        "Provider problem: missing or invalid API key, no network, or rate limited. "
        "Check Settings > provider, and look for errors in: junctionctl logs",
    ),
    "reply_ready": (
        "A reply arrived but synthesis was never requested.",
        "This is a bug -- please report it with the log output.",
    ),
    "speak_requested": (
        "Synthesis was requested but no audio played.",
        "If via=queued, the TTS engine never finished starting. If via=device, no TTS "
        "engine is installed or no voice data is downloaded: Settings > Accessibility > "
        "Text-to-speech. If via=cloud, the cloud voice key or network is failing.",
    ),
    "speaking": (
        "Audio started but never finished.",
        "Playback was interrupted -- check the media volume and whether another app "
        "holds audio focus.",
    ),
    "spoke_done": (
        "A complete voice turn succeeded.",
        "Voice is working end to end.",
    ),
}

_STAGE_RE = re.compile(r"stage=(\w+)(.*)")


class VoiceDiagnosis:
    """Consumes JunctionVoice log lines and reports how far a turn got."""

    def __init__(self) -> None:
        self.best: Optional[str] = None
        self.details: dict = {}
        self.asr_errors: List[int] = []
        self.gave_up: Optional[str] = None
        self.silent_turns = 0

    def feed(self, line: str) -> Optional[str]:
        """Record a log line. Returns the stage name if it was one, else None."""
        match = _STAGE_RE.search(line)
        if not match:
            return None
        stage, detail = match.group(1), match.group(2).strip()

        if stage == "asr_error":
            code = re.search(r"code=(\d+)", detail)
            if code:
                self.asr_errors.append(int(code.group(1)))
            return stage
        if stage == "silent":
            self.silent_turns += 1
            return stage
        if stage == "handsfree_ended":
            reason = re.search(r"reason=(\w+)", detail)
            self.gave_up = reason.group(1) if reason else "unknown"
            return stage

        if stage in STAGE_ORDER:
            if detail:
                self.details[stage] = detail
            if self.best is None or STAGE_ORDER.index(stage) > STAGE_ORDER.index(self.best):
                self.best = stage
        return stage

    def report(self) -> str:
        verdict, advice = STAGE_STALL.get(self.best, ("Unrecognised state.", ""))
        lines = ["", "=" * 68, "  VOICE DIAGNOSIS", "=" * 68]
        lines.append(f"  Furthest stage reached: {self.best or '(none)'}")
        for stage in STAGE_ORDER:
            if stage in self.details:
                lines.append(f"    {stage}: {self.details[stage]}")
        lines.append("")
        lines.append(f"  {verdict}")
        if advice:
            lines.append(f"  -> {advice}")

        if self.asr_errors:
            lines.append("")
            lines.append("  Recogniser errors seen:")
            for code in sorted(set(self.asr_errors)):
                lines.append(f"    code {code}: {ASR_ERRORS.get(code, 'unknown error')}")
        if self.silent_turns:
            lines.append(f"\n  {self.silent_turns} listening turn(s) heard nothing.")
        if self.gave_up:
            lines.append(f"  Hands-free listening stood down (reason: {self.gave_up}).")
        lines.append("=" * 68)
        return "\n".join(lines)


# android.speech.SpeechRecognizer.ERROR_* constants.
ASR_ERRORS = {
    1: "network timeout",
    2: "network error -- the recogniser needs a connection",
    3: "audio recording error",
    4: "server error",
    5: "client side error",
    6: "no speech input (timeout)",
    7: "no match -- nothing was understood",
    8: "recogniser busy",
    9: "insufficient permissions -- run: junctionctl grant",
    10: "too many requests",
    11: "server disconnected",
    12: "language not supported",
    13: "language unavailable -- download the language pack",
    14: "no offline voice data -- download it in speech settings",
}


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_doctor(adb: Adb, _args) -> int:
    print(f"adb: {adb.exe}")
    devices = list_devices(adb)
    if not devices:
        print("\nNo device detected.")
        print("  - Use a data-capable cable (charge-only cables show nothing here)")
        print("  - Enable Developer options, then USB debugging")
        print("  - Unlock the screen and accept the USB debugging prompt")
        return 1

    print("\nDevices:")
    for d in devices:
        print(f"  {d.describe()}")

    device = [d for d in devices if d.ready]
    if not device:
        return 1
    adb.serial = adb.serial or device[0].serial

    print(f"\nAndroid: {adb.shell('getprop ro.build.version.release')} "
          f"(API {adb.shell('getprop ro.build.version.sdk')})")

    installed = PACKAGE in adb.shell(f"pm list packages {PACKAGE}")
    print(f"Junction installed: {'yes' if installed else 'no'}")
    if installed:
        version = adb.shell(f"dumpsys package {PACKAGE} | grep versionName").strip()
        if version:
            print(f"  {version}")
    else:
        print("  -> sideload a build: junctionctl install path/to/app.apk")
    return 0


def _voice_preflight(adb: Adb) -> bool:
    """Check the device-side prerequisites. Returns False if voice cannot work at all."""
    print("Checking device prerequisites...\n")
    fatal = False

    if PACKAGE not in adb.shell(f"pm list packages {PACKAGE}"):
        print("  [FAIL] Junction is not installed.")
        print("         -> junctionctl install path/to/app.apk")
        return False
    print("  [ ok ] Junction is installed")

    perms = adb.shell(f"dumpsys package {PACKAGE} | grep RECORD_AUDIO")
    if "granted=true" in perms:
        print("  [ ok ] Microphone permission granted")
    else:
        print("  [FAIL] Microphone permission is NOT granted.")
        print("         -> junctionctl grant")
        fatal = True

    recognisers = adb.shell("pm list packages -e | grep -iE 'speech|voicesearch|googlequicksearchbox'")
    if recognisers.strip():
        print("  [ ok ] A speech recogniser package is present")
    else:
        print("  [WARN] No speech recogniser package found.")
        print("         -> install Google app / Speech Services, or voice cannot listen")

    tts = adb.shell("settings get secure tts_default_synth")
    if tts and tts.lower() not in ("null", ""):
        print(f"  [ ok ] Text-to-speech engine: {tts}")
    else:
        print("  [WARN] No default text-to-speech engine set.")
        print("         -> Settings > Accessibility > Text-to-speech output")

    print()
    return not fatal


def cmd_voice(adb: Adb, args) -> int:
    require_device(adb)
    if not _voice_preflight(adb) and not args.force:
        print("Fix the failures above, then run this again (or pass --force to watch anyway).")
        return 1

    if args.launch:
        print(f"Launching Junction...\n")
        adb.run("shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1")
        time.sleep(2)

    adb.run("logcat", "-c")
    print("=" * 68)
    print("  Open Junction, turn on speech mode and the mic, then SAY SOMETHING.")
    print(f"  Watching for {args.seconds}s. Press Ctrl-C to stop early.")
    print("=" * 68 + "\n")

    diagnosis = VoiceDiagnosis()
    proc = adb.stream("logcat", "-v", "brief", f"{VOICE_TAG}:I", "*:S")
    deadline = time.time() + args.seconds
    try:
        assert proc.stdout is not None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            if diagnosis.feed(line):
                print("  " + line.strip())
    except KeyboardInterrupt:
        print("\n  (stopped)")
    finally:
        proc.terminate()

    print(diagnosis.report())
    return 0 if diagnosis.best == "spoke_done" else 1


def cmd_grant(adb: Adb, _args) -> int:
    require_device(adb)
    result = adb.run("shell", "pm", "grant", PACKAGE, "android.permission.RECORD_AUDIO")
    if result.returncode == 0 and not result.stderr.strip():
        print("Microphone permission granted.")
        return 0
    print(f"Failed to grant the permission:\n  {result.stderr.strip() or result.stdout.strip()}")
    print("  Grant it by hand: Settings > Apps > Junction > Permissions > Microphone")
    return 1


def cmd_install(adb: Adb, args) -> int:
    require_device(adb)
    if not os.path.isfile(args.apk):
        print(f"No such file: {args.apk}")
        return 1
    print(f"Installing {args.apk} ...")
    # -r keeps app data across reinstalls; -d allows installing over a newer build.
    result = adb.run("install", "-r", "-d", args.apk, timeout=600)
    output = (result.stdout + result.stderr).strip()
    if "Success" in output:
        print("Installed.")
        return 0
    print(output)
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in output:
        print("\n  This APK is signed with a different key than the installed build.")
        print(f"  Uninstall first (this erases app data): adb uninstall {PACKAGE}")
    return 1


def cmd_logs(adb: Adb, args) -> int:
    require_device(adb)
    adb.run("logcat", "-c")
    tags = ["JunctionVoice:I", "ChatManager:D", "LocalVoiceSession:D", "AndroidRuntime:E"]
    print("Streaming Junction logs. Ctrl-C to stop.\n")
    proc = adb.stream("logcat", "-v", "brief", *tags, "*:S")
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if args.grep and args.grep.lower() not in line.lower():
                continue
            print(line.rstrip())
    except KeyboardInterrupt:
        pass
    finally:
        proc.terminate()
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="junctionctl",
        description="Junction's PC companion -- talks to the phone over USB.",
    )
    parser.add_argument("--serial", help="target a specific device (see: junctionctl doctor)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check the connection and what is installed")

    voice = sub.add_parser("voice", help="diagnose why voice isn't working")
    voice.add_argument("--seconds", type=int, default=60, help="how long to watch (default 60)")
    voice.add_argument("--no-launch", dest="launch", action="store_false",
                       help="don't start the app first")
    voice.add_argument("--force", action="store_true",
                       help="watch even if prerequisites failed")

    sub.add_parser("grant", help="grant the microphone permission over adb")

    install = sub.add_parser("install", help="sideload an APK")
    install.add_argument("apk", help="path to the .apk file")

    logs = sub.add_parser("logs", help="stream filtered Junction logs")
    logs.add_argument("--grep", help="only show lines containing this text")

    args = parser.parse_args(argv)

    try:
        adb = Adb(args.serial)
    except AdbMissing as exc:
        print(exc, file=sys.stderr)
        return 1

    handlers = {
        "doctor": cmd_doctor,
        "voice": cmd_voice,
        "grant": cmd_grant,
        "install": cmd_install,
        "logs": cmd_logs,
    }
    return handlers[args.command](adb, args)


if __name__ == "__main__":
    sys.exit(main())
