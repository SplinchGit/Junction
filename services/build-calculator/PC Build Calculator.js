const http = require("node:http");

const PORT = Number(process.env.PORT || 4001);
const EBAY_APP_ID = process.env.EBAY_APP_ID || "";
const EBAY_CERT_ID = process.env.EBAY_CERT_ID || "";
const MARKETPLACE = process.env.EBAY_MARKETPLACE || "EBAY_GB";
let token = "";
let tokenExpiresAt = 0;

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
server.listen(PORT, "0.0.0.0", () => {
  console.log(`PC Build Calculator is running on port ${PORT}.`);
  console.log("Keep this window open. Press Ctrl+C or close the window to stop it completely.");
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
