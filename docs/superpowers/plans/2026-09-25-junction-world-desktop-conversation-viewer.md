# Junction World desktop conversation viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, read-only desktop viewer inside Debian so the owner can see Junction World’s Android messages, replies, and public activity in real time.

**Architecture:** Extend the existing root-owned guest service with a bounded persistent display history, populated from validated owner messages and guest audit events. Serve a static same-origin page and a read-only snapshot route on the existing port, then install a system application launcher that opens the page in an already installed browser. Keep Android pairing, Windows relay, controls, network forwarding, and VM input configuration unchanged.

**Tech Stack:** Python 3 standard library HTTP service and persistence; static HTML, CSS, and JavaScript; Debian `.desktop` launcher; PowerShell provisioning ISO builder; existing Python `unittest` source checks.

**Spec:** `docs/superpowers/specs/2026-09-24-junction-world-desktop-conversation-viewer.md`

## Global Constraints

- VM remains at 2 GiB RAM and the existing persistent work-disk layout.
- Viewer is read-only; Android remains the only message and autonomy control surface.
- Do not add NAT forwarding, LAN listeners, USB passthrough, shared folders, clipboard, arbitrary proxy routes, or host-control routes.
- Retain at most 200 display events and 512 KiB of serialized history; bound communication text to 2,000 characters per entry and each response to 256 KiB.
- Show only communication text, public audit summaries, timestamps, status, and action outcomes; never return model prompts, inference queues, hidden reasoning, workspace contents, credentials, or raw tool arguments.
- Treat all message and audit strings as untrusted; render them as text, never HTML.
- Preserve VirtualBox USB Keyboard, USB Tablet, and disabled USB passthrough; do not change the VM USB controller or integrations.
- Use the existing guest browser if one is installed. If no suitable graphical browser is installed, stop and present the smallest Debian-signed installation route for approval; do not broaden egress.

## Review Focus

- Malformed, hostile markup, or oversized owner text: reject or truncate according to the documented bounds, render as inert text, and keep the page responsive.
- Duplicate communication/event IDs: show one item and retain ordering without duplicating transcript entries.
- Viewer history file missing, truncated, corrupt, or at the byte/count cap: start safely or retain the newest valid entries without losing service operation.
- Paused, sleeping, offline, and stale status: show the correct state and keep prior history visible.
- Host relay acknowledgements removing transient guest audit events: the separate viewer history must retain the displayed event after acknowledgement and restart.

---

### Task 1: Add bounded persistent viewer history

**Files:**
- Create: `scripts/junction-world/viewer_history.py`
- Create: `scripts/junction-world/test_viewer_history.py`
- Modify: `scripts/junction-world/world-service.py`
- Modify: `scripts/junction-world/test_runtime_source.py`

**Interfaces:**
- Add `ViewerHistory(path, max_items=200, max_bytes=512 * 1024)` with `append(event)`, `snapshot()`, and atomic persistence.
- `append(event)` accepts only already validated guest audit events or validated `/v1/messages` payloads and stores an allowlisted display record. Records have `id`, `occurredAt`, `category`, `summary`, optional `communicationId`, `conversationId`, `communicationDirection`, bounded `message`, and optional `actionStatus`/`durationMs`/sanitized `resources`.
- `snapshot()` returns records oldest-first for the UI and no control or inference data.
- Store history at `/var/lib/junction-world/viewer-history.json`, mode `0600`, root-owned. Write via a unique temporary file in the same directory and `os.replace`.

- [ ] **Step 1: Add source-level checks for bounds, persistence, and sanitization**

Add direct `unittest` checks for `ViewerHistory` plus source checks for the guest-service wiring. The guest service cannot be imported on Windows CI because it depends on Linux-only `grp`, `pwd`, and fixed `/var/lib` paths, so put the portable history implementation in `viewer_history.py` and test its actual file persistence, deduplication, bounds, and allowlist behavior directly.

Run: `python scripts/junction-world/test_runtime_source.py -v`

Expected: FAIL because viewer history and its caps do not exist yet.

- [ ] **Step 2: Implement bounded, atomic `ViewerHistory` storage**

Initialize history from a separate file so existing `service-state.json` schema and audit acknowledgements stay unchanged. On load, ignore invalid records, deduplicate by ID, and keep newest records fitting both limits. On append, make a new owner-to-agent display record from `/v1/messages` content or select only display-safe fields from an audit record. For non-communication events, retain summary, timestamp, category, and safe status/resource metrics; do not retain `details`. For `COMMUNICATION`, retain only the validated bounded message text and direction. Trim oldest entries until both caps fit, then atomically replace the state file.

- [ ] **Step 3: Capture owner and guest events before transient acknowledgement**

Instantiate one `ViewerHistory` in `State`. In the `/v1/messages` path, append a deduplicated `OWNER_TO_AGENT` record before persisting/starting the wake. In the Unix RPC `audit` operation, validate the event first, append the display-safe copy, then append the original transient event exactly as today. If history storage fails, log a bounded service error and preserve existing message/audit behavior rather than losing the Android queue or changing control state.

- [ ] **Step 4: Run the focused runtime source checks**

Run: `python -m unittest discover -s scripts/junction-world -p 'test_*.py' -v`

Expected: PASS, including duplicate IDs, bounded recovery, allowlisted fields, and safe text preservation.

---

### Task 2: Serve a read-only snapshot and static viewer page

**Files:**
- Create: `scripts/junction-world/viewer/index.html`
- Create: `scripts/junction-world/viewer/viewer.css`
- Create: `scripts/junction-world/viewer/viewer.js`
- Create: `scripts/junction-world/viewer_http.py`
- Create: `scripts/junction-world/test_viewer_http.py`
- Modify: `scripts/junction-world/world-service.py`
- Modify: `scripts/junction-world/test_runtime_source.py`

**Interfaces:**
- `GET /ui` returns the static page; `GET /ui.css` and `GET /ui.js` return its fixed static assets. All set `Content-Type`, `Content-Length`, and `Cache-Control: no-store`.
- `GET /v1/ui/snapshot` returns only `{ "paused": bool, "heartbeatMinutes": int, "updatedAt": timestamp, "events": [...] }` from `ViewerHistory.snapshot()`.
- The viewer is served on a separate guest-loopback-only listener at `127.0.0.1:43131`, with no Windows NAT forward. It cannot mutate host lease, pause/resume state, messages, or audit acknowledgements.

- [ ] **Step 1: Specify endpoint behavior with source checks**

Add checks that the HTTP route table exposes only `/ui`, `/ui.css`, `/ui.js`, and `/v1/ui/snapshot` for this feature, that snapshot JSON contains only the five named keys, that responses set no-store headers, and that these GET routes do not call `apply_control`, `request_wake`, `acknowledge`, or mutate state. Keep response building in portable `viewer_http.py` so loopback HTTP behavior can be exercised on Windows CI.

Run: `python -m unittest discover -s scripts/junction-world -p 'test_*.py' -v`

Expected: FAIL until routes and assets are present.

- [ ] **Step 2: Add responsive, accessible conversation markup and styling**

Build a single-page layout with a clear “Junction World” title, a status label, a chronological conversation, and a recent activity list. Use semantic headings, readable contrast, visible keyboard focus, and a narrow-screen layout. Include a “last updated” time and “history is limited” note. No message composer or autonomy controls.

- [ ] **Step 3: Add safe same-origin polling and text rendering**

Fetch `/v1/ui/snapshot` immediately, then every 3 seconds while the document is visible. Use `textContent`/text nodes for every server value; do not use `innerHTML`. Render communication records as chat entries, and non-communication records as activity cards with category, summary, timestamp, and allowed action status. Keep existing rendered history on fetch failure, mark status stale/offline after 15 seconds without a successful fetch, and stop polling while the page is hidden.

- [ ] **Step 4: Add fixed routes and read-only response validation**

Serve `/ui` from the root-owned static asset directory using exact route matching; serve `/v1/ui/snapshot` from the bounded store and current control status. Return 404 for other paths. Validate snapshot size before writing, set `Cache-Control: no-store`, and never serialize `STATE.value` or the service inference queue wholesale.

- [ ] **Step 5: Run focused static and endpoint checks**

Run: `python -m unittest discover -s scripts/junction-world -p 'test_*.py' -v`

Expected: PASS for route allowlisting, response schema, no-store headers, and safe DOM rendering. `test_viewer_http.py` runs the response helper through an ephemeral loopback HTTP server and confirms `GET /ui` and `GET /v1/ui/snapshot` return 200 while `POST /v1/ui/snapshot` and unknown paths return 404.

---

### Task 3: Add guest installation and desktop launcher

**Files:**
- Create: `scripts/junction-world/open-viewer.sh`
- Create: `scripts/junction-world/junction-world-viewer.desktop`
- Create: `scripts/junction-world/update-guest-viewer.sh`
- Modify: `scripts/junction-world/harden-guest.sh`
- Modify: `scripts/windows/New-JunctionWorldProvisioningIso.ps1`

**Interfaces:**
- Install `viewer_history.py`, `viewer_http.py`, and static assets under `/usr/lib/junction-world/`; launcher under `/usr/local/bin/junction-world-viewer`; `.desktop` entry under `/usr/share/applications/`.
- `update-guest-viewer.sh` validates the ISO manifest and updates only the guest viewer/service files, then restarts only `junction-world.service`. It does not reload/restart nftables or modify VirtualBox settings.
- Launcher opens `http://127.0.0.1:43131/ui` in a supported installed browser using a normal new window. Prefer Firefox `--new-window` or Chromium `--new-window`; never use kiosk mode, `--no-sandbox`, global hotkeys, or root browser execution.
- The provisioning ISO includes every new file in `SHA256SUMS`; `INSTALL.txt` explains the menu launcher and browser prerequisite.

- [ ] **Step 1: Add static install source checks**

Extend source checks to verify `harden-guest.sh` installs the viewer modules and static assets root-owned/read-only, the system `.desktop` launcher has `Terminal=false` and the intended command, browser launch does not request kiosk mode or disable sandboxing, the updater verifies `SHA256SUMS` and restarts only Junction, and the ISO builder includes each source file in its staged copy list before generating `SHA256SUMS`.

Run: `python -m unittest discover -s scripts/junction-world -p 'test_*.py' -v`

Expected: FAIL because the launcher and asset install entries do not exist yet.

- [ ] **Step 2: Implement a guarded browser launcher and application entry**

Create a POSIX shell launcher that checks `firefox-esr`, `firefox`, `chromium`, and `chromium-browser` in that order and starts the first installed browser as the signed-in desktop user in a normal new window. If no supported browser exists, print a short actionable error and exit nonzero; do not install packages or change firewall egress. Add a system `.desktop` entry named `Junction World` with a stable icon name, no terminal, and the launcher path.

- [ ] **Step 3: Install page, launcher, and menu entry as root-owned files**

Extend `harden-guest.sh` to install `viewer_history.py` and `viewer_http.py` under `/usr/lib/junction-world/` with mode `0644`, HTML/CSS/JS into `/usr/lib/junction-world/viewer/` with mode `0644`, launcher into `/usr/local/bin/` with mode `0755`, and `.desktop` file into `/usr/share/applications/` with mode `0644`. Add `update-guest-viewer.sh` to verify the media manifest, perform the same viewer file installation, back up the current guest service file, and restart only `junction-world.service`. Do not alter USB, desktop input, firewall, NAT, or port-forward configuration. During VM rollout, first inspect installed browsers from the Debian console; if none is suitable, stop for approval of the smallest signed package route.

- [ ] **Step 4: Include files and usage instructions in the provisioning ISO**

Update the ISO builder’s copy list to stage `viewer_history.py`, `viewer_http.py`, `open-viewer.sh`, `update-guest-viewer.sh`, `junction-world-viewer.desktop`, and the complete `viewer/` directory. Change manifest generation to recurse through the staging tree and write paths relative to that tree so every nested viewer asset is covered. Add instructions to the generated `INSTALL.txt`: verify the manifest; pause Junction from Android Audit; run the viewer updater as root; sign into the normal Debian desktop; launch Junction World from the Applications menu; use Android Audit for messages and controls.

- [ ] **Step 5: Build the provisioning ISO and verify its manifest**

Run: `./scripts/windows/New-JunctionWorldProvisioningIso.ps1`

Expected: a rebuilt `artifacts/junction-world-provisioning.iso`; mount/read its staged source or verify the script’s staging contents and confirm each included file hash matches the generated `SHA256SUMS`. Do not change the VirtualBox USB configuration.

---

### Task 4: Deploy to the current VM and verify the full conversation flow

**Files:**
- Modify inside VM: `/usr/lib/junction-world/world-service.py`, `/usr/lib/junction-world/viewer/*`, `/usr/local/bin/junction-world-viewer`, `/usr/share/applications/junction-world-viewer.desktop`
- Persistent viewer data: `/var/lib/junction-world/viewer-history.json`
- Runtime check: existing `junction-world.service`, existing loopback NAT rule, Android Audit screen

**Interfaces:**
- Deployment reads the rebuilt provisioning media from the Debian console using root and updates only guest runtime/viewer files.
- Existing host relay, Android package, NAT forward, guest firewall, USB devices, and host Ollama configuration are unchanged.

- [ ] **Step 1: Stage update media and verify its manifest in Debian**

From the signed-in Debian console, mount the provisioning optical disc read-only and confirm a supported graphical browser is already installed. Pause Junction from Android Audit, then run `update-guest-viewer.sh` as root; the script verifies `SHA256SUMS` itself and stops before installation if any file fails verification.

- [ ] **Step 2: Update the guest service and viewer files**

The updater backs up every replaced service/helper/viewer/launcher/menu file, installs only the verified files with the exact ownership and modes from Task 3, and restores the prior file set if installation or restart fails. It initializes history only if it is absent. It does not run `harden-guest.sh`, touch nftables, or replace existing history.

- [ ] **Step 3: Restart only the guest Junction service**

Run `systemctl restart junction-world.service` and confirm it is active with `systemctl is-active junction-world.service`. Confirm `junction-world-heartbeat.service` remains inactive unless the host relay explicitly starts it, and confirm the existing `nft list ruleset`, NAT rule, VM USB devices, and guest workspace mount are unchanged.

- [ ] **Step 4: Open the VM viewer and verify live status and input**

From the Debian Applications menu, open “Junction World.” Confirm a normal resizable browser window opens at the local page, status reflects the current host-owned paused/resumed state, and the keyboard can focus browser controls/close the window and the mouse can click and scroll without capture. Do not attach the wireless receiver to the VM.

- [ ] **Step 5: Verify Android-to-VM conversation and bounded restart persistence**

From the paired Android Audit tab, send one harmless status prompt. Confirm the guest viewer displays the owner message, Junction reply, and wake/sleep activity; confirm Android Audit still shows the corresponding events and retains pause/resume controls. Restart only the Junction service, reopen/refresh the viewer, and confirm the bounded transcript remains. Verify the viewer has no message composer and no buttons capable of changing autonomy.

---

## Self-review

- **Spec coverage:** Bounded history and capture-before-ack are Task 1; status/activity/message UI and safe polling are Task 2; input-safe desktop launcher and no-new-network installation are Task 3; current VM deployment, persistence, and Android/keyboard/mouse acceptance checks are Task 4.
- **Placeholder scan:** No TBD/TODO steps. Browser absence explicitly stops deployment and requires a separate approval, as the spec says.
- **Interface consistency:** The history location, limits, endpoint paths, response fields, launcher names, install paths, and VM service name are consistent in all tasks.
- **Review focus coverage:** Hostile/oversized text and duplicate IDs are Task 1; malformed/corrupt/over-cap history is Task 1; paused/stale UI is Task 2; host acknowledgement persistence is Tasks 1 and 4.
- **Scope:** This is one guest viewer subsystem. Windows relay protocol and Android app remain unchanged.
