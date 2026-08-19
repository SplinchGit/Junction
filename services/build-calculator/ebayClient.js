const { config, isEbayConfigured } = require("./config");

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (!isEbayConfigured()) {
    throw new Error("eBay is not configured (missing EBAY_APP_ID/EBAY_CERT_ID)");
  }
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const auth = Buffer.from(`${config.ebayAppId}:${config.ebayCertId}`).toString("base64");
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", SCOPE);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`eBay token request failed: ${detail}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in || 0) * 1000;
  return cachedToken;
}

function parseListing(item) {
  const priceValue = item.price && item.price.value ? parseFloat(item.price.value) : null;
  return {
    title: item.title || "",
    price: priceValue,
    currency: (item.price && item.price.currency) || (config.ebayMarketplace === "EBAY_GB" ? "GBP" : ""),
    condition: item.condition || "",
    itemWebUrl: item.itemWebUrl || "",
    seller: (item.seller && item.seller.username) || "",
  };
}

async function searchListings(query, limit = 20) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  const token = await getAccessToken();
  const params = new URLSearchParams();
  params.set("q", trimmed);
  params.set("limit", String(Math.max(1, Math.min(limit, 50))));
  params.set("sort", "price");

  const response = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": config.ebayMarketplace,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`eBay search failed: ${detail}`);
  }

  const data = await response.json();
  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  return items
    .map(parseListing)
    .filter((listing) => listing.price !== null)
    .sort((a, b) => a.price - b.price);
}

module.exports = { searchListings };
