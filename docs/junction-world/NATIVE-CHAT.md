# Native Debian Junction client

Status: installed by James from `artifacts/junction-world-native-update.iso` on 2026-09-27. A fresh VM console screenshot confirmed the installer's success message and both runtime services active. The Windows Audit store then recorded a real guest `list_files` call and its successful empty-projects result. Graphical GTK launch is still unverified: the Windows desktop helper timed out capturing the VM, and its keyboard input produced no visible guest change. This does not indicate a problem with James's physical keyboard; no device settings were changed.

The new **Junction** application menu entry runs `/usr/local/bin/junction-chat`. `junction app` opens the same client. It uses GTK 3 native widgets through Debian's Python GI bindings, with Conversation, Activity and Diary tabs. It reconnects to the existing loopback service, sends messages into the shared inbox, and reads the shared protected history. There is no model, agent loop, memory store or independent identity inside the client. Closing it leaves the service running.

On desktops without `python3-gi` and `gir1.2-gtk-3.0`, the launcher opens the existing `junction chat` terminal client through `x-terminal-emulator`. The graphical dependency must be installed from Debian packages through owner administration if absent; this update does not loosen the guest firewall or install packages over an unrestricted network.

The client renders model text literally, labels model activity summaries as unverified, caps response sizes, bypasses environment proxies for its fixed loopback requests and reuses message IDs when delivery is uncertain. The native client uses the exact existing viewer API and conversation. The browser viewer remains available through `junction viewer`.

Verification on the host: all 36 Python runtime/viewer/client tests passed, native client syntax compiled, and the host relay/inference/bridge tests passed. These checks cover protocol and display formatting; they do not substitute for opening the GTK window in Debian.

The latest VM inspection reports `localhostReachable=0`, one host-loopback-only audit port forward, 2048 MiB RAM, disabled clipboard/drag-and-drop/audio, and the USB keyboard/tablet emulation. The unchanged runtime policies cap code execution, CPU, memory, processes, workspace usage and logs. Protected guest policy must still be inspected live before claiming a complete security audit.

## Finishing installation

The native update ISO is attached as the read-only optical drive. In a Debian root terminal:

```sh
mkdir -p /mnt/junction-native
mount -o ro /dev/sr0 /mnt/junction-native
sh /mnt/junction-native/update-guest-runtime.sh
```

Then launch **Junction** from the Debian applications menu or run `junction app` as the normal desktop user. Check `junction status` and exchange a message. James's free-exploration request was sent over the fixed host relay route (message `dae4af89-85d6-4080-8e04-8245005857ba`), explicitly labeled in its text as coming from the setup assistant on James's behalf. The legacy route classifies host messages as Android in viewer metadata; the request was not sent from a physical phone. Junction inspected its projects and replied. A follow-up (`72cd86ca-8749-4553-a269-20e2fdfb5877`) points out that its promised goal was not created and lets it choose actual work, recreation, sleep or idle. This is not a completed 14-hour soak test.

For unattended operation, Windows, the Debian VM, Ollama and the Windows Junction app must stay running and the computer must remain awake. Host inference and the owner-control lease depend on the Windows app. This update does not change the host's power settings. Activity is stored in the existing bounded/rotated host Audit logs and protected guest history; voluntary diary entries remain Junction's choice.
