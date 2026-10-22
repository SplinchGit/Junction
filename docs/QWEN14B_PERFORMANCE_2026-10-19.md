# Qwen3 14B timeout investigation

## Findings

The actual failed request is recorded in `%LOCALAPPDATA%/Ollama/server-1.log`:

- At 23:21:37 local time CUDA reported `CUDA driver version is insufficient for CUDA runtime version`.
- The runner exposed only the CPU and allocated its weights, KV cache and compute buffers in system RAM.
- At 23:24:35 Junction's 180-second per-call deadline cancelled the still-loading runner. Ollama returned HTTP 499 after about three minutes.

This establishes the failed CUDA initialisation and CPU fallback as the cause of that timeout. It does not establish why CUDA failed on that particular load. Later loads in the same installed version successfully used CUDA. The current NVIDIA driver (576.28) exceeds Ollama's documented 550 minimum for this GPU; the message alone does not prove an unsupported driver installation.

Hardware: i7-6700K, approximately 12 GB system RAM, RTX 2060 with 12 GB VRAM. Qwen3 14B is Q4_K_M. Successful loads offload all 41 layers to the GPU, using approximately 9.6 GB with a 4096-token context. Thinking is explicitly off in ordinary Junction requests. Ollama runs one parallel request. No smaller model or larger context is needed to explain the observed failure.

## Measured baseline

Same prompt, `think:false`, 4096 context, 150 output-token budget:

| Request | Total | Model load | Generation speed |
| --- | ---: | ---: | ---: |
| Cold | 31.571 s | 28.324 s | 30.46 tokens/s |
| Warm | 2.990 s | 0.012 s | 30.78 tokens/s |

Evidence: `artifacts/qwen14b-latency-before.json`.

The real Windows renderer/preload/IPC test initially received zero streaming updates before completion (4.853 s). The runtime already supported streaming, but the desktop IPC handler did not pass its progress callback.

## Changes

- Connected local desktop progress text to the existing `junction:chat-stream` renderer channel.
- Changed local-agent residency from 5 minutes to 30 minutes. Applied the same residency to World inference so it does not reset the shared model's expiry to the short default.
- Retained thinking-off, 4096 context, existing request deadlines, cancellation, tools, and model selection.
- Added `apps/windows/scripts/local-latency-smoke.js`, a live Electron test with disposable user data and background LAN/World relays disabled. Run it with Electron from `apps/windows`; it uses real local inference and checks that text renders before completion.

Ollama's supported `keep_alive` control is documented at https://docs.ollama.com/faq. GPU requirements are at https://docs.ollama.com/gpu and GPU discovery guidance at https://docs.ollama.com/troubleshooting.

## Verification and deployment

- New live desktop streaming test failed before the fix and passed afterwards: first text 154 ms, 122 updates, text rendered before completion, total 4.480 s.
- Live agent research passed: Python 3.13.0 release date correctly answered with a valid source citation in 17.218 s. Evidence: `artifacts/qwen14b-research-verified.log`.
- Full Windows `npm test` passed, including LAN, relay, local-agent, World and foreman tests. Log: `artifacts/qwen14b-windows-tests.log`.
- Built `apps/windows/dist/qwen14b-performance-win-unpacked`. Verified all three changed inference source files in `app.asar` exactly match tested workspace files.
- Closed the old app gracefully, regenerated Desktop/Junction.lnk and launched it. Verified the new runtime owns a visible Junction window and both authenticated LAN listeners on port 43111.
- Installed the already-downloaded, validly signed Ollama Inc. 0.40.6 update over 0.40.2. Installer returned 0 and reported no Windows restart required. The release includes a Windows orphaned-runner fix: https://github.com/ollama/ollama/releases/tag/v0.40.6. This is a runtime maintenance improvement, not proof of a fix for the specific intermittent CUDA error.
- After updating, a fresh live desktop load passed in 34.551 s (first text 30.421 s). Warm follow-up passed in 4.259 s, with first text at 125 ms and 119 updates. Evidence: `artifacts/qwen14b-desktop-latency-after-update-cold.json` and `artifacts/qwen14b-desktop-latency.json`.
- Repeated real web research on 0.40.6: correct Python release date and valid citation in 5.632 s. Evidence: `artifacts/qwen14b-after-update-research.json`.
- Final `ollama ps`: 100% GPU, context 4096, approximately 9.7 GB resident, expiry 29 minutes away. Left the model warm and the rebuilt Junction app open.

Directly requiring packaged/extracted main.js from the development Electron smoke harness failed because development companion-module lookup assumes the source directory layout. This was a harness path issue; the normally launched packaged application starts successfully. The live renderer test above uses the source runtime; packaged verification uses archive identity and normal desktop launch.

## Limits

A true cold load still takes around 30 seconds. Thirty-minute residency reduces repeated loads but does not remove the first load after reboot or expiry. Residency retains approximately 9.6 GB of GPU memory until expiry or explicit unload. A phone round trip was not tested in this investigation. The initiating cause of the intermittent CUDA failure remains unproven; successful GPU tests cannot establish that it will never recur.

Automatic approval review blocked cleanup of the temporary `apps/windows/dist/qwen14b-smoke-extracted` folder with the reason `blocked by policy`; it was left in place.

If the severe slowdown returns, check `ollama ps`: the expected placement is `100% GPU` at context 4096. Inspect the latest server log for CUDA discovery errors. Restarting Ollama is a recovery step; if failures persist, investigate the NVIDIA driver/runtime rather than extending Junction's deadlines or increasing context.
