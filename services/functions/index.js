const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

admin.initializeApp();

const openAiKeySecret = defineSecret("OPENAI_API_KEY");

const app = express();
app.use(cors({ origin: true }));
app.use(express.text({ type: "*/*" }));

function getOpenAiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    return openAiKeySecret.value();
  } catch (_err) {
    return "";
  }
}

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || "";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function syncAdminClaim(decodedToken) {
  const adminEmail = normalizeEmail(getAdminEmail());
  if (!adminEmail) {
    return { isAdmin: false, synced: false };
  }
  const userEmail = normalizeEmail(decodedToken.email);
  const shouldBeAdmin = userEmail.length > 0 && userEmail === adminEmail;
  const tokenHasAdmin = Boolean(decodedToken.admin);
  if (shouldBeAdmin === tokenHasAdmin) {
    return { isAdmin: shouldBeAdmin, synced: false };
  }
  const userRecord = await admin.auth().getUser(decodedToken.uid);
  const claims = userRecord.customClaims || {};
  const hasAdmin = Boolean(claims.admin);
  if (shouldBeAdmin === hasAdmin) {
    return { isAdmin: shouldBeAdmin, synced: false };
  }
  const nextClaims = { ...claims };
  if (shouldBeAdmin) {
    nextClaims.admin = true;
  } else {
    delete nextClaims.admin;
  }
  await admin.auth().setCustomUserClaims(decodedToken.uid, nextClaims);
  return { isAdmin: shouldBeAdmin, synced: true };
}

const BASE_INSTRUCTIONS = [
  "You are JunctionGPT, a calm local-first assistant.",
  "When you propose any state-changing action, always use tools and wait for user confirmation.",
  "Never assume permission to apply changes; the user must press Apply.",
  "Keep responses concise, supportive, and practical."
].join("\n");

function buildSessionConfig() {
  // Tool schemas are authored once, client-side, in ToolRegistry.kt -- the Android
  // client overwrites this via a session.update sent immediately after connect
  // (see RealtimeSessionManager.kt's sendToolDefinitions), so ToolRegistry stays
  // the single source of truth. Standing the session up with an empty tool list
  // here (rather than a hand-maintained duplicate that silently drifts out of
  // sync, as the previous ~25-line list of 5 stale tools had already done) is
  // intentional, matching services/server/index.js's equivalent function.
  return {
    type: "realtime",
    // gpt-4o-realtime-preview was retired (404 model_not_found); the current
    // realtime model is gpt-realtime-1.5. Override via OPENAI_REALTIME_MODEL.
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-1.5",
    modalities: ["text", "audio"],
    voice: "alloy",
    turn_detection: {
      type: "server_vad",
      create_response: true,
    },
    instructions: BASE_INSTRUCTIONS,
    tool_choice: "none",
    tools: []
  };
}

/**
 * Reads a plain-text request body. On 2nd-gen (Cloud Run) firebase-functions
 * pre-parses the body before Express runs, so a non-JSON content type like
 * application/sdp arrives as a Buffer and express.text() skips it -- meaning a
 * plain `typeof req.body === "string"` check silently drops a valid offer.
 */
function readTextBody(req) {
  const body = req.body;
  if (typeof body === "string") return body.trim();
  if (Buffer.isBuffer(body)) return body.toString("utf8").trim();
  return "";
}

async function verifyAuth(req, res, next) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  try {
    req.user = await admin.auth().verifyIdToken(match[1]);
    try {
      const adminState = await syncAdminClaim(req.user);
      req.user.isAdmin = adminState.isAdmin;
    } catch (err) {
      console.warn("admin sync failed", err);
    }
    next();
  } catch (err) {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/", verifyAuth, async (req, res) => {
  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  const offerSdp = readTextBody(req);
  if (!offerSdp) {
    console.error("Missing SDP offer", {
      bodyType: typeof req.body,
      isBuffer: Buffer.isBuffer(req.body),
      contentType: req.get("Content-Type") || ""
    });
    res.status(400).json({ error: "Missing SDP offer" });
    return;
  }

  // /v1/realtime/calls takes the raw SDP offer as an application/sdp body --
  // session config rides along as a `session` query param, and the answer comes
  // back as plain SDP text (not JSON).
  // `model` must ride on the query string -- the API rejects the call with
  // missing_model if it's only present inside the session JSON.
  const session = buildSessionConfig();
  const callUrl =
    "https://api.openai.com/v1/realtime/calls?model=" +
    encodeURIComponent(session.model) +
    "&session=" +
    encodeURIComponent(JSON.stringify(session));

  try {
    // SDP is a line-oriented format whose parser expects a terminating newline;
    // without it the offer fails to unmarshal with an EOF error.
    const offerBody = offerSdp.endsWith("\n") ? offerSdp : `${offerSdp}\r\n`;
    const response = await fetch(callUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/sdp"
      },
      body: offerBody
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(
        "OpenAI realtime rejected offer",
        response.status,
        errText,
        "offerChars=" + offerSdp.length,
        "offerHead=" + JSON.stringify(offerSdp.slice(0, 60))
      );
      res.status(502).json({ error: "OpenAI error", detail: errText });
      return;
    }

    const answerSdp = (await response.text()).trim();
    if (!answerSdp) {
      console.error("Empty answer SDP from OpenAI");
      res.status(502).json({ error: "Missing answer SDP" });
      return;
    }
    res.set("Content-Type", "text/plain");
    res.status(200).send(answerSdp);
  } catch (err) {
    console.error("Realtime exchange failed", err && (err.stack || err.message || err));
    res.status(500).json({ error: "Realtime exchange failed", detail: String(err && (err.message || err)) });
  }
});

// invoker: "public" — 2nd-gen functions default to IAM-gated Cloud Run, which
// rejects our Firebase ID tokens as invalid *IAM* tokens before the request
// ever reaches verifyAuth. Auth is enforced in-app by verifyAuth below, which
// still 401s anything without a valid Firebase ID token.
exports.realtimeSdpExchange = onRequest({ secrets: [openAiKeySecret], invoker: "public" }, app);

const chatApp = express();
chatApp.use(cors({ origin: true }));
chatApp.use(express.json({ limit: "1mb" }));

function normalizeRole(role) {
  if (role === "system" || role === "assistant" || role === "user") {
    return role;
  }
  return "user";
}

function buildChatMessages(body) {
  const messages = [];
  if (Array.isArray(body.messages)) {
    body.messages.forEach((msg) => {
      if (!msg) return;
      const role = normalizeRole(String(msg.role || "user").toLowerCase());
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content.trim().length === 0) return;
      messages.push({ role, content });
    });
  }
  const finalMessage = typeof body.message === "string" ? body.message.trim() : "";
  if (finalMessage) {
    messages.push({ role: "user", content: finalMessage });
  }
  return messages;
}

function extractResponseText(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const output = Array.isArray(data.output) ? data.output : [];
  const chunks = [];
  output.forEach((item) => {
    if (!item || item.type !== "message") return;
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (!part) return;
      if ((part.type === "output_text" || part.type === "text") && part.text) {
        chunks.push(String(part.text));
      }
    });
  });
  return chunks.join("").trim();
}

chatApp.post("/", verifyAuth, async (req, res) => {
  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  const input = buildChatMessages(req.body || {});
  if (input.length < 1) {
    res.status(400).json({ error: "Missing chat messages" });
    return;
  }

  const requestedModel =
    typeof req.body?.model === "string" ? req.body.model.trim() : "";
  const model = requestedModel || process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini";
  const payload = {
    model,
    input,
    instructions: BASE_INSTRUCTIONS
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: "OpenAI error", detail: errText });
      return;
    }

    const data = await response.json();
    const reply = extractResponseText(data);
    if (!reply) {
      res.status(502).json({ error: "Missing reply" });
      return;
    }
    res.status(200).json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Chat request failed" });
  }
});

exports.chat = onRequest({ secrets: [openAiKeySecret] }, chatApp);

const clientSecretApp = express();
clientSecretApp.use(cors({ origin: true }));
clientSecretApp.use(express.json({ limit: "64kb" }));

clientSecretApp.post("/", verifyAuth, async (req, res) => {
  const openAiKey = getOpenAiKey();
  if (!openAiKey) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return;
  }

  const ttl = Math.max(
    60,
    Math.min(parseInt(process.env.OPENAI_REALTIME_CLIENT_SECRET_TTL || "600", 10) || 600, 3600)
  );

  const payload = {
    expires_after: {
      anchor: "created_at",
      seconds: ttl
    },
    session: buildSessionConfig()
  };

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: "OpenAI error", detail: errText });
      return;
    }

    const data = await response.json();
    const value = data?.client_secret?.value || data?.value;
    if (!value) {
      res.status(502).json({ error: "Missing client secret" });
      return;
    }
    res.status(200).json({
      client_secret: value,
      expires_at: data?.client_secret?.expires_at || data?.expires_at || null
    });
  } catch (err) {
    res.status(500).json({ error: "Client secret mint failed" });
  }
});

exports.realtimeClientSecret = onRequest({ secrets: [openAiKeySecret], invoker: "public" }, clientSecretApp);
