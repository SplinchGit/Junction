"use strict";
// Unit and contract cover for the verbose run-metrics footer and for the
// host-memory failure classification that makes a failed 14B load recoverable.
const assert = require("node:assert/strict");
const test = require("node:test");
const { telemetryLine } = require("../renderer/message-format");
const { LocalAgentRuntime, isResourceFailure, resourceFailureMessage, newTimings, addTimings, modelMetrics } = require("../src/local-agent-runtime");

test("telemetry footer reports speed, tokens and timing", () => {
  const line = telemetryLine({ model: "qwen3:14b", tokensPerSecond: 30.78, generatedTokens: 150, inputTokens: 1024, durationMs: 4480, loadMs: 12, evalMs: 4875, modelCalls: 2, toolsExecuted: 1, toolNames: ["web_search"], thinkingState: "off" });
  assert.match(line, /qwen3:14b/);
  assert.match(line, /30\.8 tok\/s/);
  assert.match(line, /150 out/);
  assert.match(line, /1,024 in/);
  assert.match(line, /4\.48s total/);
  assert.match(line, /1 tool \(web_search\)/);
  assert.match(line, /thinking off/);
});

test("unmeasured generation speed is omitted rather than shown as zero", () => {
  const line = telemetryLine({ model: "qwen3:14b", tokensPerSecond: null, generatedTokens: 0, durationMs: 1200 });
  assert.doesNotMatch(line, /tok\/s/);
  assert.match(line, /1\.20s total/);
});

test("thinking states are described distinctly", () => {
  assert.match(telemetryLine({ thinkingState: "reported", thinkingCharacters: 970 }), /970 thinking chars/);
  assert.match(telemetryLine({ thinkingState: "enabled_no_output" }), /thinking on; none reported/);
  assert.equal(telemetryLine(null), "");
  assert.equal(telemetryLine("nonsense"), "");
});

test("tool requests that never executed are not reported as executed tools", () => {
  assert.match(telemetryLine({ toolCalls: 2, toolsExecuted: 0 }), /2 tool requests; none executed/);
});

test("generation speed uses host eval timing, not Junction wall clock", () => {
  const timings = newTimings();
  addTimings(timings, { eval_count: 100, eval_duration: 2_000_000_000, prompt_eval_duration: 500_000_000, load_duration: 28_000_000_000 });
  addTimings(timings, { eval_count: 50, eval_duration: 1_000_000_000 });
  const metrics = modelMetrics(timings, 90_000);
  assert.equal(metrics.generatedTokens, 150);
  assert.equal(metrics.tokensPerSecond, 50); // 150 tokens / 3s of real generation
  assert.equal(metrics.evalMs, 3000);
  assert.equal(metrics.loadMs, 28_000);
  assert.equal(metrics.modelCalls, 2);
  assert.equal(metrics.durationMs, 90_000);
});

test("missing host timings leave speed unmeasured instead of dividing by zero", () => {
  const metrics = modelMetrics(newTimings(), 500);
  assert.equal(metrics.tokensPerSecond, null);
  assert.equal(metrics.generatedTokens, 0);
});

test("host memory and CUDA load failures are classified as resource failures", () => {
  for (const detail of [
    "cudaMalloc failed: out of memory",
    "ggml_backend_buft_alloc_buffer_n_default: failed to allocate CUDA0 buffer of size 8832650240",
    "CUDA error: the function failed to launch on the GPU",
    "unable to allocate CUDA_Host buffer",
    "llama-server process has terminated: exit status 1",
    "CUDA driver version is insufficient for CUDA runtime version"
  ]) assert.equal(isResourceFailure(detail), true, detail);
  assert.equal(isResourceFailure("Local model returned neither a native tool call nor a final answer."), false);
  assert.equal(isResourceFailure(""), false);
});

test("resource failure message is actionable and bounded", () => {
  const message = resourceFailureMessage("x".repeat(500));
  assert.match(message, /ran out of GPU or system memory/);
  assert.match(message, /restart Ollama/);
  assert.ok(message.length < 400, "owner-facing failure text stays bounded");
});

test("a cold load during routing is inside the reported total, not just the load time", async () => {
  // Regression: the run clock used to start after the routing call, so a cold
  // model load there was reported as load time while being excluded from the
  // total, producing a self-contradictory footer ("2.41s total, 30.5s load").
  let call = 0;
  const runtime = new LocalAgentRuntime({
    toolRegistry: { definitions: () => [], audit: () => {}, execute: async () => ({ content: "{}" }) },
    limits: { iterations: 2, toolCalls: 1, timeoutMs: 120_000 },
    fetchImpl: async (url, options) => {
      if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
      if (url.endsWith("/api/show")) return { ok: true, json: async () => ({ capabilities: ["tools"] }) };
      call += 1;
      const body = JSON.parse(options.body);
      // First call is intent routing; bill a 5s cold load to it.
      if (body.format || call === 1) {
        await new Promise(resolve => setTimeout(resolve, 60));
        return { ok: true, json: async () => ({ message: { role: "assistant", content: JSON.stringify({ intent: "question", action: "answer", authorization: "none" }) }, load_duration: 5_000_000_000, eval_count: 5, eval_duration: 100_000_000 }) };
      }
      return { ok: true, json: async () => ({ message: { role: "assistant", content: "done" }, eval_count: 10, eval_duration: 200_000_000 }) };
    }
  });
  // This goal runs intent routing without forcing a host web search.
  const result = await runtime.run({ goal: "Why does my build fail and how do I fix it?", model: "qwen3:14b", surface: "desktop", thinking: false });
  assert.equal(result.metrics.loadMs, 5000, "the cold load is reported");
  assert.ok(result.metrics.durationMs >= 60, `total must cover the routing call, got ${result.metrics.durationMs}ms`);
  assert.equal(result.metrics.modelCalls, 2, "routing and answer are both counted");
  assert.equal(result.metrics.generatedTokens, 15, "routing tokens are included in the generated count");
});

function runtimeWithResponses(handlers) {
  const requests = [];
  const runtime = new LocalAgentRuntime({
    toolRegistry: { definitions: () => [], audit: () => {}, execute: async () => ({ content: "{}" }) },
    fetchImpl: async (url, options) => {
      requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
      return handlers(url, requests.length);
    }
  });
  return { runtime, requests };
}

test("a host memory failure triggers exactly one unload-and-retry, then succeeds", async () => {
  let chatAttempts = 0;
  const { runtime, requests } = runtimeWithResponses(url => {
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [{ name: "qwen3:14b" }] }) };
    if (url.endsWith("/api/show")) return { ok: true, json: async () => ({ capabilities: ["tools"] }) };
    if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({ done: true }) };
    chatAttempts += 1;
    if (chatAttempts === 1) return { ok: false, json: async () => ({ error: "cudaMalloc failed: out of memory" }) };
    return { ok: true, json: async () => ({ message: { role: "assistant", content: "recovered" }, eval_count: 3, eval_duration: 100_000_000 }) };
  });
  const payload = await runtime.chat("qwen3:14b", [{ role: "user", content: "hi" }], [], null);
  assert.equal(payload.message.content, "recovered");
  assert.equal(chatAttempts, 2, "exactly one retry");
  assert.ok(requests.some(r => r.url.endsWith("/api/generate") && r.body?.keep_alive === 0), "resident runners are released before the retry");
});

test("a second host memory failure is reported, not retried forever", async () => {
  let chatAttempts = 0;
  const { runtime } = runtimeWithResponses(url => {
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({ done: true }) };
    chatAttempts += 1;
    return { ok: false, json: async () => ({ error: "CUDA error: the function failed to launch on the GPU" }) };
  });
  await assert.rejects(
    () => runtime.chat("qwen3:14b", [{ role: "user", content: "hi" }], [], null),
    error => {
      assert.match(error.message, /ran out of GPU or system memory/);
      return true;
    }
  );
  assert.equal(chatAttempts, 2, "one attempt plus one recovery attempt only");
});

test("ordinary model errors are not retried or reworded", async () => {
  let chatAttempts = 0;
  const { runtime } = runtimeWithResponses(url => {
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    chatAttempts += 1;
    return { ok: false, status: 400, json: async () => ({ error: "invalid tool schema" }) };
  });
  await assert.rejects(() => runtime.chat("qwen3:14b", [{ role: "user", content: "hi" }], [], null), /invalid tool schema/);
  assert.equal(chatAttempts, 1, "non-resource failures must not consume a retry");
});

test("a cancelled run does not spend a recovery retry", async () => {
  const controller = new AbortController();
  let chatAttempts = 0;
  const { runtime } = runtimeWithResponses(url => {
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({ done: true }) };
    chatAttempts += 1;
    controller.abort();
    return { ok: false, json: async () => ({ error: "cudaMalloc failed: out of memory" }) };
  });
  await assert.rejects(() => runtime.chat("qwen3:14b", [{ role: "user", content: "hi" }], [], controller.signal));
  assert.equal(chatAttempts, 1, "an aborted run must not reload the model to retry");
});
