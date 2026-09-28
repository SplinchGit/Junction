# Junction cognition investigation — 2026-09-27

## Deployment status

The Debian VM was restarted through the existing guarded launcher. Its live NAT setting now reports `localhostReachable=0`. The preceding direct GUI launch had enabled loopback reachability; the virtual cable was disconnected before a clean shutdown and guarded restart. Input device settings were preserved by the existing launcher.

The cognition changes were initially packaged but not deployed because automatic approval review rejected a guest authentication command with `blocked by policy` and no further reason. James subsequently installed the combined cognition/native-client update himself from `artifacts/junction-world-native-update.iso` on 2026-09-27. A fresh VM console capture confirms installer success and active supervisor/cognition services. Real file-listing and reply events subsequently appeared in host Audit. See `NATIVE-CHAT.md` for remaining graphical-client verification and the exploration request. No credentials are included in the update images.

## Findings from actual Audit records

The host Audit store contains Android-origin owner messages asking whether Junction can access its VM, followed by guest wake events, host inference and guest replies. The replies repeatedly deny access to earlier conversations even when the current question is about the environment. This establishes the Android-to-runtime-to-host-response path; it does not independently verify rendering on the physical phone.

Code inspection and reproductions found:

- The same conversation was presented as role messages, a system excerpt and another excerpt beside the latest question. Repeated erroneous assistant replies became strong examples for the small model to copy.
- `messages[-20:]` could discard the system message during tool use.
- A four-inference limit ended a task even when the final output still requested tools.
- Response text was truncated before JSON parsing, breaking otherwise valid action objects.
- `get_game()` tried to access `x` and `y`, which that operation does not accept.
- A successful sleep action was followed by another inference call.

## Changes

`agent.py` now describes concrete read/write capabilities and their real restrictions. Historical replies are records rather than new assistant examples. Persistent memory, history, goals and scheduler context are bounded before IPC; system instructions and the current request remain present as tool results accumulate. This changes inference context, not stored history or the shared event protocol.

The tool loop continues until a natural reply, successful sleep, owner pause, error or three identical consecutive tool/result pairs. Each tool result is saved to decisions and recorded in the protected supervisor log. This does not add a durable in-flight tool transcript or exactly-once execution across crashes; those remain limitations of the existing runtime. The existing 45-second active-goal retry policy remains unchanged.

The parser accepts the broker's existing 16,000-character output bound before applying display limits. Output requests use 512 tokens, already allowed by both brokers. Model identity, inference settings, network policy, workspace limits, Android IPC and immutable supervisor files are unchanged.

## Verification

- Regression tests reproduce the old four-call stop, sleep-followed-by-inference, large-JSON parsing failure and Minesweeper `KeyError` before the fixes.
- All 33 Python runtime/viewer tests pass. One first-run Windows HTTP connection abort disappeared on the focused rerun and full reruns.
- The fixed-model inference payload and host relay tests pass (five Node test cases); the separate world-bridge validation test also passes.
- Actual local `qwen3.5:2b` probes, with synthetic repeated-refusal history, show that presenting history as records improves the environment answer. The model correctly states Debian and read/write workspace access, recalls a supplied project fact, selects `list_files`, and proposes `write_file` plus `run_python`.
- These probes do not execute proposed tools and do not prove guest deployment, autonomous project completion or phone rendering. Run `python scripts/junction-world/probe_cognition.py --run` to repeat the model-only checks.

The model can still make false claims. Its brief activity summaries are model-authored text, not proof of an action; tool execution/results in Audit are the evidence. This is an orchestration improvement, not a change in model size or a claim of human-like awareness.

## Install the prepared update

In a Debian root terminal, after the update ISO is attached:

```sh
mkdir -p /mnt/junction-cognition
mount -o ro /dev/sr0 /mnt/junction-cognition
sh /mnt/junction-cognition/update-guest-runtime.sh
```

The updater verifies the manifest, stops cognition for installation, restarts services and checks health, restoring prior protected files on failure. Then verify `junction status`, send a message through `junction chat`, and repeat through Android Audit. Ask Junction to create, read and run a small project before claiming the model improvement is verified inside the VM.
