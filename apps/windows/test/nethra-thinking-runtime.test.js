"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LocalAgentRuntime } = require("../src/local-agent-runtime");
const { profileFor, NEXT_80B_THINKING_MODEL, NEXT_80B_MODEL, DEFAULT_MODEL } = require("../src/nethra-models");
const { providers } = require("../src/model-catalog");

test("official Q4 Thinking is selectable and uses its own context budget", async () => {
  const { normalizeLocalModel } = require("../src/model-catalog");
  const model = "junction-qwen3-next-thinking:80b-q4km";
  assert.equal(normalizeLocalModel("hf.co/Qwen/Qwen3-Next-80B-A3B-Thinking-GGUF:Q4_K_M"), model);
  assert.equal(profileFor(model).thinking, true);
  let payload;
  const runtime = new LocalAgentRuntime({ fetchImpl: async (_url, request) => {
    payload = JSON.parse(request.body);
    return { ok: true, json: async () => ({ message: { content: "391" } }) };
  } });
  await runtime.chatOnceInner(model, [{role:"user",content:"17 times 23"}], [], null, null, null, {thinking:false});
  assert.equal(payload.model, model);
  assert.equal(payload.think, true);
  assert.equal(payload.options.num_ctx, 8192);
  assert.equal(payload.options.num_predict, 2048);
  assert.equal(payload.options.temperature, 0.6);
  assert.equal(payload.options.top_p, 0.95);
  assert.equal(payload.options.top_k, 20);
  assert.equal(payload.options.min_p, 0);
  assert.equal(payload.options.use_mmap, true);
});

test("80B Thinking remains a separate, opt-in model profile", () => {
  assert.equal(profileFor(DEFAULT_MODEL).thinking, true);
  assert.equal(profileFor(DEFAULT_MODEL).thinkingBudget, 1100);
  assert.equal(profileFor(NEXT_80B_MODEL).thinking, false);
  assert.equal(profileFor(NEXT_80B_THINKING_MODEL).thinking, true);
  assert.equal(profileFor(NEXT_80B_THINKING_MODEL).thinkingBudget, 0);
  assert.equal(profileFor(NEXT_80B_THINKING_MODEL).outputTokens, 6144);
  assert.equal(providers.find(provider => provider.id === "local").defaultModel, DEFAULT_MODEL);
  assert.ok(providers.find(provider => provider.id === "local").models.some(model => model.id === NEXT_80B_THINKING_MODEL && model.thinking));
});

test("native Thinking weights force Ollama think:true and preserve the extended output budget", async () => {
  let payload;
  const runtime = new LocalAgentRuntime({
    warmer: { model: NEXT_80B_THINKING_MODEL, keepAlive: () => "15m", inferenceStarted() {}, inferenceFinished() {} },
    fetchImpl: async (url, options) => {
      assert.ok(url.endsWith("/api/chat"));
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({
        model: NEXT_80B_THINKING_MODEL,
        message: { role: "assistant", thinking: "internal reasoning", content: "",
          tool_calls: [{ function: { name: "update_plan", arguments: { steps: ["Write notes"] } } }] }
      }) };
    }
  });
  const output = await runtime.chat(NEXT_80B_THINKING_MODEL, [{ role: "user", content: "Plan the task" }],
    [{ type: "function", function: { name: "update_plan", description: "Update the plan", parameters: { type: "object", properties: {} } } }],
    null, null, null, { thinking: false, num_predict: 6144, rawMeasurement: true });
  assert.equal(payload.think, true, "Thinking-only weights must not be run with think:false");
  assert.equal(payload.options.num_predict, 6144, "The 3,072-token generic cap must not truncate thinking");
  assert.equal(payload.options.num_ctx, 16384);
  assert.equal(output.message.tool_calls[0].function.name, "update_plan");
  assert.equal(output.message.thinking, "internal reasoning");
});
