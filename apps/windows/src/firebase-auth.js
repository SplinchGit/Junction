"use strict";

const crypto = require("node:crypto");
const http = require("node:http");

function base64url(buffer) { return buffer.toString("base64url"); }

async function nativeGoogleFirebaseSignIn({ shell, googleClientId, firebaseApiKey }) {
  if (!googleClientId || !firebaseApiKey) throw new Error("Firebase API key and Google Desktop OAuth client ID are required.");
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(24));
  const callback = await createCallbackServer(state);
  const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: callback.redirectUri, response_type: "code", scope: "openid email profile", code_challenge: challenge, code_challenge_method: "S256", state, prompt: "select_account" });
  await shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  try {
    const code = await callback.code;
    const googleResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: googleClientId, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: callback.redirectUri }) });
    const google = await googleResponse.json();
    if (!googleResponse.ok || !google.id_token) throw new Error(google.error_description || "Google token exchange failed.");
    const firebaseResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(firebaseApiKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ postBody: `id_token=${encodeURIComponent(google.id_token)}&providerId=google.com`, requestUri: callback.redirectUri, returnSecureToken: true, returnIdpCredential: false }) });
    const firebase = await firebaseResponse.json();
    if (!firebaseResponse.ok) throw new Error(firebase.error?.message || "Firebase sign-in failed.");
    return { uid: firebase.localId, email: firebase.email, displayName: firebase.displayName, idToken: firebase.idToken, refreshToken: firebase.refreshToken, expiresAt: Date.now() + Number(firebase.expiresIn) * 1000 };
  } finally { callback.close(); }
}

function createCallbackServer(expectedState) {
  let resolveCode, rejectCode;
  const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== expectedState) { response.writeHead(400); response.end("Invalid Junction sign-in callback."); return; }
    if (url.searchParams.get("error")) rejectCode(new Error(`Google sign-in was not completed: ${url.searchParams.get("error")}`));
    else resolveCode(url.searchParams.get("code"));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end("<h1>Junction is linked</h1><p>You can close this window and return to Junction.</p>");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ code, close: () => server.close(), redirectUri: `http://127.0.0.1:${server.address().port}/oauth/callback` }));
  });
}

async function refreshFirebaseSession(session, firebaseApiKey, fetchImpl = fetch) {
  if (!session?.refreshToken) throw new Error("Sign in to Junction again to refresh this device session.");
  if (!firebaseApiKey) throw new Error("This Junction build cannot refresh its Firebase session.");
  const response = await fetchImpl(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseApiKey)}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Junction account session refresh failed.");
  return { ...session, uid: data.user_id || session.uid, idToken: data.id_token, refreshToken: data.refresh_token || session.refreshToken, expiresAt: Date.now() + Number(data.expires_in) * 1000 };
}

module.exports = { nativeGoogleFirebaseSignIn, refreshFirebaseSession };
