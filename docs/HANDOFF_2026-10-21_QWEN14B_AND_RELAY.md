# Handoff — qwen3:14b reachability, verbose telemetry, hostel-Wi-Fi transport

Date: 21 October 2026
Branch: `feat/nethra-durable-agent` (uncommitted working tree, inherited work preserved)
Scope: the reported "Junction can't talk to qwen 14b" fault on PC and phone, plus the
requested verbose telemetry footer. Written so the next agent can continue without
re-deriving the diagnosis.

---

## 1. Root causes (evidence, not inference)

### 1.1 PC side — Junction was never the fault

Junction's `LocalAgentRuntime` talks to `qwen3:14b` correctly. A reproduction harness
(`artifacts/repro-qwen14b-runtime.cjs`) drives the real runtime against the live Ollama
host and passes 7/7: `/api/ps` reachable, capability probe reports `thinking`,
non-streaming chat, streaming chat, native `tool_calls`, thinking-mode streaming, and a
full agent loop with tool execution.

The `CUDA error: the function failed to launch on the GPU` was **host resource
exhaustion**, recorded in `%LOCALAPPDATA%/Ollama/server.log` at 21:48–21:51:

1. `llama-server GPU discovery watchdog timed out` → `failure during llama-server GPU discovery`.
2. `unable to refresh free memory, using old values` → Ollama fell back to a **stale**
   VRAM reading (`available=10.5 GiB`, taken at 21:30 startup).
3. On that stale figure it attempted a full offload: `cudaMalloc failed: out of memory`
   for an 8832650240-byte (8.23 GiB) CUDA0 buffer.
4. The CPU fallback then failed too — the host has 11.9 GiB RAM with only 2.8–3.0 GiB
   free — `failed to allocate CUDA_Host buffer of size 2725530624`.
5. The runner finally crashed: `CUDA error: the function failed to launch on the GPU`,
   `exit.hex=0xc0000409`.

The OOM blob `sha256-a8cc1361…` maps to `manifests/.../qwen3/14b`, so it was the 14B
load itself failing, not the 30B. Note `OLLAMA_MODELS` is `C:\Users\jf358`, not the
default path.

Contributing host state: ~12 GiB RAM shared with ChatGPT/Codex, two Claude desktop
processes, Steam, a Junction Electron runtime and Video.UI. `qwen3:30b` (18 GB) is also
pulled and cannot fit this 12 GiB RTX 2060 — `test/model-retirement.test.js` already
asserts Junction never requests it, so it is a manual pull, not a product path.

**This is environmental and will recur under memory pressure.** Junction now degrades
honestly instead of surfacing a raw CUDA string (§2.1).

### 1.2 Phone side — the hostel AP isolates clients (proven)

Previous sessions could not decide between client isolation and a non-listening host.
That is now settled, with the host confirmed listening throughout:

| Test | Result |
| --- | --- |
| Phone → PC `10.164.57.103:43111` (listener confirmed up) | `curl` exit 7, no connect |
| PC → phone `10.164.57.104:45999` (toybox `nc` listener) | TCP connect false |
| PC → phone `10.164.57.104:5555` (**system ADB daemon**, `ss` confirmed `LISTEN *:5555`) | timeout, twice |
| **Control:** PC → same phone listener over USB `adb forward` | connects in 0.8 ms |

Both devices sit on `10.164.57.0/24` with correct routes. The control test proves the
phone's listener works; only the Wi-Fi path fails, in **both** directions, including to a
system service. **The access point drops client-to-client traffic.**

Consequence: **no firewall rule can fix this network.** The LAN transport is unusable on
hostel Wi-Fi by design of the AP. An encrypted overlay (Tailscale) is the only route.

Reproduced live on the device — the app shows:
> "Error: Your paired Junction PC was not reachable on this Wi-Fi network. Open Junction on the PC."

### 1.3 Two further defects found

- **No Windows firewall rule for Junction exists at all**, and the Wi-Fi adapter is on the
  **Public** profile with `DefaultInboundAction: NotConfigured` (= block). Independent of
  AP isolation, this would block the phone on any network. Needs an admin shell (§5).
- **Junction bound a listener on every private interface**, including the untrusted
  hostel LAN. Fixed in §2.3.

---

## 2. Changes made

All changes are in the working tree, untested code was not left behind, and no existing
files were discarded.

### 2.1 Structured host-memory failure handling — `src/local-agent-runtime.js`

- `isResourceFailure()` / `resourceFailureMessage()` classify `cudaMalloc`, OOM,
  `failed/unable to allocate`, `CUDA error`, `failed to launch`, insufficient-driver and
  `llama-server terminated` strings.
- `chat()` now wraps `chatOnce()`. On a classified resource failure it performs **exactly
  one** recovery: release every resident runner (so Ollama re-reads free VRAM) and retry
  once. A second failure is reported, never retried — an exhausted host cannot loop.
- Aborts and timeouts are never converted into memory errors and never spend the retry.
- Ordinary model errors are passed through unchanged and unreworded.
- `prepareModel()` refactored onto a reusable `releaseResidentModels(signal, keepModel)`.

### 2.2 Verbose telemetry footer (the requested feature)

Generation speed is computed from Ollama's own `eval_duration`, **not** Junction's wall
clock, so tool execution and queue waiting cannot inflate it. Live proof: the eval-based
rate held at 30.0–30.8 tok/s across runs (matching the documented 30.46–30.78 baseline)
while the naive wall-clock rate swung 16.9 → 38.5.

- `newTimings()` / `addTimings()` / `modelMetrics()` accumulate `eval_count`,
  `eval_duration`, `prompt_eval_duration`, `load_duration` across **every** model call in
  a run (routing, agent loop, synthesis), returned as `result.metrics`.
- Unmeasured speed yields `null` and is **omitted** from the footer rather than shown as
  zero.
- Windows: `renderer/message-format.js` gained `telemetryLine()` (dual module/global, so
  it is unit-testable); `renderer/parity.js` renders it under assistant replies and adds a
  **Verbose** toggle beside "Force research"; `renderer/agent-ui.css` styles `.telemetry`.
- Persistence: `local-data.js addMessage()` takes an optional telemetry object
  (local-only; deliberately **not** part of the shared message contract, so it never
  syncs); `main.js` builds it via `messageTelemetry()`.
- Setting: `verbose` added to `nethra-store.js` defaults/allowlist/boolean validation and
  to the `nethra.settings` allowlist in `nethra-api.js`. Because it rides the existing
  Nethra settings API it is shared by both UIs.
- Android: `chat.complete` now carries a `telemetry` object (metrics only — no reasoning
  text, prompt content or host paths). New `assistant/provider/HostTelemetry.kt` formats
  it identically to Windows; `LlmEvent.TextDone` gained `telemetry`;
  `LanFirstJunctionPcProvider` populates both it and the previously-unused
  `tokensPerSecond`; `ChatManager` persists it; `ChatScreen` renders it, falling back to
  the old short "tokens/s" label for providers without full metrics.
- Room: `chat_messages.telemetry TEXT`, DB **23 → 24**, `MIGRATION_23_24` registered.

Live footer from `qwen3:14b`:

```
qwen3:14b · 30.1 tok/s · 491 out · 2,114 in · 17.9s total · 0.01s model load ·
16.3s generating · 3 model calls · 1 tool (read_build_manifest) · 1,249 thinking chars
```

**Bug found and fixed during verification:** the run clock started *after* the intent
routing call, so a cold load billed to routing appeared in `loadMs` while being excluded
from `durationMs` — producing a self-contradictory `2.41s total · 30.5s model load`.
`started` now covers the whole run. Regression test added.

### 2.3 Secure transport on an untrusted network — `src/lan-server.js`, `src/lan-relay-lifecycle.js`

- `PRIVATE_IPV4` previously accepted only RFC1918, so Junction **could not bind the
  Tailscale interface at all**. It now also accepts `100.64.0.0/10` (CGNAT, Tailscale's
  range) via `TAILSCALE_IPV4`.
- `selectPrivateIPv4()` prefers the overlay address, and is deterministic (sorted) rather
  than dependent on OS interface enumeration order.
- **New `preferredBindAddresses()`**: when an overlay interface exists, bind **only** the
  overlay — the owner-only API is no longer offered on the untrusted shared LAN.
  Without an overlay it falls back to the physical private LAN, so a trusted home
  network keeps working. `LanRelayLifecycle` now defaults to this.
- Verified on this host: `preferredBindAddresses()` → `['100.95.8.42']` only, where it
  previously bound `10.164.57.103` and `192.168.56.1`.
- Android needs no change: `LanTls` pins the leaf **public key** SHA-256 and deliberately
  ignores hostname ("USB, DHCP, or VPN"), and `lanCandidates` does not filter by address
  range, so an overlay address in the pairing payload works as-is.

Ollama itself remains loopback-only (`OLLAMA_HOST: http://127.0.0.1:11434`) — it is not
exposed to the network, as required.

---

## 3. Test results

| Suite | Result |
| --- | --- |
| Windows `npm test` | **95 pass / 0 fail**, exit 0 (was 75 in the final group; 20 new) |
| Android `:app:testDebugUnitTest` | **166 pass / 0 fail** across 29 suites |
| Live runtime repro vs real `qwen3:14b` | **7/7** |
| Live telemetry verification | both thinking-off and thinking-on runs, real tool calls |
| Android install + launch on SM_A528B | clean, no fatal exception |
| Room 23 → 24 on real device data | `user_version: 24`, column present, **77 messages preserved** |

New test files: `test/model-telemetry.test.js` (13), `test/lan-bind-overlay.test.js` (7),
`apps/android/.../HostTelemetryTest.kt` (7). All wired into `package.json`.

Live artifacts: `artifacts/repro-qwen14b-runtime.{cjs,json}`,
`artifacts/verify-telemetry-live.{cjs,json}`.

### Verification honesty

- Live-verified against real hardware: PC inference, tool calls, thinking mode, telemetry
  numbers, Android build/install/launch, the Room migration, and all four network tests.
- **Not verified:** any phone↔PC Junction traffic. It is impossible on this Wi-Fi (§1.2)
  and the phone is not yet in the tailnet. The telemetry footer is therefore verified on
  Windows end-to-end, but on Android only by unit test plus a clean install — **its
  on-device rendering has never displayed a real host payload.**
- The packaged Electron runtime was **not** rebuilt. The running desktop app
  (`dist/nethra-agent-win-ui-fixed`) still predates every change here.

---

## 4. What GPT should pick up next, in priority order

1. **Join the phone to Tailscale** (user action, §5), then re-pair and run the first real
   cross-device test. This unblocks everything below.
2. **Rebuild and relaunch the packaged Windows runtime** so the desktop app actually
   contains these changes — `npm run pack:workspace` then `npm run desktop`, per
   `apps/windows/AGENTS.md`. Until then the running app has none of this.
3. **Confirm the Android telemetry footer with a real payload** once the phone can reach
   the host. This is the one deliverable with no on-device proof.
4. **Add the firewall rule** (§5) — needed for any non-isolated network, useless on this one.
5. **Consider a manual-host UI field.** `lanCandidates` already supports `manualHost`, read
   from `KeyStorage.getSecret("lan_manual_host_v1")`, but **nothing writes it**. Exposing it
   would allow a USB `adb reverse` fallback and aid debugging. Note `adb reverse` alone is
   insufficient: the host binds a specific interface, not `127.0.0.1`, so it would also need
   a small loopback relay.
6. **Observation, not yet a filed defect:** with a local tool available, the intent router
   sometimes still forces `web_search` (seen in the live telemetry run, where
   `read_build_manifest` existed but `web_search` was called). Worth checking whether
   `detectSearchRequirement` over-triggers.

Nothing in `docs/NETHRA_DELIVERY.md`'s outstanding list (durable child records, external
action adapters, notifications, shell sandbox, broader memory/permission UI) was addressed
here.

---

## 5. Setup instructions

### Tailscale (the actual fix for hostel Wi-Fi)

The PC is already signed in as `jf358950@` with Tailscale IP `100.95.8.42`
(`BackendState: Running`). The tailnet currently holds only `JamesPC` and a Linux node
`ai` — **the phone is missing.**

1. Install **Tailscale** from Google Play on the SM_A528B.
2. Sign in with the **same account** (`jf358950@`).
3. Confirm the phone appears in `tailscale status` on the PC.
4. Rebuild/relaunch Junction (§4.2). It will bind `100.95.8.42` **only**.
5. Re-pair the phone from Settings → "Pair Android over LAN". The QR carries the overlay
   address and the certificate pin, and Android's pinning ignores hostname, so it works.

Traffic then runs inside WireGuard, so the hostel network sees only encrypted packets and
AP client isolation is bypassed entirely.

### Windows firewall rule (needs an elevated PowerShell)

Scope it to the **overlay**, not the hostel subnet:

```powershell
New-NetFirewallRule -DisplayName "Junction LAN API (Tailscale)" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 43111 -RemoteAddress 100.64.0.0/10 -Profile Any
```

Do **not** open 43111 to `10.164.57.0/24`. That is the untrusted hostel subnet, the rule
would not help there anyway (§1.2), and it would expose the API on any future network
where isolation is off.

### If the 14B model fails to load again

Check `ollama ps` — expected placement is `100% GPU` at context 4096, ~9.7 GB resident.
Then check `%LOCALAPPDATA%/Ollama/server.log` for `GPU discovery watchdog timed out` or
`unable to refresh free memory`. Recovery is to free system RAM (close ChatGPT/Claude
desktop/Steam) and restart Ollama so it re-reads VRAM. Do **not** extend Junction's
deadlines or raise context — neither is the cause.

### Android builds

Build with an explicit version code above the CI build, and never install with `-d`:

```
./gradlew :app:assembleDebug -PJUNCTION_VERSION_CODE=100149
adb install -r apps/android/build/outputs/apk/debug/app-debug.apk
```

The default debug `versionCode` is `100000`, which is **below** CI's `100147` and causes
`INSTALL_FAILED_VERSION_DOWNGRADE`. Currently installed: **100148**
(`7e3f328b8937948b20e7d9140c48ed71b29d0f89661b1e5caf050f56fdb1a905`).

---

## 6. Status classification

| Feature | Status |
| --- | --- |
| PC ↔ qwen3:14b inference, tools, thinking | WORKING AND VERIFIED (live) |
| Host-memory failure classification + bounded retry | WORKING AND VERIFIED (unit); live recurrence not reproduced on demand |
| Verbose telemetry footer — Windows | WORKING AND VERIFIED (live) |
| Verbose telemetry footer — Android | IMPLEMENTED BUT UNVERIFIED (no real payload yet) |
| Overlay-only bind / Tailscale support | IMPLEMENTED BUT UNVERIFIED end-to-end (correct address selected on host; no phone in tailnet) |
| Phone ↔ PC transport on hostel Wi-Fi | BLOCKED — AP client isolation, not fixable in software |
| Packaged Windows runtime carrying these changes | NOT IMPLEMENTED (not rebuilt) |
| Windows firewall rule | BLOCKED — needs elevation |
