// Legacy chat endpoint: preserve its response shape and authenticate access.
const {setGlobalOptions} = require("firebase-functions/v2/options");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
setGlobalOptions({maxInstances: 10});
const openAiKeySecret = defineSecret("OPENAI_API_KEY");

const handler = async (req, res) => {
  if (req.method !== "POST") {
    res.set("Allow", "POST");
    return res.status(405).json({error: "Method not allowed"});
  }
  const match = (req.get("Authorization") || "").match(/^Bearer (.+)$/i);
  if (!match) return res.status(401).json({error: "Authentication required"});
  try {
    await admin.auth().verifyIdToken(match[1], true);
  } catch (_error) {
    return res.status(401).json({error: "Unauthorized"});
  }
  const {message} = req.body || {};
  if (typeof message !== "string" ||
      !message.trim() || message.length > 16000) {
    return res.status(400).json({error: "Message must be 1-16000 characters"});
  }
  try {
    const apiKey = process.env.OPENAI_API_KEY || openAiKeySecret.value();
    if (!apiKey) return res.status(503).json({error: "Chat is not configured"});
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: message,
        max_output_tokens: 1024,
      }),
    });
    if (!response.ok) {
      return res.status(502).json({error: "Chat provider request failed"});
    }
    return res.json(await response.json());
  } catch (_error) {
    return res.status(502).json({error: "Chat provider is unavailable"});
  }
};
exports.chatJunction = onRequest({secrets: [openAiKeySecret]}, handler);
