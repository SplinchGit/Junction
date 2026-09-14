"use strict";

const fs = require("node:fs");
const path = require("node:path");

const models = process.argv.slice(2);
const selectedModels = models.length
  ? models
  : ["qwen3:1.7b", "qwen3.5:2b", "qwen3.5:4b", "lfm2.5:2.6b"];
const endpoint = "http://127.0.0.1:11434";
const weatherTool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "City name" } },
      required: ["city"],
    },
  },
};

function rate(count, duration) {
  return duration > 0 ? Number((count / (duration / 1e9)).toFixed(2)) : null;
}

async function post(route, body) {
  const started = performance.now();
  const response = await fetch(`${endpoint}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 500)}`);
  return { body: JSON.parse(text), wallMs: Math.round(performance.now() - started) };
}

async function loadedMemory(model) {
  const response = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  const data = await response.json();
  const entry = (data.models || []).find((item) => item.name === model || item.model === model);
  if (!entry) return null;
  return {
    sizeBytes: entry.size || null,
    sizeVramBytes: entry.size_vram || 0,
    estimatedRamBytes: Math.max(0, (entry.size || 0) - (entry.size_vram || 0)),
  };
}

async function unload(model) {
  try {
    await post("/api/generate", { model, keep_alive: 0 });
  } catch {}
}

async function testModel(model) {
  const messages = [{ role: "user", content: "What is the weather in London right now?" }];
  const common = {
    model,
    stream: false,
    think: false,
    tools: [weatherTool],
    options: { num_ctx: 4096, num_predict: 256, temperature: 0 },
    keep_alive: "5m",
  };
  const result = { model, success: false };
  try {
    const first = await post("/api/chat", { ...common, messages });
    const call = first.body.message?.tool_calls?.[0];
    const name = call?.function?.name;
    let args = call?.function?.arguments;
    if (typeof args === "string") args = JSON.parse(args);
    result.firstWallMs = first.wallMs;
    result.promptTokensPerSecond = rate(
      first.body.prompt_eval_count,
      first.body.prompt_eval_duration,
    );
    result.generationTokensPerSecond = rate(first.body.eval_count, first.body.eval_duration);
    result.structuredToolCall = Boolean(call);
    result.requestedTool = name || null;
    result.arguments = args || null;
    result.loadedMemory = await loadedMemory(model);

    if (!call || name !== "get_weather" || !/london/i.test(String(args?.city || ""))) {
      result.failure = "No correct structured get_weather(London) call.";
      result.modelText = first.body.message?.content || "";
      return result;
    }

    const fakeWeather = { city: "London", temperature: 17, condition: "Cloudy" };
    messages.push(first.body.message);
    messages.push({
      role: "tool",
      tool_name: "get_weather",
      content: JSON.stringify(fakeWeather),
    });
    const second = await post("/api/chat", { ...common, messages });
    const answer = second.body.message?.content || "";
    result.finalWallMs = second.wallMs;
    result.totalWallMs = first.wallMs + second.wallMs;
    result.finalGenerationTokensPerSecond = rate(second.body.eval_count, second.body.eval_duration);
    result.finalAnswer = answer;
    result.finalHasUnexpectedToolCall = Boolean(second.body.message?.tool_calls?.length);
    result.success =
      !result.finalHasUnexpectedToolCall &&
      /london/i.test(answer) &&
      (/17/.test(answer) || /cloudy/i.test(answer));
    if (!result.success) result.failure = "Final answer did not use the deterministic tool result.";
    return result;
  } catch (error) {
    result.failure = error.message;
    return result;
  } finally {
    await unload(model);
  }
}

(async () => {
  const results = [];
  for (const model of selectedModels) {
    process.stderr.write(`Testing ${model}...\n`);
    results.push(await testModel(model));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    host: "Intel i7-6700K / 12 GB RAM / CPU Ollama",
    contextTokens: 4096,
    fakeToolResult: { city: "London", temperature: 17, condition: "Cloudy" },
    results,
  };
  const output = path.join(__dirname, "..", "test-results", "ollama-tool-smoke.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = results.every((item) => item.success) ? 0 : 1;
})();
