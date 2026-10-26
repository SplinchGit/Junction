// How long a chat is getting, and how much of it Nethra actually reads. Token counts are
// estimates (about 3.5 characters per token for this model's English and JSON); the last
// reply's prompt size, when recorded, is Ollama's own measured count.
(function (root) {
  // Mirrors canonicalHistory in src/assistant-context.js; a test keeps the two identical.
  const HISTORY_CHARS = 3500, HISTORY_MESSAGES = 12, MESSAGE_CHARS = 2000, CONTEXT_TOKENS = 8192;
  const estimate = text => Math.ceil(String(text || "").length / 3.5);

  function chatTokenSummary(messages) {
    const items = (Array.isArray(messages) ? messages : []).filter(item => ["user", "assistant"].includes(item?.role) && typeof item.content === "string" && item.content.trim());
    const total = items.reduce((sum, item) => sum + estimate(item.content.trim()), 0);
    let remaining = HISTORY_CHARS, seenMessages = 0, seenChars = 0;
    for (let i = items.length - 1; i >= 0 && remaining > 0 && seenMessages < HISTORY_MESSAGES; i--) {
      const length = Math.min(items[i].content.trim().length, remaining, MESSAGE_CHARS);
      seenMessages++; seenChars += length; remaining -= length;
    }
    const measured = [...items].reverse().find(item => item.role === "assistant" && Number(item.telemetry?.inputTokens) > 0);
    return { total, messages: items.length, seenMessages, seenTokens: Math.ceil(seenChars / 3.5), lastPromptTokens: measured ? Number(measured.telemetry.inputTokens) : null, contextTokens: CONTEXT_TOKENS };
  }

  const compact = value => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
  function chatTokenLine(messages) {
    const summary = chatTokenSummary(messages);
    if (!summary.messages) return "";
    const parts = [`≈${compact(summary.total)} tokens in this chat`];
    parts.push(summary.seenMessages < summary.messages ? `Nethra reads the latest ≈${compact(summary.seenTokens)} (${summary.seenMessages} of ${summary.messages} messages)` : "Nethra reads all of it");
    if (summary.lastPromptTokens) parts.push(`last reply's prompt ${summary.lastPromptTokens.toLocaleString()} of ${summary.contextTokens.toLocaleString()}`);
    return parts.join(" · ");
  }

  const api = { chatTokenSummary, chatTokenLine, HISTORY_CHARS, HISTORY_MESSAGES, MESSAGE_CHARS };
  if (typeof module !== "undefined") module.exports = api;
  else { root.chatTokenLine = chatTokenLine; }
})(typeof window !== "undefined" ? window : globalThis);
