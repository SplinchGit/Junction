"use strict";

const crypto = require("node:crypto");
const {isOngoingRequest}=require('./local-agent-tools');

function parseNethraChat(content) {
  const message = String(content || "").trim();
  if (/^(?:is (?:nethra|agent mode) (?:working|available|callable)(?: in chat)?|what (?:can|does) nethra do|nethra[, :]?\s*help)\??[.!]?$/i.test(message)) return { action: "help" };
  if (/^(?:nethra[, :]?\s*(?:status|progress|tasks?|objectives?)|(?:show|list) (?:my )?nethra (?:tasks?|objectives?)|what is nethra working on)\??[.!]?$/i.test(message)) return { action: "list" };
  const control = message.match(/^nethra[, :]?\s*(pause|resume|cancel)\s+(?:task\s+)?([0-9a-f]{8}-[0-9a-f-]{27,35})[.!]?$/i);
  if (control) return { action: "control", command: control[1].toLowerCase(), id: control[2].toLowerCase() };
  const goal = message.match(/^(?:nethra[, :]?\s*(?:please\s+)?(?:start|work on|research|investigate|track|plan|prepare|draft)\b|(?:start|create) (?:a |an )?(?:persistent )?(?:nethra|agent)(?: task| objective| goal)?\s*(?::|to)?)/i);
  if (!goal) return null;
  let objective = message.slice(goal[0].length).replace(/^\s*[:,-]?\s*/, "").trim();
  if (/^nethra[, :]?\s*(?:research|investigate|track|plan|prepare|draft)\b/i.test(goal[0])) {
    const verb = goal[0].trim().split(/\s+/).at(-1);
    objective = `${verb} ${objective}`.trim();
  }
  return objective ? { action: "create", goal: objective, mode:isOngoingRequest(message)||/\btrack\b/i.test(goal[0])?'ONGOING':'FINITE' } : { action: "help" };
}

async function handleNethraChat({ api, content, conversationId = null, requestId = crypto.randomUUID(), source = "desktop" }) {
  const instruction = parseNethraChat(content);
  if (!instruction) return null;
  if (instruction.action === "help") return "Nethra agent mode is available. Say ‘Nethra, research <topic>’ or ‘Start a Nethra goal: <objective>’ to create durable work. Say ‘Nethra status’ to see saved objectives. Use the Nethra panel for plans, evidence, approvals, and Thinking Mode.";
  if (instruction.action === "list") {
    const { objectives } = await api.dispatch("nethra.list", {}, requestId, source);
    return objectives.length ? objectives.slice(0, 10).map(task => `${task.id} — ${task.status}: ${task.goal}${task.nextWakeAt ? ` (next wake ${new Date(task.nextWakeAt).toLocaleString()})` : ""}`).join("\n") : "Nethra has no saved objectives yet. Say ‘Start a Nethra goal: <objective>’ to begin.";
  }
  if (instruction.action === "create") {
    const { task } = await api.dispatch("nethra.create", { goal: instruction.goal, successCriteria: instruction.goal, mode:instruction.mode, persistent: true, conversationId }, requestId, source);
    return `Nethra saved objective ${task.id}: ${task.goal}. Status: ${task.status}. I’ll continue it on the Windows host; open Nethra to review the plan, progress and any approval requests.`;
  }
  const { task: current } = await api.dispatch("nethra.get", { id: instruction.id }, `${requestId}:get`, source);
  const { task } = await api.dispatch("nethra.control", { id: instruction.id, action: instruction.command, revision: current.revision }, requestId, source);
  return `Nethra objective ${task.id} is ${task.status}.`;
}

module.exports = { parseNethraChat, handleNethraChat };
