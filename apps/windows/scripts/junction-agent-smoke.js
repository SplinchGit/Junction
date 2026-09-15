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
  post2023: "Who won the 2025 Wimbledon gentlemen's singles title? This happened after 2023, so use web_search and cite the returned passage evidence.",
  post2023_python: "According to Python.org, on what date was Python 3.13.0 released? This happened after 2023, so use web_search and cite the returned passage evidence.",
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
    const usedWebSearch = result.toolsExecuted > 0 && result.toolNames.includes("web_search") && result.research?.sources?.length > 0;
    const expectedFactPresent = scenario === "post2023"
      ? /jannik\s+sinner[^.\n]{0,100}(?:won|winner|champion)|(?:won|winner|champion)[^.\n]{0,100}jannik\s+sinner/i.test(result.content) && !/(?:2025\s+wimbledon|wimbledon[^.\n]{0,30}2025)[^.\n]{0,100}novak\s+djokovic|novak\s+djokovic[^.\n]{0,100}(?:won|winner|champion)[^.\n]{0,50}2025/i.test(result.content)
      : scenario === "post2023_python"
        ? /(?:oct(?:ober|\.)?\s+7,?\s+2024|7\s+october\s+2024)/i.test(result.content)
        : true;
    const citationsValid = result.citationAudit?.hasCitations === true && result.citationAudit.invalid.length === 0;
    Object.assign(report, {
      success: usedWebSearch && expectedFactPresent && citationsValid,
      wallMs: Math.round(performance.now() - started),
      answer: result.content,
      iterations: result.iterations,
      toolCalls: result.toolCalls,
      toolsExecuted: result.toolsExecuted,
      toolNames: result.toolNames,
      citationAudit: result.citationAudit,
      expectedFactPresent,
      failure: !usedWebSearch ? "No successful recorded web_search execution." : !expectedFactPresent ? "The answer did not contain the independently verified expected fact." : !citationsValid ? "The answer did not contain valid passage citations." : undefined,
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
