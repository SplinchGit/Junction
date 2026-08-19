const express = require("express");
const cors = require("cors");
const { config, isEbayConfigured } = require("./config");
const { searchListings } = require("./ebayClient");
const { suggestBuild } = require("./suggest");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, ebayConfigured: isEbayConfigured() });
});

function requireEbayConfigured(res) {
  if (!isEbayConfigured()) {
    res.status(500).json({ error: "eBay is not configured (missing EBAY_APP_ID/EBAY_CERT_ID)" });
    return false;
  }
  return true;
}

app.post("/price/search", async (req, res) => {
  if (!requireEbayConfigured(res)) return;
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }
  const limit = typeof req.body?.limit === "number" ? req.body.limit : 20;
  try {
    const listings = await searchListings(query, limit);
    res.status(200).json({ listings });
  } catch (err) {
    res.status(502).json({ error: err.message || "eBay search failed" });
  }
});

app.post("/suggest/build", async (req, res) => {
  if (!requireEbayConfigured(res)) return;
  const categories = req.body?.categories;
  if (!categories || typeof categories !== "object" || Object.keys(categories).length === 0) {
    res.status(400).json({ error: "Missing categories" });
    return;
  }
  try {
    const suggestion = await suggestBuild(req.body);
    res.status(200).json(suggestion);
  } catch (err) {
    res.status(502).json({ error: err.message || "Build suggestion failed" });
  }
});

app.listen(config.port, () => {
  console.log(`Junction build-calculator daemon listening on ${config.port}`);
  if (!isEbayConfigured()) {
    console.warn("EBAY_APP_ID/EBAY_CERT_ID not set — pricing endpoints will return errors until configured.");
  }
});
