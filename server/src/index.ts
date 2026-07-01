import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import admin from "firebase-admin";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || undefined;
const PROVIDER = (process.env.PROVIDER || "openai").toLowerCase();
const MODEL = process.env.MODEL || "gpt-4o";
const PORT = Number(process.env.PORT || 3000);
const SIMULATE_CHUNKING = (process.env.SIMULATE_CHUNKING || "false") === "true";

// Initialize Firebase Admin if credentials provided (recommended)
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
if (serviceAccountJson) {
  try {
    if (serviceAccountJson.trim().startsWith("{") ) {
      // JSON string provided directly
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      });
    } else {
      // Assume GOOGLE_APPLICATION_CREDENTIALS env points to a file path handled by the runtime
      admin.initializeApp();
    }
    console.log("Firebase Admin initialized");
  } catch (err) {
    console.warn("Failed to initialize Firebase Admin:", err);
  }
} else {
  console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not set — per-user key storage and token verification will be unavailable.");
}

// Encryption helpers (AES-256-GCM)
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || ""; // base64 32 bytes
const ENC_KEY = ENC_KEY_B64 ? Buffer.from(ENC_KEY_B64, "base64") : null;

function encrypt(plaintext: string) {
  if (!ENC_KEY) throw new Error("ENCRYPTION_KEY not set");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(payloadB64: string) {
  if (!ENC_KEY) throw new Error("ENCRYPTION_KEY not set");
  const buf = Buffer.from(payloadB64, "base64");
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

// Middleware: verify Firebase ID token and attach uid
async function verifyIdTokenMiddleware(req: any, res: any, next: any) {
  const auth = req.headers?.authorization || "";
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "missing-auth" });
  const idToken = m[1];
  if (!admin.apps.length) return res.status(500).json({ error: "firebase-admin-not-initialized" });
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    console.warn("token verify failed", e?.message || e);
    return res.status(401).json({ error: "invalid-token" });
  }
}

async function getPerUserKey(uid: string) {
  if (!admin.apps.length) return null;
  try {
    const doc = await admin.firestore().doc(`user_keys/${uid}`).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (!data?.encryptedKey) return null;
    try {
      return decrypt(data.encryptedKey);
    } catch (e) {
      console.warn("failed to decrypt user key", e?.message || e);
      return null;
    }
  } catch (e) {
    console.warn("getPerUserKey error", e?.message || e);
    return null;
  }
}

// POST /api/user/key — store a user-specific provider key (encrypted)
app.post("/api/user/key", verifyIdTokenMiddleware, async (req: any, res) => {
  const uid = req.uid;
  const { key } = req.body || {};
  if (!key || typeof key !== "string") return res.status(400).json({ error: "missing-key" });
  if (!admin.apps.length) return res.status(500).json({ error: "firebase-admin-not-initialized" });
  if (!ENC_KEY) return res.status(500).json({ error: "encryption-not-configured" });

  try {
    const encrypted = encrypt(key);
    await admin.firestore().doc(`user_keys/${uid}`).set({ encryptedKey: encrypted }, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    console.error("/api/user/key error", e?.message || e);
    return res.status(500).json({ error: "store-failed" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: PROVIDER, model: MODEL, openai: !!OPENAI_API_KEY, firebase: !!admin.apps.length });
});

// Helper to create messages array
function buildMessages(system: string, text: string) {
  return [{ role: "system", content: system }, { role: "user", content: text }];
}

// Simple non-stream chat that uses per-user key when available
app.post("/api/chat", verifyIdTokenMiddleware, async (req: any, res) => {
  const { text, mode } = req.body || {};
  if (!text) return res.status(400).json({ error: "missing text" });
  const uid = req.uid;
  const system = mode ? `Mode: ${mode}` : "You are Splinch. Be helpful and direct.";

  let apiKeyToUse = OPENAI_API_KEY;
  const perUser = await getPerUserKey(uid);
  if (perUser) apiKeyToUse = perUser;
  if (!apiKeyToUse) return res.status(400).json({ error: "no-api-key" });

  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: MODEL,
        messages: buildMessages(system, text),
        max_tokens: 800,
      },
      { headers: { Authorization: `Bearer ${apiKeyToUse}`, "Content-Type": "application/json" } }
    );
    const reply = resp.data?.choices?.[0]?.message?.content || "";
    return res.json({ reply });
  } catch (err: any) {
    console.error("/api/chat error", err?.response?.data || err.message || err);
    return res.status(500).json({ error: "chat-failed" });
  }
});

// Streaming endpoint: connect to OpenAI streaming API and forward delta text chunks to the client
app.post("/api/chat/stream", verifyIdTokenMiddleware, async (req: any, res) => {
  const { text, mode } = req.body || {};
  if (!text) return res.status(400).json({ error: "missing text" });
  const uid = req.uid;
  const system = mode ? `Mode: ${mode}` : "You are Splinch. Be helpful and direct.";

  let apiKeyToUse = OPENAI_API_KEY;
  const perUser = await getPerUserKey(uid);
  if (perUser) apiKeyToUse = perUser;
  if (!apiKeyToUse) return res.status(400).json({ error: "no-api-key" });

  // configure stream response to client
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    // OpenAI streaming call
    const resp = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: MODEL,
        messages: buildMessages(system, text),
        max_tokens: 800,
        stream: true,
      },
      {
        headers: { Authorization: `Bearer ${apiKeyToUse}`, "Content-Type": "application/json" },
        responseType: "stream",
        timeout: 120000,
      }
    );

    const stream = resp.data;
    let buffer = "";

    stream.on("data", async (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      buffer += s;
      // OpenAI stream uses lines starting with "data: "
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        if (!line.startsWith("data: ")) continue;
        const payload = line.replace(/^data: /, "").trim();
        if (payload === "[DONE]") {
          res.end();
          return;
        }
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || "";
          if (delta) {
            // write delta to client as plain text chunk
            res.write(delta);
            if (SIMULATE_CHUNKING) await new Promise((r) => setTimeout(r, 30));
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    });

    stream.on("end", () => {
      try { res.end(); } catch {};
    });

    stream.on("error", (err: any) => {
      console.error("OpenAI stream error", err?.message || err);
      try { res.end(); } catch {}
    });

  } catch (err: any) {
    console.error("/api/chat/stream error", err?.response?.data || err.message || err);
    try {
      res.status(500).json({ error: "streaming-failed" });
    } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`Junction backend listening on port ${PORT} (provider=${PROVIDER}, model=${MODEL})`);
});
