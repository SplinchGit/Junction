# Junction World persistent runtime

Deployment record: 2026-09-25. This file describes the running VM. The older provisioning checklist in `SECURITY-AND-SETUP.md` is historical and contains initial-install notes that are superseded here.

## Runtime and interfaces

There is one persistent cognition process in Debian: `junction-world-heartbeat.service`, running as the unprivileged `junction` user. It is a long-lived event loop with `Restart=on-failure`; it waits without inference while idle, wakes for an owner message or scheduled task, and can sleep on an epoch-based timer. State, scheduler, goals, memory, recent conversation, Minesweeper state, and workspace data live on the separate `/home/junction/junction` workspace filesystem. The runtime and workspace survive service and VM restarts.

`junction-world.service` is the root-owned supervisor and narrow relay. It owns the authenticated Unix socket at `/run/junction-world/agent.sock`, persistent bounded supervisor/audit state under `/var/lib/junction-world`, the guest HTTP relay, and the loopback-only viewer. The Windows Junction app brokers `qwen3.5:2b` inference and Android Audit events; inference is a request to the persistent Junction runtime, not a separate chatbot.

Android messages enter the existing host Audit queue and the guest inbox. Debian local chat uses the guest viewer's `/v1/ui/messages` route and the same inbox, conversation ID, cognition process, and persisted chat history. Debian-origin owner events are mirrored through the existing authenticated Audit poll queue. The guest removes the internal source field when projecting events to the unchanged Windows schema. Local chat and the viewer read the guest-owned bounded event history. No Android protocol replacement or alternate identity was added.

The local clients are:

```text
junction chat       # live terminal client to the shared runtime
junction status     # status, activity, model, uptime, next wake
junction viewer     # opens the loopback viewer
junction diary      # reads Junction's open diary
```

The viewer is at `http://127.0.0.1:43131/ui` inside Debian. Its local message composer reconnects to the same runtime. It displays safe activity summaries and does not synthesize hidden reasoning.

## Writable areas and protections

Junction can read/write/delete workspace content under `/home/junction/junction/{identity,memory,projects,journal,diary,self}`. Its self-editable prompts and helpers are under `self/`; self-file checkpoints are bounded and restorable through `restore_self`. `junction-code` execution is an isolated child systemd unit with private networking, a 20-second runtime ceiling, capped memory, processes, file size and temporary filesystems. The persistent agent itself has no arbitrary wake deadline, but remains capped at 768 MiB, 80% CPU, 64 tasks, and a 32 MiB individual file-size limit. Workspace writes stop at the 8 GiB safety threshold on the 10 GiB workspace volume. Journald, viewer history and audit queues are bounded/rotated.

Junction cannot write `/usr/lib/junction-world`, systemd policy, firewall rules, `/var/lib/junction-world` audit history, the Windows inference broker, or Windows files. The root supervisor has only the fixed service, socket, inbox, audit and bounded relay operations. Model-generated Python runs as `junction-code`, with no network and no host access. Research is the existing narrow Wikipedia broker. No shared folders, clipboard, drag/drop, audio, VRDE, recording, or USB passthrough is enabled. VirtualBox NAT is guarded to `localhostReachable=0` and one reviewed TCP forward bound to `127.0.0.1:43130`; no general guest-to-host command or file API exists. Host pause remains authoritative and the guest pauses if its host-control lease expires.

Sensors are not connected. Camera/microphone broker hooks remain future work and cannot be enabled from Junction's editable files.

## Owner controls

Run service administration from a Debian root shell (`su -`; James is not in `sudoers`):

```sh
systemctl start junction-world.service
systemctl stop junction-world-heartbeat.service
systemctl restart junction-world-heartbeat.service
systemctl status junction-world.service junction-world-heartbeat.service
journalctl -u junction-world.service -u junction-world-heartbeat.service -f
find /home/junction/junction/diary -maxdepth 1 -type f -name '*.md' -exec cat {} +
```

Use the Windows Junction app or Android Audit pause control for the owner pause. Keep the Windows app open for host inference and the Audit relay.

## Verification and known limits

Verified during deployment:

- Debian booted after a clean shutdown and the runtime services became active; a later guest reboot also returned both services to `active` and Junction to `IDLE`.
- `junction chat` opened in Debian, received an owner message, and returned a real host-model response. The same stored message and response were visible after guest reboot.
- Restarting `junction-world-heartbeat.service` preserved service availability and persisted history.
- The Windows Junction audit store recorded both a Debian local-chat owner event and the Junction response using the existing communication event contract. Windows bridge/relay regression tests passed.
- Scheduler persistence, sleep deadlines, Minesweeper state/actions, bounded recent-history formatting, malformed-model-response handling, local viewer origin checks, and safe display normalization passed the guest unit/source tests.
- The final VM is running with 2048 MiB RAM, 2 vCPUs, the separate 10 GiB workspace disk, `usbkbd` and `usbtablet`, and the reviewed NAT forward. Keyboard entry was exercised through sign-in, terminal commands, and local chat. Mouse device configuration was checked and left unchanged; a physical mouse click was not independently exercised in this session.

Not verified end-to-end: a physical Android device/Audit tab was unavailable, so the new Debian-origin Audit event was checked in the Windows host Audit store and with bridge tests rather than on a phone. The 2B model still falsely claimed not to remember a pre-reboot message even though the shared viewer/history showed it and the recent excerpt was included in inference context. Storage continuity is verified; semantic recall from this model is not reliable. The Windows helper tests do not prove host filesystem isolation against an actual escape attempt. Self-modification/rollback, a long-running multi-step project, scheduled wake after VM reboot, and model-driven Minesweeper play were implemented but not exercised end-to-end in this session.
