"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalAgentRuntime } = require("../src/local-agent-runtime");
const { LocalAgentToolRegistry } = require("../src/local-agent-tools");
const { ResearchCoordinator } = require("../src/research-coordinator");
const { WebResearchClient } = require("../src/web-research");

const model = process.argv[2] || "qwen3:1.7b";
const scenario = process.argv[3] || "weather";
const goals = {
  weather: "What's the weather like in London right now? Use current public evidence.",
  static: "How tall is the Burj Khalifa?",
  multi:
    "Use separate web searches to find current weather information for London and Edinburgh, then compare them. You must perform one web_search for London and a later web_search for Edinburgh before answering.",
};

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-agent-smoke-"));
  const auditPath = path.join(directory, "audit.jsonl");
  const coordinator = new ResearchCoordinator(directory, new WebResearchClient());
  const registry = new LocalAgentToolRegistry({ researchCoordinator: coordinator, auditPath });
  const runtime = new LocalAgentRuntime({ researchCoordinator: coordinator, toolRegistry: registry });
  const started = performance.now();
  const report = { generatedAt: new Date().toISOString(), model, scenario, goal: goals[scenario] };
  try {
    const result = await runtime.run({ goal: goals[scenario], model });
    Object.assign(report, {
      success: true,
      wallMs: Math.round(performance.now() - started),
      answer: result.content,
      iterations: result.iterations,
      toolCalls: result.toolCalls,
      searches: result.searches,
      citationAudit: result.citationAudit,
    });
  } catch (error) {
    Object.assign(report, {
      success: false,
      wallMs: Math.round(performance.now() - started),
      error: String(error.message || error),
    });
  }
  report.audit = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
  const outputDirectory = path.join(__dirname, "..", "test-results");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(
    outputDirectory,
    `junction-agent-${model.replace(/[^a-z0-9.-]+/gi, "-")}-${scenario}.json`,
  );
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.success ? 0 : 1;
  await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => {});
})();
