"use strict";
(function(root) {
  function messageParts(value) {
    const text = String(value || ""), parts = [];
    const pattern = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parts.push({text:text.slice(cursor, match.index)});
      let url = null;
      if (match[2]) { try { const parsed = new URL(match[2]); if (!parsed.username && !parsed.password) url = parsed.href; } catch {} }
      parts.push(url ? {text:match[1], url} : {text:match[0]});
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parts.push({text:text.slice(cursor)});
    return parts;
  }
  // Older task updates are stored as plain text. Recognize only the host's
  // progress-report format and stop at the first non-action line, so next steps
  // and requests for owner input never disappear into the disclosure.
  function taskActionLog(value) {
    const text = String(value || "");
    if (!text.startsWith('Progress on "')) return null;
    const heading = /^Recorded actions:\r?\n/m.exec(text);
    if (!heading) return null;
    const start = heading.index + heading[0].length;
    let end = start, count = 0;
    while (end < text.length) {
      const action = /^•[ \t]+\S[^\r\n]*(?:\r?\n|$)/.exec(text.slice(end));
      if (!action) break;
      end += action[0].length;
      count++;
    }
    return count ? {before:text.slice(0, heading.index), actions:text.slice(start, end), after:text.slice(end), count} : null;
  }
  function renderInlineContent(target, content) {
    target.replaceChildren(...messageParts(content).map(part => {
      if (!part.url) return document.createTextNode(part.text);
      const link = document.createElement("a");
      link.textContent = part.text; link.href = part.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      return link;
    }));
  }
  const expandedTaskLogs = new Set();
  function renderMessageContent(target, content, {taskActions = false, messageKey = null} = {}) {
    const log = taskActions ? taskActionLog(content) : null;
    if (!log) { renderInlineContent(target, content); return; }
    const before = document.createElement("div"), after = document.createElement("div");
    renderInlineContent(before, log.before.trimEnd());
    renderInlineContent(after, log.after);
    const details = document.createElement("details"), summary = document.createElement("summary"), actions = document.createElement("div");
    details.className = "task-action-log";
    summary.textContent = `Recorded actions (${log.count})`;
    actions.className = "task-action-content";
    renderInlineContent(actions, log.actions.trimEnd());
    details.append(summary, actions);
    details.open = messageKey !== null && expandedTaskLogs.has(messageKey);
    details.addEventListener("toggle", () => {
      if (messageKey === null || !details.isConnected) return;
      if (details.open) expandedTaskLogs.add(messageKey);
      else expandedTaskLogs.delete(messageKey);
    });
    // Hidden details are excluded from native text selection. Copy the original
    // message so the owner can still share or save the complete task update.
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "task-message-copy"; copy.textContent = "Copy message";
    copy.setAttribute("aria-label", "Copy full task update, including recorded actions");
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(String(content || "")); copy.textContent = "Copied"; }
      catch { copy.textContent = "Copy failed"; }
    };
    target.replaceChildren(before, details, after, copy);
  }
  const seconds = ms => `${(Number(ms) / 1000).toFixed(Number(ms) < 10000 ? 2 : 1)}s`;
  function speedLine(value) {
    return Number.isFinite(value?.tokensPerSecond) && value.tokensPerSecond > 0 ? `${Number(value.tokensPerSecond).toFixed(1)} tok/s` : "";
  }
  // Verbose run metrics shown under a reply. Generation speed comes from the
  // model host's own eval timing, so it is omitted when it was not measured
  // rather than being computed from Junction's wall clock.
  function telemetryLine(value) {
    if (!value || typeof value !== "object") return "";
    const parts = [];
    if (value.model) parts.push(String(value.model));
    if (speedLine(value)) parts.push(speedLine(value));
    if (Number(value.generatedTokens) > 0) parts.push(`${Number(value.generatedTokens).toLocaleString()} out`);
    if (Number(value.inputTokens) > 0) parts.push(`${Number(value.inputTokens).toLocaleString()} in`);
    if (Number(value.durationMs) > 0) parts.push(`${seconds(value.durationMs)} total`);
    if (Number(value.loadMs) > 0) parts.push(`${seconds(value.loadMs)} model load`);
    if (Number(value.evalMs) > 0) parts.push(`${seconds(value.evalMs)} generating`);
    if (Number(value.modelCalls) > 0) parts.push(`${value.modelCalls} model call${Number(value.modelCalls) === 1 ? "" : "s"}`);
    if (Number(value.toolsExecuted) > 0) parts.push(`${value.toolsExecuted} tool${Number(value.toolsExecuted) === 1 ? "" : "s"}${Array.isArray(value.toolNames) && value.toolNames.length ? ` (${value.toolNames.join(", ")})` : ""}`);
    else if (Number(value.toolCalls) > 0) parts.push(`${value.toolCalls} tool request${Number(value.toolCalls) === 1 ? "" : "s"}; none executed`);
    if (value.thinkingState === "reported" && Number(value.thinkingCharacters) > 0) parts.push(`${Number(value.thinkingCharacters).toLocaleString()} thinking chars`);
    else if (value.thinkingState === "enabled_no_output") parts.push("thinking on; none reported");
    else if (value.thinkingState === "off") parts.push("thinking off");
    return parts.join(" · ");
  }
  if (typeof module !== "undefined") module.exports = {messageParts, taskActionLog, telemetryLine, speedLine};
  else { root.renderMessageContent = renderMessageContent; root.telemetryLine = telemetryLine; root.speedLine = speedLine; }
})(globalThis);
