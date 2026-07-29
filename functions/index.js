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
  return {
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview",
    modalities: ["text", "audio"],
    voice: "alloy",
    turn_detection: {
      type: "server_vad",
      create_response: true,
    },
    instructions: BASE_INSTRUCTIONS,
    tool_choice: "auto",
    tools: [
      {
        type: "function",
        name: "set_speech_mode",
        description: "Enable or disable speech mode for the current conversation.",
        parameters: {
          type: "object",
          properties: {
            conversationId: { type: "string" },
            enabled: { type: "boolean" }
          },
          required: ["enabled"]
        }
      },
      {
        type: "function",
        name: "set_feed_filter",
        description: "Enable or disable a package from the feed.",
        parameters: {
          type: "object",
          properties: {
            packageName: { type: "string" },
            enabled: { type: "boolean" }
          },
          required: ["packageName", "enabled"]
        }
      },
      {
        type: "function",
        name: "archive_feed_item",
        description: "Archive a feed item by id.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" }
          },
          required: ["id"]
        }
      },
      {
        type: "function",
        name: "check_for_updates",
        description: "Check for app updates.",
        parameters: {
          type: "object",
          properties: {}
        }
      },
      {
        type: "function",
        name: "set_setting",
        description: "Update a settings key.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: { type: "string" }
          },
          required: ["key", "value"]
        }
      }
    ]
  };
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

  const offerSdp = typeof req.body === "string" ? req.body.trim() : "";
  if (!offerSdp) {
    res.status(400).json({ error: "Missing SDP offer" });
    return;
  }

  const payload = {
    sdp: offerSdp,
    session: buildSessionConfig()
  };

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
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

    const payload = await response.json();
    const answerSdp =
      payload.answer ||
      payload.sdp ||
      (payload.data ? payload.data.answer : "");
    if (!answerSdp) {
      res.status(502).json({ error: "Missing answer SDP" });
      return;
    }
    res.set("Content-Type", "text/plain");
    res.status(200).send(answerSdp);
  } catch (err) {
    res.status(500).json({ error: "Realtime exchange failed" });
  }
});

exports.realtimeSdpExchange = onRequest({ secrets: [openAiKeySecret] }, app);

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

exports.realtimeClientSecret = onRequest({ secrets: [openAiKeySecret] }, clientSecretApp);
