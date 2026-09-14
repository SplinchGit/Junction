# Junction local-LLM agent audit — 2026-09-14

## Outcome

Junction now has a real native Ollama tool loop for Local Agent mode. A model action is executable only when Ollama returns `message.tool_calls`; ordinary text such as “Searching…” is never parsed as an action. Windows and Android Agent mode both enter the same PC-side `LocalAgentRuntime` and central capability registry, while ordinary non-Agent local chat remains a deliberately tool-free direct Ollama path.

The recommended default for this i7-6700K / 12 GB PC is `qwen3.5:2b`. Existing saved selections are preserved and all four models remain selectable.

## Actual wiring

Android Local LLM uses this path:

1. `ChatScreen` supplies the selected provider and model. When the Tools mode contributes the `junction_local_agent` signal, `JunctionPcProvider` writes encrypted `{model,messages,mode:"agent"}` to the paired brain's Firestore command document.
2. The Windows `LocalBrainRelay` polls that command collection, validates the source/client/expiry, leases the command, decrypts it, and calls the injected `runLocalAgent` function for `mode === "agent"`.
3. `main.js` injects the one desktop `LocalAgentRuntime`, backed by one `LocalAgentToolRegistry` and the existing `ResearchCoordinator`/`WebResearchClient`.
4. The runtime sends the selected model, bounded messages, and native tool schemas to Ollama `/api/chat`.
5. Only `message.tool_calls` entries are normalized and validated. The registry executes permitted tools. A tool-role message containing the concise result is appended to the same messages array and the same selected model is called again.
6. The final answer is encrypted into the same Firestore command document. Android decrypts it and emits `TextDone`, which persists the assistant turn.

Yes, there are direct Ollama paths: Android non-Agent Local LLM chat streams through `LocalBrainRelay` directly to `/api/chat`, and Windows non-Agent local chat uses Ollama's OpenAI-compatible loopback endpoint. Those paths have no tools and explicitly instruct the model not to claim tool use. The former custom agent path did reach `LocalAgentRuntime`; its problem was the custom generated-JSON decision protocol, not a missing call into the runtime.

## Before and after

Before, `LocalAgentRuntime` requested generated JSON with actions such as `search`, `finish`, and `ask_owner`, parsed assistant text, and returned search results as user messages. This was brittle with small models and was not Ollama-native tool calling. Separately, ordinary chat could emit plausible “Searching…” prose despite having no executable tool path.

Now, the runtime sends native function schemas under `tools`, accepts only structured `message.tool_calls`, appends the assistant tool-call message and a `{role:"tool",tool_name,content}` result, and repeats. Natural-language claims never trigger execution.

The central registry currently exposes:

- `web_search(query)`: existing bounded public-HTTPS research, including SSRF/private-network checks, DNS pinning, redirect rejection, bounded response/evidence sizes, untrusted-evidence instructions, citation validation, and search-egress validation.
- `delegate_to_codex(task)`: exposed only for an owner goal that explicitly requests Codex/delegation for coding work; limited to one approval-gated existing Codex draft. It does not edit the main checkout or auto-approve work.

## Loop and safety bounds

- 7 model iterations.
- 6 total tool calls.
- 3 web searches.
- 1 Codex delegation.
- One identical request may be executed once; subsequent identical requests are blocked and returned as tool errors.
- 5-minute overall deadline and 120-second per-Ollama-call deadline.
- 6,144-token context, 700 generated tokens per turn, last 10 recent messages at 4,000 characters each, up to 20 concise owner memories, 8,000-character tool-result ceiling.
- Prior bulky search results are compacted after a later search; the newest tool result contains the merged ledger with stable source/passage IDs.
- Malformed, unknown, failed, duplicate, and over-budget tools return structured failure results so the model can recover. Exhausted iterations or empty final output terminate with a clear error.

Windows Stop aborts the run's `AbortController`. Android cancellation writes `cancel_requested`; the PC polls once per second and aborts an in-flight Ollama request. The protected web fetches retain their own short request deadlines.

## Official Ollama behavior used

Implementation follows the current official `/api/chat` and tool-calling contract: request `tools`, inspect `message.tool_calls`, append the assistant call plus a tool-role result, and call the same model again. The runtime uses `keep_alive:"5m"` so sequential iterations reuse the selected loaded model, while Ollama is configured for one parallel request on this PC.

- Ollama chat API: https://docs.ollama.com/api/chat
- Ollama tool calling and multi-turn agent loop: https://docs.ollama.com/capabilities/tool-calling
- Official Qwen 3.5 tags: https://ollama.com/library/qwen3.5/tags
- Official Liquid AI LFM2.5 2.6B release: https://www.liquid.ai/blog/lfm2-5-2-6b
- Official Liquid AI GGUF files and Ollama import command: https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/tree/main

`lfm2.5:2.6b` is not currently an official Ollama-library tag. It is a local alias of Liquid AI's official `LFM2.5-2.6B-GGUF:Q4_K_M`, not a community fine-tune.

## Measured results

Vanilla smoke test used a deterministic `get_weather(city)` function returning London / 17 C / Cloudy. RAM is Ollama `/api/ps` loaded size (CPU only), not whole-system peak. Timings vary with Windows cache and memory pressure.

| Model | Loaded RAM | Prompt eval | Generation | First structured call | Native full cycle |
| --- | ---: | ---: | ---: | ---: | --- |
| `qwen3:1.7b` | ~1.88 GB | 117.7 tok/s | 12.7 tok/s | 8.0 s | PASS; final at 9.6 s |
| `qwen3.5:2b` | ~2.36 GB | 68.8 tok/s | 7.1 tok/s | 14.6 s | PASS; final at 18.5 s |
| `qwen3.5:4b` | ~2.90 GB before failure | 43.1 tok/s | 5.0 tok/s | 24.5 s | FAIL; correct call, then `std::bad_alloc` on result turn |
| `lfm2.5:2.6b` | ~1.82 GB | 69.5 tok/s | 8.9 tok/s | 14.7 s | PASS; final at 22.7 s |

Actual Junction behavior:

| Model | Protected Junction search | Multi-step agent |
| --- | --- | --- |
| `qwen3:1.7b` | Tool execution proved; one-search London run completed, but ignored citation correction | Executed both city searches, then repeated them and ended with the duplicate-block result: task-quality FAIL |
| `qwen3.5:2b` | PASS: London, 1 search / 2 iterations / valid citations / ~37 s | PASS: London then Edinburgh, 2 searches / 3 iterations / valid citations / ~84 s |
| `qwen3.5:4b` | Not viable: second native turn runs out of memory at 4K context | FAIL for this hardware budget |
| `lfm2.5:2.6b` | Real protected searches executed | Performed multiple sequential calls, but repeated searches, hit guards, and produced no final answer before safe termination: task-quality FAIL |

The Burj Khalifa control returned the correct 828 m fact. Both tested Qwen models attempted unnecessary searches; Qwen 3.5 2B's semantic-expansion queries were initially blocked by egress validation and it recovered to answer from knowledge. The egress vocabulary now permits harmless height/measurement and weather synonyms without permitting URLs, IPs, email addresses, secret-like tokens, or ungrounded private terms.

Raw reproducible records are under `apps/windows/test-results/`; harnesses are `scripts/ollama-tool-smoke.js` and `scripts/junction-agent-smoke.js`.

## UI and model swapping

The Windows composer now has a compact in-chat local-model selector plus 34 px Research/Agent controls; Agent Send becomes Stop during a run. Settings actions wrap instead of overflowing. Android Settings lowers the visual minimum to 40 dp for its dense action rows, and the existing in-chat provider dropdown now lists every model rather than silently choosing only each provider's default.

Changing the selection changes only the model string sent to Ollama. The runtime, registry, limits, and tools do not contain Qwen-specific branches.

## Manual Android acceptance tests

1. Start Junction and Ollama on the signed-in PC; confirm the phone shows the paired PC online.
2. In Android Chat, open the provider/model dropdown, choose Local LLM → Qwen 3.5 2B, close/reopen the dropdown, and confirm the selection persists.
3. Enable Agent/Tools. Ask `What's the weather like in London right now?` Confirm activity progresses through the PC and the answer contains current cited sources. On PC Audit, confirm `agent_tool_requested web_search`, `agent_tool_result web_search`, then `agent_final` in order.
4. Disable Agent/Tools and ask the same question. Confirm ordinary chat does not claim it searched and that no web-search audit row appears.
5. With Agent enabled, ask `How tall is the Burj Khalifa?` A direct 828 m answer is preferred; if it searches, verify the audit honestly shows the call.
6. Ask `Find current weather information for London and Edinburgh using separate searches, then compare them.` Confirm two distinct search request/result pairs precede the final answer.
7. During a long Agent run, tap Stop. Confirm Android stops streaming promptly, the Firestore command becomes `cancelled`, and no final assistant answer arrives later.
8. Switch in chat to Qwen 3 1.7B, LFM2.5 2.6B, and back to Qwen 3.5 2B without changing Settings or restarting the PC. Confirm the PC status/audit names the selected model each time and tools remain identical.
9. Select Qwen 3.5 4B only as a negative hardware test. Expect a bounded memory error, not a hang or fallback to another model.
10. Check narrow-screen Settings: buttons should remain within their cards, wrap where needed, and not overlap or droop beyond the viewport.

Physical Android relay/UI acceptance was not run in this session; the Android debug Kotlin target compiles successfully, and the actual PC runtime/search loop was exercised directly.
