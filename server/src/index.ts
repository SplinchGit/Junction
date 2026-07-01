import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PROVIDER = (process.env.PROVIDER || "openai").toLowerCase();
const MODEL = process.env.MODEL || "gpt-4o";
const PORT = Number(process.env.PORT || 3000);
const SIMULATE_CHUNKING = (process.env.SIMULATE_CHUNKING || "true") === "true";

if (!OPENAI_API_KEY && PROVIDER === "openai") {
  console.warn("OPENAI_API_KEY not set — the /api/chat endpoints will fail until you set this in the environment.");
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: PROVIDER, model: MODEL });
});

// Non-streaming endpoint — returns final assistant text in JSON
app.post("/api/chat", async (req, res) => {
  const { text, conversationId, userId, mode } = req.body || {};
  if (!text) return res.status(400).json({ error: "missing text" });

  try {
    const system = mode ? `Mode: ${mode}` : "You are Splinch. Be helpful and direct.";

    if (PROVIDER === "openai") {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: text }],
          max_tokens: 800,
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
      );
      const reply = resp.data?.choices?.[0]?.message?.content || "";
      return res.json({ reply });
    }

    // Future: add Anthropic adapter
    return res.status(501).json({ error: "provider-not-implemented" });
  } catch (err: any) {
    console.error("/api/chat error", err?.response?.data || err.message || err);
    return res.status(500).json({ error: "chat-failed" });
  }
});

// Streaming endpoint — streams reply chunks as plain text (chunked transfer).
// Client should POST and read response.body as a stream.
app.post("/api/chat/stream", async (req, res) => {
  const { text, conversationId, userId, mode } = req.body || {};
  if (!text) return res.status(400).json({ error: "missing text" });

  // set headers for streaming chunked response
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const system = mode ? `Mode: ${mode}` : "You are Splinch. Be helpful and direct.";

    if (PROVIDER === "openai") {
      // For simplicity and broader compatibility we call the API non-streaming and then stream the text to the client in small chunks.
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: text }],
          max_tokens: 800,
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
      );

      const reply: string = resp.data?.choices?.[0]?.message?.content || "(no reply)";

      // Simple chunking to emulate streaming: send small slices with short delays so the client can play TTS as it arrives.
      const CHUNK_SIZE = 40;
      for (let i = 0; i < reply.length; i += CHUNK_SIZE) {
        const chunk = reply.slice(i, i + CHUNK_SIZE);
        res.write(chunk);
        // flush to client
        await new Promise((r) => setTimeout(r, SIMULATE_CHUNKING ? 60 : 0));
      }

      res.end();
      return;
    }

    res.status(501).end("provider-not-implemented");
  } catch (err: any) {
    console.error("/api/chat/stream error", err?.response?.data || err.message || err);
    try {
      res.status(500).json({ error: "streaming-failed" });
    } catch {
      // ignore
    }
  }
});

app.listen(PORT, () => {
  console.log(`Junction backend listening on port ${PORT} (provider=${PROVIDER}, model=${MODEL})`);
});
