"use strict";
// Disposable real-model approval/restart check. No owner files or external writes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { NethraStore } = require("../src/nethra-store");
const { NethraScheduler } = require("../src/nethra-scheduler");
const { NethraRunner } = require("../src/nethra-runner");
const { NethraApi } = require("../src/nethra-api");
const { LocalAgentRuntime } = require("../src/local-agent-runtime");

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nethra-live-approval-"));
  const stateDirectory = path.join(directory, "state");
  const runtime = new LocalAgentRuntime();
  let store = new NethraStore(stateDirectory);
  const task = store.create({
    goal: "Replace the existing draft file review.txt in your objective workspace with the exact phrase amber approval 62. This existing-file replacement requires owner approval. Save a plan, use the native write_draft tool, and finish only after the approved write is verified.",
    successCriteria: "review.txt contains amber approval 62 and the objective is complete.",
    persistent: true
  });
  const file = path.join(task.workspace, "review.txt");
  fs.writeFileSync(file, "old draft content\n");
  const cycle = async () => {
    const runner = new NethraRunner({ store, runtime });
    const scheduler = new NethraScheduler({ store, execute: (current, options) => runner.execute(current, options) });
    await scheduler.tick();
  };
  await cycle();
  const waiting = store.get(task.id);
  const pending = store.approvals(task.id).filter(item => item.status === "PENDING");
  const before = fs.readFileSync(file, "utf8");
  store.close();
  store = new NethraStore(stateDirectory);
  let approved = null;
  if (waiting.status === "WAITING_FOR_USER" && pending.length === 1 && before === "old draft content\n") {
    const api = new NethraApi({ store, runtime, scheduler: null });
    approved = await api.dispatch("nethra.approve", { id: pending[0].id, approved: true }, "live-approval", "android");
    await cycle();
  }
  const final = store.get(task.id);
  const after = fs.readFileSync(file, "utf8");
  const result = { live: true, model: "qwen3:30b", taskId: task.id, firstStatus: waiting.status, approvalCount: pending.length, fileUntouchedBeforeApproval: before === "old draft content\n", approvalStatus: approved?.approval?.status || null, finalStatus: final.status, after, evidenceTools: final.evidence.map(item => item.tool), events: store.events(task.id).map(item => item.kind) };
  result.success = result.firstStatus === "WAITING_FOR_USER" && result.approvalCount === 1 && result.fileUntouchedBeforeApproval && result.approvalStatus === "APPROVED" && result.finalStatus === "COMPLETED" && after.includes("amber approval 62") && result.evidenceTools.includes("write_draft");
  fs.writeFileSync(path.resolve(__dirname, "../../../artifacts/nethra-30b-live-approval-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  store.close();
  if (!result.success) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
