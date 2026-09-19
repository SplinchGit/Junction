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
  function renderMessageContent(target, content) {
    target.replaceChildren(...messageParts(content).map(part => {
      if (!part.url) return document.createTextNode(part.text);
      const link = document.createElement("a");
      link.textContent = part.text; link.href = part.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      return link;
    }));
  }
  if (typeof module !== "undefined") module.exports = {messageParts};
  else root.renderMessageContent = renderMessageContent;
})(globalThis);
