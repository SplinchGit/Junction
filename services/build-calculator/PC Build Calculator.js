const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const PORT = Number(process.env.PORT || 4001);
const SETTINGS_FILE = path.join(__dirname, "PC Build Calculator.settings.json");
let saved = {};
try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch {}
let EBAY_APP_ID = process.env.EBAY_APP_ID || saved.ebayAppId || "";
let EBAY_CERT_ID = process.env.EBAY_CERT_ID || saved.ebayCertId || "";
let MARKETPLACE = process.env.EBAY_MARKETPLACE || saved.ebayMarketplace || "EBAY_GB";
let token = "";
let tokenExpiresAt = 0;
const seenClients = new Set();

function reply(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 262144) throw new Error("Request is too large");
  }
  return text ? JSON.parse(text) : {};
}

async function accessToken() {
  if (!EBAY_APP_ID || !EBAY_CERT_ID) throw new Error("Set EBAY_APP_ID and EBAY_CERT_ID for live prices");
  if (token && Date.now() < tokenExpiresAt - 60000) return token;
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  if (!response.ok) throw new Error(`eBay login failed: ${await response.text()}`);
  const data = await response.json();
  token = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  return token;
}

async function search(query, limit = 20) {
  const auth = await accessToken();
  const params = new URLSearchParams({ q: String(query).trim(), limit: String(Math.min(50, Math.max(1, limit))), sort: "price" });
  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${auth}`, "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE },
  });
  if (!response.ok) throw new Error(`eBay search failed: ${await response.text()}`);
  const data = await response.json();
  return (data.itemSummaries || []).map(item => ({
    title: item.title || "",
    price: Number(item.price?.value),
    currency: item.price?.currency || "GBP",
    condition: item.condition || "",
    itemWebUrl: item.itemWebUrl || "",
    seller: item.seller?.username || "",
  })).filter(item => Number.isFinite(item.price)).sort((a, b) => a.price - b.price);
}

async function suggest(body) {
  // Authenticate once up front. Candidate searches may legitimately return no
  // listings, but bad credentials must not be swallowed as dozens of empty picks.
  await accessToken();
  const pairs = await Promise.all(Object.entries(body.categories || {}).map(async ([name, spec]) => {
    const candidates = (await Promise.all((spec.options || []).map(async option => {
      try {
        const listings = await search(option, 5);
        return listings[0] ? { option, ...listings[0] } : null;
      } catch { return null; }
    }))).filter(Boolean);
    if (!candidates.length) return [name, null];
    const cheapest = candidates.reduce((a, b) => b.price < a.price ? b : a);
    const close = candidates.filter(x => x.price <= cheapest.price * 1.1);
    close.sort((a, b) => Number(spec.rank?.[b.option] || 0) - Number(spec.rank?.[a.option] || 0));
    return [name, close[0] || cheapest];
  }));
  const picks = Object.fromEntries(pairs.filter(([, pick]) => pick).map(([name, pick]) => [name, {
    option: pick.option, price: pick.price, itemWebUrl: pick.itemWebUrl, title: pick.title,
  }]));
  if (!Object.keys(picks).length) {
    throw new Error("eBay returned no priced parts for this tier. Check the Production keyset and try again.");
  }
  const totalCost = Object.values(picks).reduce((sum, pick) => sum + pick.price, 0);
  const query = ["CPU", "GPU", "RAM", "SSD"].map(key => picks[key]?.option).filter(Boolean).join(" ") || body.comparableQuery || "";
  let comparable = [];
  try { if (query) comparable = await search(query, 20); } catch {}
  const prices = comparable.map(x => x.price).sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  const salePrice = prices.length ? (prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2) : Number(body.fallbackSalePrice || 0);
  const feePct = Number(body.feePct || 6.9);
  const feeAmount = salePrice * feePct / 100;
  const netProfit = salePrice - totalCost - feeAmount;
  return {
    picks, totalCost,
    recommendedSalePrice: { value: salePrice, source: prices.length ? "comparable_listings" : "fallback", sampleSize: prices.length },
    feePct, feeAmount, netProfit,
    margin: salePrice ? netProfit / salePrice * 100 : 0,
    roi: totalCost ? netProfit / totalCost * 100 : 0,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    const client = request.socket.remoteAddress || "unknown device";
    if (!seenClients.has(client)) {
      seenClients.add(client);
      console.log(`[CONNECTED] Junction reached this PC from ${client}`);
    } else if (request.url !== "/health") {
      console.log(`[JUNCTION] ${request.method} ${request.url}`);
    }
    if (request.method === "OPTIONS") return reply(response, 204, {});
    if (request.method === "GET" && request.url === "/health") {
      return reply(response, 200, { ok: true, ebayConfigured: Boolean(EBAY_APP_ID && EBAY_CERT_ID) });
    }
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/price/search") {
      if (!body.query) return reply(response, 400, { error: "Missing query" });
      return reply(response, 200, { listings: await search(body.query, Number(body.limit || 20)) });
    }
    if (request.method === "POST" && request.url === "/suggest/build") {
      if (!body.categories || !Object.keys(body.categories).length) return reply(response, 400, { error: "Missing categories" });
      return reply(response, 200, await suggest(body));
    }
    reply(response, 404, { error: "Not found" });
  } catch (error) {
    reply(response, 500, { error: error.message || "Request failed" });
  }
});

server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Close the other calculator window first.` : error);
  process.exit(1);
});
async function configure() {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nLive pricing uses an eBay production keyset.");
  console.log("1. Visit https://developer.ebay.com/my/keys and sign in.");
  console.log("2. Create an application if needed, then open its Production keyset.");
  console.log("3. Copy the App ID (Client ID) and Cert ID (Client Secret) below.");
  console.log("   Your secret is saved only in this Desktop folder and is never sent to Junction.\n");
  while (true) {
    const appId = (await prompt.question("Paste eBay App ID / Client ID (blank to skip): ")).trim();
    if (!appId) {
      console.log("No settings saved. The calculator still works without live prices.");
      break;
    }
    const certId = (await prompt.question("Paste matching eBay Cert ID / Client Secret: ")).trim();
    if (!certId) continue;
    EBAY_APP_ID = appId;
    EBAY_CERT_ID = certId;
    token = "";
    tokenExpiresAt = 0;
    process.stdout.write("Testing the key pair with eBay... ");
    try {
      await accessToken();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ebayAppId: appId, ebayCertId: certId, ebayMarketplace: MARKETPLACE }, null, 2));
      console.log("success.");
      console.log("Settings saved locally. Live eBay pricing is enabled.");
      break;
    } catch (error) {
      console.log("failed.");
      console.log(error.message);
      console.log("Use both values from the same PRODUCTION keyset, not the Sandbox keyset.");
      const retry = (await prompt.question("Try entering them again? (Y/n): ")).trim().toLowerCase();
      if (retry === "n") break;
    }
  }
  prompt.close();
}

async function main() {
  let needsConfiguration = !EBAY_APP_ID || !EBAY_CERT_ID || process.argv.includes("--configure");
  if (!needsConfiguration) {
    process.stdout.write("Checking saved eBay keys... ");
    try {
      await accessToken();
      console.log("valid.");
    } catch (error) {
      console.log("invalid.");
      console.log(error.message);
      console.log("The saved pair is usually from Sandbox, copied incorrectly, or taken from different keysets.");
      needsConfiguration = true;
    }
  }
  if (needsConfiguration) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question("Set up or replace the eBay Production keys now? (Y/n): ")).trim().toLowerCase();
    prompt.close();
    if (answer !== "n") await configure();
  } else {
    console.log("eBay production keys loaded from local settings.");
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\nPC Build Calculator is running on port ${PORT}.`);
    const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === "IPv4" && !x.internal);
    console.log("In Junction > Settings > Build Calculator, use one of these addresses:");
    for (const address of addresses) console.log(`  http://${address.address}:${PORT}`);
    console.log("Keep this window open. Press Ctrl+C or close the window to stop it completely.");
  });
}

process.on("SIGINT", () => server.close(() => process.exit(0)));
main().catch(error => { console.error(error); process.exit(1); });
