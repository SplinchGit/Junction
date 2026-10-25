"use strict";
// Live measurement against the installed Ollama model. Unloads the model to measure a cold
// start, so run it only when no objective holds the inference lease. No conversation or
// task is created; web search is not used. Writes test-results/warmup-latency.json.
const fs = require("node:fs");
const path = require("node:path");
const { LocalAgentRuntime } = require("../src/local-agent-runtime");
const { LocalAgentToolRegistry } = require("../src/local-agent-tools");

const MODEL = "qwen3:30b";
const runtime = new LocalAgentRuntime({ toolRegistry: new LocalAgentToolRegistry({ researchCoordinator: { run: async () => { throw new Error("search disabled"); } } }) });

async function turn(label, goal) {
  const started = Date.now(); let phases = [];
  const reply = await runtime.run({ goal, model: MODEL, history: [], surface: "desktop", onProgress: async progress => { if (progress.phase && phases.at(-1)?.phase !== progress.phase) phases.push({ phase: progress.phase, atMs: Date.now() - started }); } });
  const m = reply.metrics || {};
  return { label, goal, wallMs: Date.now() - started, coldStart: m.coldStart, queueMs: m.queueMs, firstTokenMs: m.firstTokenMs, firstContentMs: m.firstContentMs, loadMs: m.loadMs, promptEvalMs: m.promptEvalMs, evalMs: m.evalMs, generatedTokens: m.generatedTokens, tokensPerSecond: m.tokensPerSecond, modelCalls: m.modelCalls, phases, reply: String(reply.content).slice(0, 160) };
}

(async () => {
  const results = { model: MODEL, measuredAt: new Date().toISOString(), runs: [] };
  const show = await fetch("http://127.0.0.1:11434/api/version").then(r => r.json());
  results.ollama = show.version;
  // 1. Cold chat: model not resident when the message arrives.
  await runtime.releaseResidentModels(null);
  results.runs.push(await turn("cold chat (no warm-up)", "Hello"));
  // 2. Warm chats, same session.
  results.runs.push(await turn("warm chat", "Hello"));
  results.runs.push(await turn("warm chat (short question)", "In one sentence, what is the capital of Scotland?"));
  // 3. Warm-up path: unload, measure the load request alone, then the first chat after it.
  await runtime.releaseResidentModels(null);
  runtime.warmer.snapshot.checkedAt = null;
  const warmStarted = Date.now();
  const warm = await runtime.warmer.warm({ reason: "measurement", priority: "interactive", force: true });
  results.warmUp = { outcome: warm.outcome, wallMs: Date.now() - warmStarted, loadMs: warm.lastWarm?.loadMs ?? null };
  results.runs.push(await turn("first chat after warm-up", "Hello"));
  const out = path.join(__dirname, "../test-results/warmup-latency.json");
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
