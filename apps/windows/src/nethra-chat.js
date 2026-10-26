"use strict";

const crypto = require("node:crypto");
const {isOngoingRequest}=require('./local-agent-tools');

const TASK_NOUN = /\b(?:task|objective|goal|tracking|research|monitoring)\b/i;
const PRONOUN = /^(?:it|that|this)$/i;
const VERBS = [
  ["continue", /^(?:continue|resume|carry on with|pick up|keep going with|keep working on)$/],
  // "stop" is reversible here; only an explicit cancel ends an objective.
  ["pause", /^(?:pause|hold|stop)$/],
  ["cancel", /^(?:cancel|abandon|drop)$/],
  ["wake", /^(?:check|check on|look at|run|wake)$/],
  ["status", /^(?:status of|progress on|update on|how(?:'s| is) it going with|how(?:'s| is)|what(?:'s| is) happening with)$/],
  ["redirect", /^(?:redirect|change|refocus)$/]
];
// "continue that task", "pause the housing task", "check that task now", "redirect it to …".
const REFERENCE = /^(?:nethra[, :]?\s*)?(?:please\s+)?(continue|resume|carry on with|pick up|keep going with|keep working on|pause|hold|cancel|stop|abandon|drop|check on|check|look at|run|wake|status of|progress on|update on|how(?:'s| is) it going with|how(?:'s| is)|what(?:'s| is) happening with|redirect|change|refocus)\s+(?:(that|this|the|my|it)\b\s*)?(.*?)\s*(?:\b(now|again)\b)?\s*(?:(?:\bto\b|:)\s*(.+?))?\s*[.!?]*$/i;

/** Conversation-relative task references. Returns null for ordinary chat. */
function parseReference(message) {
  if (message.length > 600) return null;
  const match = message.match(REFERENCE);
  if (!match) return null;
  const verb = match[1].toLowerCase().replace(/\s+/g, " ");
  const determiner = match[2] || "";
  let topic = String(match[3] || "").trim(), direction = String(match[5] || "").trim();
  const pronoun = PRONOUN.test(determiner) && !topic;
  // Only a reference to existing work counts; "stop", "check the weather" stay ordinary chat.
  if (!pronoun && !TASK_NOUN.test(topic) && !PRONOUN.test(topic)) return null;
  topic = topic.replace(TASK_NOUN, "").replace(/\b(?:the|my|that|this|it|on|with|going|doing)\b/gi, " ").replace(/\s+/g, " ").trim();
  let command = VERBS.find(([, pattern]) => pattern.test(verb))?.[0] || "status";
  if (command === "wake" && !match[4] && !/^(?:run|wake)$/.test(verb)) command = verb === "check" ? "wake" : "status";
  if (command === "redirect" && !direction) return { action: "clarify", text: "Tell me the new direction, for example: ‘redirect that task to focus on official sources only’." };
  return { action: "reference", command, topic, direction };
}

// Short owner commands inside a task's own chat. Live, "We're gunna pass for now?" got "I'll pause
// the objective" from the chat model while the task kept running. Applied only when the chat has a task.
const NEGATED = /\b(?:don'?t|do not|never|no need to|not yet)\b/i;
const BARE_PAUSE = /\b(?:pause(?: (?:it|this|that))?|hold off|put (?:it|this|that) on hold|(?:pass|stop|leave it|park it|call it)(?: (?:there|here))? for (?:now|today|tonight|a bit)|take a break)\b/i;
const BARE_RESUME = /\b(?:resume|unpause|carry on|keep going|pick (?:it|this|that) back up)\b/i;
function parseTaskChatControl(content) {
  const message = String(content || "").trim();
  // Questions about pausing are not commands; polite requests ("can you pause it?") still are.
  if (!message || message.length > 120 || NEGATED.test(message) || /^(?:how|what|why|when|where|which|who|is|are|does|do|did|should|shall)\b/i.test(message)) return null;
  if (BARE_PAUSE.test(message)) return { action: "reference", command: "pause", topic: "", direction: "", bare: true };
  if (BARE_RESUME.test(message)) return { action: "reference", command: "continue", topic: "", direction: "", bare: true };
  return null;
}

const PAUSE_CLAIM = /\b(?:I(?:'ll| will) (?:pause|hold|stop working on)|I(?:'ve| have) (?:paused|stopped)|(?:is|remains|stays) (?:now )?paused|paused (?:as |per |at )?your request)\b/i;
const RESUME_CLAIM = /\b(?:I(?:'ll| will) (?:resume|restart|continue working on)|I(?:'ve| have) resumed)\b/i;
/** A chat reply may not claim it changed the task; the task's real status is the authority. */
function correctTaskClaims(content, task) {
  if (!task || typeof content !== "string") return content;
  const status = String(task.status).toLowerCase().replaceAll("_", " ");
  if (PAUSE_CLAIM.test(content) && task.status !== "PAUSED") return `${content}\n\n(Correction from Junction: “${String(task.goal).slice(0, 80)}” is not paused; it is ${status}. Say “pause” here, or use Tasks, to pause it.)`;
  if (RESUME_CLAIM.test(content) && task.status === "PAUSED") return `${content}\n\n(Correction from Junction: “${String(task.goal).slice(0, 80)}” is still paused. Say “resume” here to restart it.)`;
  return content;
}

function parseNethraChat(content) {
  const message = String(content || "").trim();
  if (/^(?:what are you (?:currently )?working on|what (?:tasks|objectives) do you have scheduled|(?:show|list) my scheduled (?:tasks|objectives)|what are your (?:current |scheduled )?(?:tasks|objectives))[?!.]*$/i.test(message)) return { action: "list" };
  if (/^(?:is (?:nethra|agent mode) (?:working|available|callable)(?: in chat)?|what (?:can|does) nethra do|nethra[, :]?\s*help)\??[.!]?$/i.test(message)) return { action: "help" };
  if (/^(?:nethra[, :]?\s*(?:status|progress|tasks?|objectives?)|(?:show|list) (?:my )?nethra (?:tasks?|objectives?)|what is nethra working on)\??[.!]?$/i.test(message)) return { action: "list" };
  const control = message.match(/^nethra[, :]?\s*(pause|resume|cancel)\s+(?:task\s+)?([0-9a-f]{8}-[0-9a-f-]{27,35})[.!]?$/i);
  if (control) return { action: "control", command: control[1].toLowerCase(), id: control[2].toLowerCase() };
  const reference = parseReference(message);
  if (reference) return reference;
  const goal = message.match(/^(?:nethra[, :]?\s*(?:please\s+)?(?:start|work on|research|investigate|track|plan|prepare|draft)\b|(?:start|create) (?:a |an )?(?:persistent )?(?:nethra|agent)(?: task| objective| goal)?\s*(?::|to)?)/i);
  if (!goal) return null;
  let objective = message.slice(goal[0].length).replace(/^\s*[:,-]?\s*/, "").trim();
  if (/^nethra[, :]?\s*(?:research|investigate|track|plan|prepare|draft)\b/i.test(goal[0])) {
    const verb = goal[0].trim().split(/\s+/).at(-1);
    objective = `${verb} ${objective}`.trim();
  }
  return objective ? { action: "create", goal: objective, mode:isOngoingRequest(message)||/\btrack\b/i.test(goal[0])?'ONGOING':'FINITE' } : { action: "help" };
}

const FINISHED = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
const words = text => new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
/**
 * Resolves "that task" from the conversation: the one unfinished objective linked to this
 * chat, else a topic match, else the only unfinished objective. Ambiguity returns choices.
 */
function resolveObjective(objectives, conversationId, topic) {
  const open = objectives.filter(task => !FINISHED.has(task.status));
  const scored = topic ? open.map(task => ({ task, score: [...words(topic)].filter(word => words(task.goal).has(word)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score) : [];
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return { task: scored[0].task };
  if (topic && scored.length > 1) return { choices: scored.slice(0, 3).map(item => item.task) };
  const linked = open.filter(task => conversationId && task.conversationId === conversationId);
  if (linked.length === 1) return { task: linked[0] };
  if (linked.length > 1) return { choices: linked.slice(0, 3) };
  if (open.length === 1) return { task: open[0] };
  if (!open.length) {
    const finished = objectives.find(task => conversationId && task.conversationId === conversationId);
    return finished ? { task: finished } : { none: true };
  }
  return { choices: open.slice(0, 3) };
}

const when = at => new Date(at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
function describe(task, progress) {
  const lines = [`“${String(task.goal).slice(0, 160)}” — ${task.status.toLowerCase().replaceAll("_", " ")}.`];
  if (progress?.doing) lines.push(`Now: ${progress.doing}.`);
  if (progress?.lastAccomplished) lines.push(`Last recorded (${when(progress.lastAccomplished.at)}): ${progress.lastAccomplished.line}.`);
  if (progress?.next) lines.push(`Next: ${progress.next}.`);
  if (progress?.wake) lines.push(`Wakes ${when(progress.wake.at)} — ${progress.wake.reason}.`);
  if (progress?.waitingFor && ["approval", "input", "blocked", "owner_resume"].includes(progress.waitingFor.kind)) lines.push(`Needs from you: ${progress.waitingFor.detail}`);
  if (progress?.outputs?.length) lines.push(`Outputs: ${progress.outputs.map(item => item.path).join(", ")}.`);
  return lines.join("\n");
}

async function handleReference({ api, instruction, conversationId, requestId, source }) {
  const { objectives } = await api.dispatch("nethra.list", {}, `${requestId}:list`, source);
  const resolved = resolveObjective(objectives, conversationId, instruction.topic);
  if (resolved.none) return "I don't have an objective to act on yet. Say ‘Start a Nethra goal: …’ or ask me to keep track of something.";
  if (resolved.choices) return `Which task do you mean?\n${resolved.choices.map((task, index) => `${index + 1}. ${String(task.goal).slice(0, 120)} (${task.status.toLowerCase().replaceAll("_", " ")})`).join("\n")}\nSay, for example, ‘${instruction.command === "status" ? "status of" : instruction.command} the ${[...words(resolved.choices[0].goal)][0] || "first"} task’.`;
  const { task, progress } = await api.dispatch("nethra.get", { id: resolved.task.id }, `${requestId}:get`, source);
  if (instruction.command === "status") return describe(task, progress);
  if (FINISHED.has(task.status)) return `That objective is already ${task.status.toLowerCase()}. Start a new goal if you want me to pick it back up.`;
  const control = async action => (await api.dispatch("nethra.control", { id: task.id, action, revision: task.revision }, requestId, source)).task;
  if (instruction.command === "pause") { if (task.status === "PAUSED") return "That task is already paused."; const updated = await control("pause"); return `Paused “${String(updated.goal).slice(0, 120)}”. Say ‘continue that task’ to resume it.`; }
  if (instruction.command === "cancel") { await control("cancel"); return `Cancelled “${String(task.goal).slice(0, 120)}”. Its evidence and outputs stay in Tasks.`; }
  if (instruction.command === "redirect") { const updated = (await api.dispatch("nethra.redirect", { id: task.id, instruction: instruction.direction, revision: task.revision }, requestId, source)).task; return `Redirected “${String(updated.goal).slice(0, 120)}”: ${instruction.direction}\nCompleted steps and evidence are kept; I'll re-plan from your new direction on the next run.`; }
  // continue / wake
  if (task.status === "PAUSED") { const updated = await control("resume"); return `Resumed “${String(updated.goal).slice(0, 120)}” (${updated.status.toLowerCase().replaceAll("_", " ")}).`; }
  if (task.status === "SLEEPING") { await control("wake"); return `Checking “${String(task.goal).slice(0, 120)}” now. I'll report back here when it settles.`; }
  if (task.status === "WAITING_FOR_USER" || task.status === "BLOCKED") return `${describe(task, progress)}\n\n${progress?.waitingFor?.kind === "approval" ? "Approve or reject it in Tasks; voice approval works for supported phone actions." : "Answer that in Tasks, or ‘redirect that task to …’ here."}`;
  return `It's already ${task.status === "ACTIVE" ? "running" : "queued"}.\n${describe(task, progress)}`;
}

async function handleNethraChat({ api, content, conversationId = null, requestId = crypto.randomUUID(), source = "desktop" }) {
  let instruction = parseNethraChat(content);
  if (!instruction && conversationId) {
    const bare = parseTaskChatControl(content);
    if (bare) {
      const { objectives } = await api.dispatch("nethra.list", {}, `${requestId}:linked`, source);
      if (objectives.some(task => task.conversationId === conversationId && !FINISHED.has(task.status))) instruction = bare;
    }
  }
  if (!instruction) return null;
  if (instruction.action === "clarify") return instruction.text;
  if (instruction.action === "help") return "Nethra agent mode is available. Say ‘Nethra, research <topic>’ or ‘Start a Nethra goal: <objective>’ to create durable work. Say ‘Nethra status’ to see saved objectives, or ‘continue / pause / cancel / check that task now’ to steer the one in this chat. Use Tasks for plans, evidence and approvals.";
  if (instruction.action === "reference") return handleReference({ api, instruction, conversationId, requestId, source });
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

module.exports = { parseNethraChat, parseReference, parseTaskChatControl, correctTaskClaims, resolveObjective, handleNethraChat };
