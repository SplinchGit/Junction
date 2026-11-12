"use strict";

const crypto = require("node:crypto");
const {isOngoingRequest}=require('./local-agent-tools');
const {continuationGate,continueReviewedTask,isTaskContinuation}=require('./nethra-conversation');

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
  const composite=message.match(/^(.+?)\s+and\s+(?:please\s+)?(?:use|keep|make|write|add|include|exclude|remove|focus|change|revise|prioriti[sz]e|answer|tell|read|check|save|ensure|continue|do)\b[\s\S]+$/i);
  if(composite){const first=parseReference(composite[1]);if(first?.action==='reference'&&['continue','pause','wake'].includes(first.command))return {...first,ownerMessage:message};}
  if(/^(?:nethra[, :]?\s*)?(?:please\s+)?(?:resume|continue|pause|unpause|carry on|keep going)\s+and\b/i.test(message))return null;
  // A single-task command must not swallow an exception or a second sentence.
  // "Drop everything but X. Continue X" previously cancelled X.
  if (/\b(?:but|except|apart from)\b/i.test(message) || /[.!?]\s+\S/.test(message)) return null;
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
  const composite=message.length<=10000?message.match(/^(.+?)\s+and\s+(.+)$/i):null;
  if(composite){const control=parseTaskChatControl(composite[1]);if(control)return {...control,ownerMessage:message};}
  // Questions about pausing are not commands; polite requests ("can you pause it?") still are.
  if (!message || message.length > 120 || NEGATED.test(message) || /^(?:how|what|why|when|where|which|who|is|are|does|do|did|should|shall)\b/i.test(message)) return null;
  if (isTaskContinuation(message)) return { action: "reference", command: "continue", topic: "", direction: "", bare: true, ownerMessage: message };
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
  if (/^(?:cool[,!\.\s]*)?(?:wanna|want to|can we|can you|could you|shall we)\s+continue\s+(?:with\s+)?(?:it|that task|the task)\??[.!]?$/i.test(message)) return { action: "reference", command: "continue", topic: "" };
  if (/^(?:can|could)\s+(?:you|we)\s+(?:see|look at)\s+what\s+(?:it|that task|the task)\s+was doing\??[.!]?$/i.test(message)
      || /^(?:surely\s+)?it(?:'s| is)\s+in\s+(?:your|the)\s+tasks?\s+chat\??[.!]?$/i.test(message)) return { action: "reference", command: "history", topic: "" };
  const keepOnly = message.match(/^(?:drop|cancel|stop)\s+(?:everything|all(?:\s+(?:other\s+)?(?:tasks|objectives))?)\s+(?:but|except|apart from)\s+(.+?)(?:[.!?]\s*(continue|resume|carry on with|pick up)\s+(?:with\s+)?(?:that|this|the|it)(?:\s+task|\s+objective)?[.!?]?)?\s*[.!?]?$/i);
  if (keepOnly) return { action: "keep_only", topic: keepOnly[1].trim(), continue: Boolean(keepOnly[2]) };
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
  const selected=/\b(?:use|using|with|on)\s+(?:the\s+)?(80|30)\s?b(?:\s+(thinking|instruct))?(?:\s+(q4(?:_k_m)?))?\b/i.exec(objective);
  return objective ? { action: "create", goal: objective, mode:isOngoingRequest(message)||/\btrack\b/i.test(goal[0])?'ONGOING':'FINITE',...(selected?{model:selected[1]==='80'?(selected[3]&&selected[2]?.toLowerCase()!=='instruct'?'junction-qwen3-next-thinking:80b-q4km':selected[2]?.toLowerCase()==='thinking'?'junction-qwen3-next-thinking:80b-q3km':'junction-qwen3-next:80b-q3km'):'qwen3:30b'}:{}) } : { action: "help" };
}

const FINISHED = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
const words = text => new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
/**
 * Resolves "that task" from the conversation: the one unfinished objective linked to this
 * chat, else a topic match, else the only unfinished objective. Ambiguity returns choices.
 */
function resolveObjective(objectives, conversationId, topic) {
  const open = objectives.filter(task => !FINISHED.has(task.status));
  const scored = topic ? objectives.map(task => ({ task, score: [...words(topic)].filter(word => words(task.goal).has(word)).length })).filter(item => item.score > 0).sort((a, b) => b.score - a.score) : [];
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return { task: scored[0].task };
  if (topic && scored.length > 1) return { choices: scored.slice(0, 3).map(item => item.task) };
  const allLinked = objectives.filter(task => conversationId && task.conversationId === conversationId);
  const activeLinked = allLinked.filter(task=>!FINISHED.has(task.status));
  const linked = activeLinked.length?activeLinked:allLinked;
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

/** Resolve across transport pages locally; only the selected task enters the conversation. */
async function listForReference(api,requestId,source) {
  const tasks=new Map();let offset=0;
  for(;;){
    const page=await api.dispatch('nethra.list',{offset},`${requestId}:list:${offset}`,source);
    for(const task of page.objectives)tasks.set(task.id,task);
    if(page.nextOffset===null||page.nextOffset===undefined)return [...tasks.values()];
    if(!Number.isSafeInteger(page.nextOffset)||page.nextOffset<=offset)throw new Error('Invalid objective pagination');
    offset=page.nextOffset;
  }
}

async function handleReference({ api, instruction, conversationId, requestId, source }) {
  const objectives = await listForReference(api,requestId,source);
  const resolved = resolveObjective(objectives, conversationId, instruction.topic);
  if (resolved.none) return "I don't have an objective to act on yet. Say ‘Start a Nethra goal: …’ or ask me to keep track of something.";
  if (resolved.choices) return `Which task do you mean?\n${resolved.choices.map((task, index) => `${index + 1}. ${String(task.goal).slice(0, 120)} (${task.status.toLowerCase().replaceAll("_", " ")})`).join("\n")}\nSay, for example, ‘${instruction.command === "status" ? "status of" : instruction.command} the ${[...words(resolved.choices[0].goal)][0] || "first"} task’.`;
  let { task, progress, approvals=[] } = await api.dispatch("nethra.get", { id: resolved.task.id }, `${requestId}:get`, source);
  if (instruction.command === "history") {
    const plan = Array.isArray(task.plan) && task.plan.length ? `\nPlan: ${task.plan.map(step => String(step).slice(0, 140)).join('; ')}.` : "";
    return `${task.conversationId ? "Yes, its task chat and work log are saved. Open it from Tasks.\n" : "Its saved work log is available in Tasks.\n"}${describe(task, progress)}${plan}`;
  }
  if (instruction.command === "status") return describe(task, progress);
  let continuation=null;
  if(instruction.command==='continue'){
    const expected=instruction.ownerMessage||'Continue the saved objective from its verified context.';
    const bindingId=`continuation-${crypto.createHash('sha256').update(requestId).digest('hex')}`;
    continuation=api.store?.bindContinuation(bindingId,expected,conversationId,task)||{taskId:task.id,status:task.status,revision:task.revision};
    if(continuation.taskId!==task.id)({task,progress,approvals=[]}=await api.dispatch('nethra.get',{id:continuation.taskId},`${requestId}:bound-task`,source));
    if(FINISHED.has(continuation.status)){
      await api.dispatch('nethra.edit',{id:task.id,revision:continuation.revision,execution:'continue',instruction:expected},requestId,source);
      ({task,progress}=await api.dispatch('nethra.get',{id:task.id},`${requestId}:after-continuation`,source));
      return `${task.status==='ACTIVE'?'Resumed using its saved context and permissions.':'Continuation recorded; current task state:'}\n${describe(task,progress)}`;
    }
    if(task.status!==continuation.status)return describe(task,progress);
    // A continuation is never an answer to a missing decision or an action approval.
    if(task.status==='WAITING_FOR_USER'||task.status==='BLOCKED'){
      const continued=await continueReviewedTask({api,task:{...task,revision:continuation.revision},approvals,requestId,source});
      return continued||`${continuationGate(task,approvals,progress)}${approvals.some(item=>item.status==='PENDING')?'':"\n\nAnswer that in Tasks, or ‘redirect that task to …’ here."}`;
    }
  }
  if (FINISHED.has(task.status)) {
    if(instruction.command==='redirect'){
      const result=await api.dispatch('nethra.edit',{id:task.id,revision:task.revision,instruction:instruction.direction},requestId,source);
      return result.clarification||`Updated “${String(result.task.goal).slice(0,120)}”.`;
    }
    return `That objective is already ${task.status.toLowerCase()}. Say “continue that task” to resume its saved work.`;
  }
  let controlRevision=continuation?.revision??task.revision;
  if(instruction.ownerMessage){
    const direction=await api.dispatch('nethra.message',{id:task.id,text:instruction.ownerMessage,conversationId,noteOnly:true,...(continuation?{revision:continuation.revision}:{})},`${requestId}:direction`,source);
    controlRevision=direction.task.revision;
    ({task,progress,approvals=[]}=await api.dispatch('nethra.get',{id:task.id},`${requestId}:get-after-direction`,source));
  }
  if(continuation&&task.status!==continuation.status)return describe(task,progress);
  const control = async action => (await api.dispatch("nethra.control", { id: task.id, action, revision: controlRevision }, requestId, source)).task;
  if (instruction.command === "pause") { if (task.status === "PAUSED") return "That task is already paused."; const updated = await control("pause"); return `Paused “${String(updated.goal).slice(0, 120)}”. Say ‘continue that task’ to resume it.`; }
  if (instruction.command === "cancel") { await control("cancel"); return `Cancelled “${String(task.goal).slice(0, 120)}”. Its evidence and outputs stay in Tasks.`; }
  if (instruction.command === "redirect") { const updated = (await api.dispatch("nethra.redirect", { id: task.id, instruction: instruction.direction, revision: task.revision }, requestId, source)).task; return `Redirected “${String(updated.goal).slice(0, 120)}”: ${instruction.direction}\nCompleted steps and evidence are kept; I'll re-plan from your new direction on the next run.`; }
  // continue / wake
  if (task.status === "PAUSED") { const updated = await control("resume"); return `Resumed “${String(updated.goal).slice(0, 120)}” (${updated.status.toLowerCase().replaceAll("_", " ")}).`; }
  if (task.status === "SLEEPING") { await control("wake"); return `Checking “${String(task.goal).slice(0, 120)}” now. I'll report back here when it settles.`; }
  const continued=await continueReviewedTask({api,task,approvals,requestId,source});
  if(continued)return continued;
  if (task.status === "WAITING_FOR_USER" || task.status === "BLOCKED") return progress?.waitingFor?.kind === "approval" ? continuationGate(task,approvals,progress) : `${describe(task, progress)}\n\nAnswer that in Tasks, or ‘redirect that task to …’ here.`;
  return `It's already ${task.status === "ACTIVE" ? "running" : "queued"}.\n${describe(task, progress)}`;
}

async function handleNethraChat({ api, content, conversationId = null, requestId = crypto.randomUUID(), source = "desktop" }) {
  let instruction = parseNethraChat(content);
  if (!instruction && conversationId) {
    const bare = parseTaskChatControl(content);
    if (bare) {
      const objectives = await listForReference(api,`${requestId}:linked`,source);
      const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const named=objectives.filter(task=>normalize(task.goal).length>=4&&normalize(content).includes(normalize(task.goal)));
      if(named.length===1)instruction={...bare,topic:named[0].goal};
      else if(named.length>1)return `Which task do you mean? ${named.slice(0,3).map(task=>String(task.goal).slice(0,120)).join(', ')}.`;
      else if (objectives.some(task => task.conversationId === conversationId)) instruction = bare;
    }
  }
  if (!instruction) return null;
  if (instruction.action === "clarify") return instruction.text;
  if (instruction.action === "keep_only") {
    const { objectives } = await api.dispatch("nethra.list", {}, `${requestId}:list`, source);
    const open = objectives.filter(task => !FINISHED.has(task.status));
    const normalized = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const topic = normalized(instruction.topic);
    const matches = open.filter(task => normalized(task.goal) === topic);
    const candidates = matches.length ? matches : open.filter(task => normalized(task.goal).includes(topic) && topic.length >= 4);
    if (candidates.length !== 1) return `I couldn't identify one unfinished task named “${instruction.topic}”. No tasks were changed. Open Tasks to check the exact title.`;
    const kept = candidates[0];
    const cancelled = [];
    for (const item of open.filter(task => task.id !== kept.id)) {
      const { task } = await api.dispatch("nethra.get", { id: item.id }, `${requestId}:get:${item.id}`, source);
      await api.dispatch("nethra.control", { id: item.id, action: "cancel", revision: task.revision }, `${requestId}:cancel:${item.id}`, source);
      cancelled.push(String(item.goal).slice(0, 120));
    }
    const outcome = instruction.continue
      ? await handleReference({ api, instruction: { command: "continue", topic: kept.goal }, conversationId, requestId: `${requestId}:keep`, source })
      : `Kept “${String(kept.goal).slice(0, 120)}” (${kept.status.toLowerCase().replaceAll("_", " ")}).`;
    return `${cancelled.length ? `Stopped ${cancelled.map(goal => `“${goal}”`).join(", ")}. ` : ""}${outcome}`;
  }
  if (instruction.action === "help") return "Nethra agent mode is available. Say ‘Nethra, research <topic>’ or ‘Start a Nethra goal: <objective>’ to create durable work. Say ‘Nethra status’ to see saved objectives, or ‘continue / pause / cancel / check that task now’ to steer the one in this chat. Use Tasks for plans, evidence and approvals.";
  if (instruction.action === "reference") return handleReference({ api, instruction, conversationId, requestId, source });
  if (instruction.action === "list") {
    const { objectives } = await api.dispatch("nethra.list", {}, requestId, source);
    return objectives.length ? objectives.slice(0, 10).map(task => `${task.id} — ${task.status}: ${task.goal}${task.nextWakeAt ? ` (next wake ${new Date(task.nextWakeAt).toLocaleString()})` : ""}`).join("\n") : "Nethra has no saved objectives yet. Say ‘Start a Nethra goal: <objective>’ to begin.";
  }
  if (instruction.action === "create") {
    const { task } = await api.dispatch("nethra.create", { goal: instruction.goal, successCriteria: instruction.goal, mode:instruction.mode, persistent: true, continuous:true,conversationId,...(instruction.model?{model:instruction.model}:{}) }, requestId, source);
    return `Nethra saved objective ${task.id}: ${task.goal}. Status: ${task.status}. I’ll continue it on the Windows host; open Nethra to review the plan, progress and any approval requests.`;
  }
  const { task: current } = await api.dispatch("nethra.get", { id: instruction.id }, `${requestId}:get`, source);
  const { task } = await api.dispatch("nethra.control", { id: instruction.id, action: instruction.command, revision: current.revision }, requestId, source);
  return `Nethra objective ${task.id} is ${task.status}.`;
}

module.exports = { parseNethraChat, parseReference, parseTaskChatControl, correctTaskClaims, resolveObjective, handleNethraChat };
