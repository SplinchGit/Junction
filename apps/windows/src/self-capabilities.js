'use strict';

// Only questions about the assistant itself. An actual task ("schedule work to research
// the weather") or explicit request for outside research must continue through normal routing.
function isSelfCapabilityQuestion(value) {
  const clauses = String(value || '').toLowerCase().split(/[.!?]+/).map(s => s.trim().replace(/^(?:so|well|and)[, ]+/, '')).filter(Boolean);
  if (!clauses.length) return false;
  const subject = '(?:agentic mode|tools|capabilities|scheduling|background work|persistent objectives)';
  return clauses.every(clause =>
    new RegExp(`^(?:what do you know about|tell me about|explain|what are) your ${subject}(?: (?:or|and) ${subject})?$`).test(clause) ||
    /^(?:what tools do you have|what can you do|what are you able to do|do you have (?:web search|tools|agentic mode))$/.test(clause) ||
    /^(?:can you|are you able to|you can) (?:schedule (?:work|tasks)|work in the background|create persistent objectives|use tools|implement code)(?:[, ]+(?:yes|right))?$/.test(clause)
  );
}

function capabilityAnswer(names, surface = 'desktop') {
  const tools = new Set(names);
  const lines = ["I'm Nethra, running through Junction on your Windows PC" + (surface.startsWith('android') ? ', with this conversation coming from Android.' : '.')];
  if (tools.has('start_objective')) lines.push('I can create persistent objectives with start_objective. The host scheduler can revisit authorised work in the background, retain its progress across restarts, and report back here even when your phone is closed. This chat tool accepts a goal and success criteria; it does not expose an exact-time scheduling parameter. While working on an objective, I can inspect host diagnostics and measured performance from saved local timings. If self-improvement is enabled for that objective on Windows, I can ask the locally signed-in Codex and Claude advisors for read-only advice while your live plan usage allows, and run measured before-and-after experiments. Those objective tools are separate from this chat.');
  else lines.push('Creating or scheduling persistent objectives is not available through the tools connected to this turn.');
  if (tools.has('list_objectives')) lines.push('I can inspect actual objective status with list_objectives.');
  if (tools.has('web_search')) lines.push('I can research outside facts with web_search. Web pages are not evidence of my own capabilities.');
  if (tools.has('delegate_to_codex')) lines.push('I can prepare scoped coding work through delegate_to_codex; changes still follow the approval controls.');
  if (tools.has('start_objective')) lines.push('When code work is enabled for an objective on Windows, its runner can use propose_code_work after Codex reviews the exact proposal. The owner must start implementation in Work Activity, then review and apply the verified patch. I cannot call that objective tool directly from this chat.');
  lines.push("I haven't created or checked any task just by answering this question. External sending and phone actions are not enabled by these PC tools; current connectivity and approvals still constrain execution.");
  return lines.join('\n\n');
}

function capabilityResult(names, request) {
  return {content:capabilityAnswer(names, request.surface), intent:'question', model:request.model,
    usage:{prompt_tokens:0,completion_tokens:0}, research:null, toolCalls:0, toolsExecuted:0,
    toolNames:[], iterations:0, thinkingCharacters:0, thinkingState:'off', durationMs:0};
}

module.exports = {isSelfCapabilityQuestion, capabilityAnswer, capabilityResult};
