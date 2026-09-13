"use strict";

const { CAPABILITIES, Decision, Provenance, makeProposal } = require("./protocol");
const { discoverOllama } = require("./ollama");

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readBody(request, maxBytes = 16 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function writeUpstreamHeaders(response, upstream) {
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
}

async function proxyOllamaChat(request, response, ollamaUrl, fetchImpl) {
  const payload = await readBody(request, 1024 * 1024);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.model !== "string" || !Array.isArray(payload.messages)) {
    return json(response, 400, { error: "invalid_chat_request" });
  }
  const upstream = await fetchImpl(`${ollamaUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  writeUpstreamHeaders(response, upstream);
  if (!upstream.body) return response.end();
  for await (const chunk of upstream.body) response.write(chunk);
  response.end();
}

async function proxyOllamaModels(response, ollamaUrl, fetchImpl) {
  const upstream = await fetchImpl(`${ollamaUrl.replace(/\/$/, "")}/v1/models`);
  writeUpstreamHeaders(response, upstream);
  if (!upstream.body) return response.end();
  for await (const chunk of upstream.body) response.write(chunk);
  response.end();
}

function createHandler({ token, audit, inspectContext, ollamaUrl = "http://127.0.0.1:11434", fetchImpl = fetch }) {
  const proposals = new Map();
  return async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      // These two routes are the only model-facing surface. The server itself is
      // loopback-only; a private overlay may forward to it. Privileged companion
      // capabilities below still require the ephemeral bearer token and are never
      // available to an Android client or the overlay.
      if (request.method === "GET" && url.pathname === "/v1/models") return await proxyOllamaModels(response, ollamaUrl, fetchImpl);
      if (request.method === "POST" && url.pathname === "/v1/chat/completions") return await proxyOllamaChat(request, response, ollamaUrl, fetchImpl);
      if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "unauthorized" });
      if (request.method === "GET" && url.pathname === "/v1/health") return json(response, 200, { status: "ok", localOnly: true, schemaVersion: 1 });
      if (request.method === "GET" && url.pathname === "/v1/capabilities") return json(response, 200, { capabilities: Object.values(CAPABILITIES) });
      if (request.method === "GET" && url.pathname === "/v1/providers/ollama") return json(response, 200, await discoverOllama(ollamaUrl));
      if (request.method === "POST" && url.pathname === "/v1/proposals") {
        const result = makeProposal(await readBody(request));
        if (!result.ok) {
          audit.append({ event: "proposal_blocked", capability: null, triggerProvenance: "UNKNOWN", decision: Decision.BLOCKED, reason: result.reason });
          return json(response, 403, result);
        }
        proposals.set(result.proposal.id, result.proposal);
        audit.append({ proposalId: result.proposal.id, event: "proposal_created", capability: result.proposal.capability, triggerProvenance: Provenance.OWNER, decision: result.proposal.decision });
        return json(response, 201, result);
      }
      const match = request.method === "POST" && url.pathname.match(/^\/v1\/proposals\/([0-9a-f-]+)\/execute$/i);
      if (match) {
        const proposal = proposals.get(match[1]);
        if (!proposal) return json(response, 404, { error: "proposal_not_found" });
        if (proposal.decision !== Decision.AUTO) return json(response, 409, { error: "confirmation_required" });
        proposals.delete(proposal.id);
        try {
          const output = await inspectContext(CAPABILITIES[proposal.capability].limits);
          audit.append({ proposalId: proposal.id, event: "execution_completed", capability: proposal.capability, triggerProvenance: proposal.triggerProvenance, outputProvenance: Provenance.UNTRUSTED, decision: Decision.AUTO, outcome: "success" });
          return json(response, 200, { proposalId: proposal.id, outcome: "success", output });
        } catch (error) {
          audit.append({ proposalId: proposal.id, event: "execution_completed", capability: proposal.capability, triggerProvenance: proposal.triggerProvenance, decision: Decision.AUTO, outcome: "failure", reason: error.message });
          return json(response, 503, { error: "inspection_failed", message: error.message });
        }
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) { return json(response, 400, { error: "invalid_request", message: error.message }); }
  };
}

module.exports = { createHandler };
