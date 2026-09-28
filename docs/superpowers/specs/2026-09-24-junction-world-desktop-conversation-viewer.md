# Junction World desktop conversation viewer

## Purpose

Show the owner Junction World’s live conversation and public activity in a normal window inside the Debian VM. The owner continues to send messages and control autonomy from the paired Android Audit tab. The VM window makes the same exchange visible beside the agent without requiring an Android emulator.

## User-approved direction

The owner selected a lightweight conversation window over running the Android APK in Debian. The VM currently has 2 GiB RAM and is intentionally isolated; an Android runtime would add substantial memory use and a new subsystem.

## User experience

- A clearly named “Junction World” desktop launcher opens the viewer in the VM’s existing graphical session and default installed browser, in a normal resizable window. The user can keep using the USB keyboard and mouse and can close the window normally.
- The viewer shows owner-to-agent messages and Junction’s replies in order, with timestamps, plus recent high-level activity such as wake, action outcome, reflection summary, and sleep state.
- New activity appears automatically while the window is open. An unavailable or paused agent is shown plainly; the viewer does not imply that Junction is active when it is sleeping or paused.
- The viewer is read-only. The Android app remains the only interface for sending messages, pausing/resuming, and changing the wake interval.
- Display only audit-safe summaries and communication text already approved for the host Audit feed. Never display hidden model reasoning, raw inference prompts, credentials, private tool arguments, or full agent state.

## Data flow and security boundaries

1. Android continues to send an owner message through the existing paired, authenticated host relay.
2. The Windows relay delivers the bounded message to the guest through the existing `/v1/messages` route.
3. The guest records a bounded local viewer history for owner and agent communication, and a bounded sanitized activity snapshot, before the host can acknowledge and remove transient guest audit events.
4. A separate read-only viewer listener bound only to guest loopback returns those records and current pause/heartbeat status. It uses port 43131, checks the exact loopback Host and same-origin browser Origin, and has no Windows NAT forward; the existing host relay listener and routes remain unchanged.
5. The guest serves a small static viewer page. The snapshot route accepts no writes and exposes no raw workspace, memory, goals, inference queue, model prompt, or host control.

The viewer remains inside the existing VM network boundary. Do not add a new NAT forward, LAN listener, USB passthrough, shared folder, clipboard bridge, arbitrary proxy, or host control route. Keep current Windows-owned pause/resume and Android pairing behavior unchanged. All rendered content is untrusted text: escape it in the browser and do not interpret it as markup or script.

## Bounded storage and freshness

- Retain a small fixed number of recent viewer events, with per-field and total response-size limits. Persist them in root-owned service state on the existing persistent VM disk so the transcript survives a guest restart and Junction cannot rewrite its own displayed history.
- Keep entries append-only from the viewer’s perspective; deduplicate by communication/event ID. When capacity is reached, drop the oldest entry and show that the visible history is bounded.
- Poll at a modest interval while the window is open; do not add a continuous model wake or network request to Ollama.
- Handle empty history, paused/offline status, stale data, and malformed event data without crashing or erasing prior entries.

## Startup and input safety

- Add a guest desktop launcher; do not force kiosk mode or capture global keyboard/mouse input.
- Preserve the VirtualBox USB Keyboard and USB Tablet device configuration and the disabled USB device passthrough state.
- Do not restart or reconfigure the VM’s USB controller as part of viewer startup.
- Confirm which browser is already installed before choosing its launch command. If no graphical browser exists, stop and present the smallest Debian-signed package/install route for approval rather than broadening guest network access.

## Implementation scope

- Extend the guest service with a fixed read-only snapshot endpoint and a static viewer page.
- Add bounded persistence for the display-safe transcript/activity data, keeping existing service state and audit acknowledgement semantics intact.
- Add the desktop launcher and document how to open the viewer again.
- Update provisioning files and their integrity manifest/ISO only after the reviewed implementation is complete.
- Leave Windows relay protocol and Android app behavior unchanged.

## Acceptance criteria

- A message sent from Android Audit appears in the VM viewer, followed by Junction’s reply and its relevant wake/sleep activity.
- Existing Android Audit continues to show the same exchange and remains able to pause/resume Junction.
- Viewer data survives a service/VM restart within the configured history bound.
- Malformed or oversized text renders as inert text; the endpoint cannot change controls or enqueue messages.
- The viewer does not reveal inference prompts or hidden model reasoning.
- VM input configuration is unchanged, the keyboard remains usable, and clicking/scrolling/closing the viewer does not capture or block host input.
- No new network forward or egress permission is needed to display the page.
