"use strict";

const { CAPABILITIES, Decision, Provenance, makeProposal } = require("./protocol");
const { discoverOllama } = require("./ollama");

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function createHandler({ token, audit, inspectContext, ollamaUrl }) {
  const proposals = new Map();
  return async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "unauthorized" });
      const url = new URL(request.url, "http://localhost");
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
