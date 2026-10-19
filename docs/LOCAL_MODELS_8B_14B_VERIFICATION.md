# Qwen3 8B and 14B integration verification

Verified 19 October 2026.

## Current setup: 14B only

The follow-up setup replaces the original multi-model configuration described below:

- Qwen3 14B is the only local catalog entry and the default on Windows and Android. Deleted selections migrate to 14B. The PC normalizes older phone requests on both LAN and encrypted relay transports, so a stale phone model ID does not request missing weights.
- The owner's saved Windows provider is `local` / `qwen3:14b`. Rebuilt packaged Junction is launched through Desktop/Junction.lnk with authenticated LAN listeners active.
- Junction World's fixed host inference model is also 14B, with a 4K context budget. This does not deploy guest scripts or alter the guest's permissions.
- Fixed evidence ranking: generic instruction/tool/citation words no longer displace factual passages in the compact model context. The real Python release-date research smoke now passes, returning the expected date with valid citation in about 34 seconds.
- Native structured tool smoke passes: 14B requested `get_weather(London)` and used the supplied fixture result in its final answer. Both warm inference turns completed in about 1.9 seconds on the RTX 2060; this fixture is not a live weather lookup.
- Real Electron renderer/preload/IPC smoke passes: retired selection becomes 14B, only 14B appears in the picker, a real local response is returned and rendered. Evidence: `artifacts/junction-14b-ui.json` and `junction-14b-ui.png`.
- Full Windows test suite passes. Android unit tests pass: 152 tests, zero failures/errors after integrating the latest provider and credential isolation changes from main. The local APK uses version code 100138; the publishing workflow assigns the release its next build number.
- Both Nemotron routes are retained: direct NVIDIA with its own credential and NVIDIA via OpenRouter with the OpenRouter credential. Only the local Ollama catalog is restricted to 14B.
- APK: `apps/android/build/outputs/apk/debug/app-debug.apk`. No phone is attached to ADB; no handset installation or live phone round trip was performed. Changes remain local and are not published to the remote update channel.

## Integration

- Added installed `qwen3:8b` and `qwen3:14b` to Windows and Android Local LLM selectors.
- Windows persisted selections retain both model IDs across store reopen.
- Existing desktop, paired LAN, and selected encrypted relay paths pass the selected ID to the PC LocalAgentRuntime. Native tool handling, serialization, and the 4K context budget are unchanged.
- Existing smaller default and pre-existing 30B Windows entry are preserved.

## Passing checks

- Full Windows `npm test`: exit 0, including model persistence, local agent runtime, LAN, mobile relay, and foreman tests.
- Android `:app:testDebugUnitTest :app:assembleDebug`: exit 0; 143 tests across 24 suites, zero failures/errors.
- First Android build exhausted native memory. Retry used command-local `-Dorg.gradle.jvmargs=-Xmx1280m -XX:ActiveProcessorCount=2 -Dfile.encoding=UTF-8` and `-Pkotlin.compiler.execution.strategy=in-process`; no repository build settings changed.
- Windows `npm run pack:workspace` with `JUNCTION_PACK_OUTPUT=local-models-win-unpacked`: exit 0.
- Generated Desktop/Junction.lnk and launched the full packaged runtime. Junction window observed; paired LAN listener active on port 43111.
- Independent static code review found no model routing blocker. Corrected documentation to describe encrypted relay as an alternative connection mode, not automatic fallback.

## Live inference blocker

Ran `scripts/junction-agent-smoke.js <model> post2023_python` once for each model.
Both requests successfully executed host-enforced `web_search`, returning five sources, then failed loading the model:

- 8B: CUDA allocation of 4,869,357,568 bytes failed.
- 14B: CUDA allocation of 8,832,650,240 bytes failed.

Reports are in `apps/windows/test-results/junction-agent-qwen3-8b-post2023_python.json` and `junction-agent-qwen3-14b-post2023_python.json`.

The RTX 2060 reports 12 GB VRAM, with approximately 11.7 GB free when idle. Windows has approximately 12 GB RAM, a 2.3 GB paging file, and only about 200 MB free on C:. Host memory/commit pressure is a likely contributor; the precise CUDA failure cause remains unproven. An isolated 8B probe with `use_mmap=true` also failed; no inference option changes were retained.

An attempted cleanup of `apps/android/build/intermediates` was rejected by automatic approval review. No cleanup was performed. Reclaim disk space before retrying; successful live inference is not yet verified.

## Deliverables and phone limitation

- Windows runtime: `apps/windows/dist/local-models-win-unpacked/Junction.exe`, launched through Desktop/Junction.lnk. Keep the entire runtime directory.
- Android APK: `apps/android/build/outputs/apk/debug/app-debug.apk`.
- No ADB device was connected, so the APK was not installed and no live handset request was verified. Android source changes are local and have not been published through the remote update channel.

## Follow-up: retain only 14B

At the owner's request, removed all installed Ollama tags except `qwen3:14b`, including both aliases of LFM2.5. `ollama list` confirms only 14B remains. This recovered approximately 14.4 GB; C: had about 14.0 GB free after the subsequent inference test.

Retried the 14B agent smoke after deletion. Windows temporarily grew its managed paging file from 2.3 GB to approximately 12.7 GB during loading. Model loading and inference now succeed: one web search executed, a cited response returned in about 36 seconds, and no CUDA allocation error occurred. The overall smoke assertion still failed because the response said the supplied evidence lacked the requested exact Python release date. This verifies restored inference, not full factual-answer quality. The report at `apps/windows/test-results/junction-agent-qwen3-14b-post2023_python.json` now records this latest run; the original failure log remains in `artifacts/qwen3-14b-agent-smoke.log`.

Catalog entries and defaults were not changed by the deletion request. Other listed models would need reinstalling before use.
