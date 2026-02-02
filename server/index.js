const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const admin = require("firebase-admin");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8787", 10);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

function initFirebase() {
  if (admin.apps.length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return;
  }
  admin.initializeApp();
}

initFirebase();
const firestore = admin.firestore();

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function syncAdminClaim(decodedToken) {
  const adminEmail = normalizeEmail(ADMIN_EMAIL);
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

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const APP_REDIRECT_URI = process.env.APP_REDIRECT_URI || "junction://oauth-callback";

const OAUTH_PROVIDERS = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"],
    usesBasicAuth: false
  },
  slack: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: [
      "channels:read",
      "channels:history",
      "groups:read",
      "groups:history",
      "im:read",
      "im:history",
      "mpim:read",
      "mpim:history",
      "users:read",
      "chat:write"
    ],
    usesBasicAuth: false
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["read:org", "repo", "notifications"],
    usesBasicAuth: false
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    usesBasicAuth: true
  }
};

function getProviderConfig(provider) {
  return OAUTH_PROVIDERS[provider] || null;
}

function getProviderCredentials(provider) {
  const key = provider.toUpperCase();
  const clientId = process.env[`${key}_CLIENT_ID`];
  const clientSecret = process.env[`${key}_CLIENT_SECRET`];
  return { clientId, clientSecret };
}

function buildRedirectUri(provider) {
  return `${PUBLIC_BASE_URL}/integrations/${provider}/callback`;
}

function buildAuthorizeUrl(provider, clientId, state) {
  const cfg = getProviderConfig(provider);
  const redirectUri = buildRedirectUri(provider);
  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("response_type", "code");
  params.set("state", state);
  if (provider === "notion") {
    params.set("owner", "user");
  }
  if (provider === "google") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  if (cfg.scopes && cfg.scopes.length > 0) {
    const delimiter = provider === "slack" ? "," : " ";
    params.set("scope", cfg.scopes.join(delimiter));
  }
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

function createState() {
  return crypto.randomBytes(24).toString("hex");
}

async function storeOAuthState(uid, provider, state) {
  await firestore.collection("oauth_states").doc(state).set({
    uid,
    provider,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function consumeOAuthState(state, provider) {
  const ref = firestore.collection("oauth_states").doc(state);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.provider !== provider) return null;
  await ref.delete();
  return data.uid || null;
}

async function saveIntegrationToken(uid, provider, tokenData) {
  await firestore
    .collection("users")
    .doc(uid)
    .collection("integrations")
    .doc(provider)
    .set(
      {
        provider,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...tokenData
      },
      { merge: true }
    );
}

async function getIntegrationToken(uid, provider) {
  const snap = await firestore
    .collection("users")
    .doc(uid)
    .collection("integrations")
    .doc(provider)
    .get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

async function updateIntegrationToken(uid, provider, updates) {
  await firestore
    .collection("users")
    .doc(uid)
    .collection("integrations")
    .doc(provider)
    .set(updates, { merge: true });
}

async function refreshGoogleTokenIfNeeded(uid, tokenData) {
  if (!tokenData || !tokenData.refreshToken) return tokenData;
  if (!tokenData.expiresAt) return tokenData;
  if (tokenData.expiresAt > Date.now() + 60_000) return tokenData;

  const { clientId, clientSecret } = getProviderCredentials("google");
  if (!clientId || !clientSecret) {
    return tokenData;
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("refresh_token", tokenData.refreshToken);
  body.set("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    return tokenData;
  }

  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : tokenData.expiresAt;
  const updated = {
    ...tokenData,
    accessToken: data.access_token || tokenData.accessToken,
    expiresAt
  };
  await updateIntegrationToken(uid, "google", {
    accessToken: updated.accessToken,
    expiresAt: updated.expiresAt
  });
  return updated;
}

async function upsertFeedItem(uid, item) {
  const now = Date.now();
  const docId = item.id;
  const payload = {
    id: docId,
    source: item.source,
    packageName: null,
    category: item.category,
    title: item.title,
    body: item.body || null,
    timestamp: item.timestamp || now,
    priority: item.priority || 5,
    status: "NEW",
    threadKey: item.threadKey || null,
    actionHint: item.actionHint || null,
    updatedAt: now
  };
  await firestore
    .collection("users")
    .doc(uid)
    .collection("feed_items")
    .doc(docId)
    .set(payload, { merge: true });
}

function formatTime(ts) {
  const date = new Date(ts);
  return date.toISOString();
}

function extractNotionTitle(result) {
  const props = result.properties || {};
  const candidates = ["Name", "Title", "title"];
  for (const key of candidates) {
    const prop = props[key];
    if (!prop) continue;
    const titleArr = prop.title || prop.rich_text || [];
    if (titleArr.length > 0 && titleArr[0].plain_text) {
      return titleArr[0].plain_text;
    }
  }
  if (result.title && Array.isArray(result.title) && result.title[0]?.plain_text) {
    return result.title[0].plain_text;
  }
  return "Notion update";
}

async function exchangeCode(provider, code) {
  const cfg = getProviderConfig(provider);
  const { clientId, clientSecret } = getProviderCredentials(provider);
  const redirectUri = buildRedirectUri(provider);
  if (!clientId || !clientSecret) {
    throw new Error(`Missing ${provider.toUpperCase()} client credentials`);
  }

  if (provider === "notion") {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error("Notion token exchange failed");
    }
    return data;
  }

  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  if (provider === "google") {
    body.set("grant_type", "authorization_code");
  }

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (provider === "github") {
    headers.Accept = "application/json";
  }

  const response = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: body.toString()
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error("Token exchange failed");
  }

  if (provider === "slack" && data.ok === false) {
    throw new Error("Slack token exchange failed");
  }

  return data;
}

function buildSessionConfig() {
  return {
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview",
    modalities: ["text", "audio"],
    voice: "alloy",
    turn_detection: {
      type: "server_vad",
      create_response: true
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
  if (process.env.DISABLE_AUTH === "true") {
    req.user = { uid: "local-dev", isAdmin: false };
    return next();
  }
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

function requireOpenAiKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    return false;
  }
  return true;
}

function normalizeRole(role) {
  if (role === "system" || role === "assistant" || role === "user") {
    return role;
  }
  return "user";
}

function buildChatMessages(body) {
  const messages = [{ role: "system", content: BASE_INSTRUCTIONS }];
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

function parseAnswer(payload) {
  if (!payload) return "";
  try {
    const json = JSON.parse(payload);
    return (
      json.answer ||
      json.sdp ||
      (json.data ? json.data.answer : "") ||
      payload
    ).trim();
  } catch (_err) {
    return String(payload).trim();
  }
}

const app = express();
app.use(cors({ origin: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post(
  "/integrations/:provider/start",
  verifyAuth,
  express.json({ limit: "64kb" }),
  async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const cfg = getProviderConfig(provider);
    if (!cfg) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }
    const { clientId } = getProviderCredentials(provider);
    if (!clientId) {
      res.status(500).json({ error: "Missing client ID" });
      return;
    }
    const state = createState();
    await storeOAuthState(req.user.uid, provider, state);
    const url = buildAuthorizeUrl(provider, clientId, state);
    res.status(200).json({ url });
  }
);

app.post(
  "/integrations/:provider/disconnect",
  verifyAuth,
  express.json({ limit: "64kb" }),
  async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const cfg = getProviderConfig(provider);
    if (!cfg) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }
    await firestore
      .collection("users")
      .doc(req.user.uid)
      .collection("integrations")
      .doc(provider)
      .delete();
    res.status(200).json({ ok: true });
  }
);

app.post(
  "/integrations/:provider/sync",
  verifyAuth,
  express.json({ limit: "256kb" }),
  async (req, res) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const cfg = getProviderConfig(provider);
    if (!cfg) {
      res.status(404).json({ error: "Unknown provider" });
      return;
    }

    try {
      const uid = req.user.uid;
      let tokenData = await getIntegrationToken(uid, provider);
      if (!tokenData) {
        res.status(404).json({ error: "Integration not connected" });
        return;
      }

      if (provider === "google") {
        tokenData = await refreshGoogleTokenIfNeeded(uid, tokenData);
      }

      if (provider === "google") {
        const accessToken = tokenData.accessToken;
        if (!accessToken) throw new Error("Missing access token");
        const now = new Date();
        const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const url =
          "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
          `?timeMin=${encodeURIComponent(timeMin)}` +
          `&timeMax=${encodeURIComponent(timeMax)}` +
          "&singleEvents=true&orderBy=startTime&maxResults=10";
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error("Calendar fetch failed");
        const data = await response.json();
        const items = Array.isArray(data.items) ? data.items : [];
        for (const event of items) {
          const start = event.start?.dateTime || event.start?.date;
          const startTs = start ? new Date(start).getTime() : Date.now();
          await upsertFeedItem(uid, {
            id: `gcal_${event.id}`,
            source: "Google Calendar",
            category: "WORK",
            title: event.summary || "Calendar event",
            body: start ? `Starts: ${start}` : null,
            timestamp: startTs,
            priority: 7,
            threadKey: event.id,
            actionHint: "open"
          });
        }
        res.status(200).json({ ok: true, count: items.length });
        return;
      }

      if (provider === "slack") {
        const slackToken = tokenData.userToken || tokenData.botToken || tokenData.accessToken;
        if (!slackToken) throw new Error("Missing Slack token");
        const listRes = await fetch(
          "https://slack.com/api/conversations.list?types=public_channel,private_channel,im,mpim&limit=10",
          { headers: { Authorization: `Bearer ${slackToken}` } }
        );
        const listData = await listRes.json();
        if (!listRes.ok || listData.ok === false) throw new Error("Slack list failed");
        const channels = listData.channels || [];
        let count = 0;
        for (const channel of channels.slice(0, 5)) {
          const historyRes = await fetch(
            `https://slack.com/api/conversations.history?channel=${channel.id}&limit=1`,
            { headers: { Authorization: `Bearer ${slackToken}` } }
          );
          const historyData = await historyRes.json();
          if (!historyRes.ok || historyData.ok === false) continue;
          const msg = (historyData.messages || [])[0];
          if (!msg || !msg.text) continue;
          const ts = Number(msg.ts || "0") * 1000;
          await upsertFeedItem(uid, {
            id: `slack_${channel.id}_${msg.ts}`,
            source: "Slack",
            category: "COMMUNITIES",
            title: `#${channel.name || "channel"}`,
            body: msg.text,
            timestamp: ts || Date.now(),
            priority: 6,
            threadKey: channel.id,
            actionHint: "open"
          });
          count += 1;
        }
        res.status(200).json({ ok: true, count });
        return;
      }

      if (provider === "github") {
        const token = tokenData.accessToken;
        if (!token) throw new Error("Missing GitHub token");
        const response = await fetch("https://api.github.com/notifications?per_page=20", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "Junction"
          }
        });
        if (!response.ok) throw new Error("GitHub fetch failed");
        const notifications = await response.json();
        let count = 0;
        for (const item of notifications) {
          await upsertFeedItem(uid, {
            id: `gh_${item.id}`,
            source: "GitHub",
            category: "PROJECTS",
            title: item.subject?.title || "GitHub notification",
            body: item.subject?.type || item.repository?.full_name || null,
            timestamp: item.updated_at ? new Date(item.updated_at).getTime() : Date.now(),
            priority: item.subject?.type === "PullRequest" ? 8 : 6,
            threadKey: item.repository?.full_name || null,
            actionHint: "open"
          });
          count += 1;
        }
        res.status(200).json({ ok: true, count });
        return;
      }

      if (provider === "notion") {
        const token = tokenData.accessToken;
        if (!token) throw new Error("Missing Notion token");
        const response = await fetch("https://api.notion.com/v1/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28"
          },
          body: JSON.stringify({
            page_size: 10,
            sort: { direction: "descending", timestamp: "last_edited_time" }
          })
        });
        if (!response.ok) throw new Error("Notion fetch failed");
        const data = await response.json();
        const results = data.results || [];
        let count = 0;
        for (const result of results) {
          const title = extractNotionTitle(result);
          const edited = result.last_edited_time || result.created_time;
          await upsertFeedItem(uid, {
            id: `notion_${result.id}`,
            source: "Notion",
            category: "PROJECTS",
            title,
            body: edited ? `Edited: ${formatTime(edited)}` : null,
            timestamp: edited ? new Date(edited).getTime() : Date.now(),
            priority: 5,
            threadKey: result.id,
            actionHint: "open"
          });
          count += 1;
        }
        res.status(200).json({ ok: true, count });
        return;
      }

      res.status(400).json({ error: "Unsupported provider" });
    } catch (err) {
      res.status(500).json({ error: err.message || "Sync failed" });
    }
  }
);

app.get("/integrations/:provider/callback", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const cfg = getProviderConfig(provider);
  if (!cfg) {
    res.status(404).send("Unknown provider");
    return;
  }
  const code = req.query.code ? String(req.query.code) : "";
  const state = req.query.state ? String(req.query.state) : "";
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }

  try {
    const uid = await consumeOAuthState(state, provider);
    if (!uid) {
      res.status(400).send("Invalid state");
      return;
    }

    const tokenData = await exchangeCode(provider, code);
    const expiresIn = tokenData.expires_in || tokenData.expiresIn;
    const expiresAt = expiresIn
      ? Date.now() + Number(expiresIn) * 1000
      : null;
    const payload = {
      accessToken: tokenData.access_token || tokenData.accessToken || null,
      refreshToken: tokenData.refresh_token || tokenData.refreshToken || null,
      scope: tokenData.scope || null,
      tokenType: tokenData.token_type || tokenData.tokenType || null,
      expiresAt
    };
    if (provider === "slack") {
      payload.botToken = tokenData.access_token || null;
      payload.userToken = tokenData.authed_user?.access_token || null;
      payload.teamId = tokenData.team?.id || null;
      payload.userId = tokenData.authed_user?.id || null;
    }
    if (provider === "github") {
      payload.scope = tokenData.scope || payload.scope;
    }
    await saveIntegrationToken(uid, provider, payload);

    const redirect = `${APP_REDIRECT_URI}?provider=${encodeURIComponent(
      provider
    )}&status=connected`;
    res.status(200).send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Junction Connected</title>
  </head>
  <body>
    <h2>Integration connected</h2>
    <p>You can return to the app.</p>
    <p><a href="${redirect}">Open Junction</a></p>
  </body>
</html>`);
  } catch (_err) {
    res.status(500).send("Integration failed");
  }
});

app.post(
  "/realtime/sdp-exchange",
  verifyAuth,
  express.text({ type: "*/*" }),
  async (req, res) => {
    if (!requireOpenAiKey(res)) return;

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
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        res.status(502).json({ error: "OpenAI error", detail: errText });
        return;
      }

      const data = await response.text();
      const answer = parseAnswer(data);
      if (!answer) {
        res.status(502).json({ error: "Missing answer SDP" });
        return;
      }
      res.set("Content-Type", "text/plain");
      res.status(200).send(answer);
    } catch (_err) {
      res.status(500).json({ error: "Realtime exchange failed" });
    }
  }
);

app.post(
  "/realtime/client-secret",
  verifyAuth,
  express.json({ limit: "64kb" }),
  async (_req, res) => {
    if (!requireOpenAiKey(res)) return;

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
          Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    } catch (_err) {
      res.status(500).json({ error: "Client secret mint failed" });
    }
  }
);

app.post("/chat", verifyAuth, express.json({ limit: "1mb" }), async (req, res) => {
  if (!requireOpenAiKey(res)) return;

  const messages = buildChatMessages(req.body || {});
  if (messages.length < 2) {
    res.status(400).json({ error: "Missing chat messages" });
    return;
  }

  const payload = {
    model: process.env.OPENAI_CHAT_MODEL || "gpt-5.2",
    messages,
    temperature: 0.7
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
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
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      res.status(502).json({ error: "Missing reply" });
      return;
    }
    res.status(200).json({ reply });
  } catch (_err) {
    res.status(500).json({ error: "Chat request failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Junction server listening on ${PORT}`);
});
