const env = process.env;

function toList(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const port = parseInt(env.PORT || "8787", 10);

const config = {
  port,
  openAiApiKey: env.OPENAI_API_KEY || "",
  chatApiKey: env.JUNCTION_CHAT_API_KEY || "",
  openAiAllowedModels: toList(env.OPENAI_ALLOWED_MODELS),
  openAiChatModel: env.OPENAI_CHAT_MODEL || "gpt-5.2",
  openAiRealtimeModel: env.OPENAI_REALTIME_MODEL || "gpt-4o-realtime-preview",
  openAiRealtimeClientSecretTtl: parseInt(env.OPENAI_REALTIME_CLIENT_SECRET_TTL || "600", 10),
  adminEmail: env.ADMIN_EMAIL || "",
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ""),
  appRedirectUri: env.APP_REDIRECT_URI || "junction://oauth-callback",
  disableAuth: env.DISABLE_AUTH === "true",
  firebaseServiceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  googleApplicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS || "",
  oauthProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    },
    slack: {
      clientId: env.SLACK_CLIENT_ID || "",
      clientSecret: env.SLACK_CLIENT_SECRET || "",
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID || "",
      clientSecret: env.GITHUB_CLIENT_SECRET || "",
    },
    notion: {
      clientId: env.NOTION_CLIENT_ID || "",
      clientSecret: env.NOTION_CLIENT_SECRET || "",
    },
  },
};

function listMissing() {
  const missing = [];
  if (!config.openAiApiKey) missing.push("OPENAI_API_KEY");
  if (!config.firebaseServiceAccountJson && !config.googleApplicationCredentials) {
    missing.push("FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS");
  }
  return missing;
}

function listProviderWarnings() {
  const warnings = [];
  Object.entries(config.oauthProviders).forEach(([provider, creds]) => {
    const hasAny = creds.clientId || creds.clientSecret;
    const hasBoth = creds.clientId && creds.clientSecret;
    if (hasAny && !hasBoth) {
      warnings.push(`${provider.toUpperCase()}_CLIENT_ID/SECRET incomplete`);
    }
  });
  return warnings;
}

module.exports = {
  config,
  listMissing,
  listProviderWarnings,
};
