const { searchListings } = require("./ebayClient");

const PRICE_TOLERANCE = 0.1;

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function cheapestPriceFor(option) {
  try {
    const listings = await searchListings(option, 5);
    if (listings.length === 0) return null;
    return { option, price: listings[0].price, itemWebUrl: listings[0].itemWebUrl, title: listings[0].title };
  } catch (_err) {
    return null;
  }
}

function pickBest(priced, rankMap) {
  const available = priced.filter((p) => p !== null);
  if (available.length === 0) return null;

  const cheapest = available.reduce((a, b) => (b.price < a.price ? b : a));
  if (!rankMap) return cheapest;

  const withinTolerance = available.filter((p) => p.price <= cheapest.price * (1 + PRICE_TOLERANCE));
  const ranked = withinTolerance
    .map((p) => ({ ...p, rank: rankMap[p.option] ?? 0 }))
    .sort((a, b) => b.rank - a.rank);

  return ranked[0] || cheapest;
}

async function priceCategory(name, categorySpec) {
  const options = Array.isArray(categorySpec.options) ? categorySpec.options : [];
  const priced = await Promise.all(options.map((option) => cheapestPriceFor(option)));
  return pickBest(priced, categorySpec.rank);
}

async function recommendSalePrice(comparableQuery, fallbackSalePrice) {
  if (comparableQuery) {
    try {
      const listings = await searchListings(comparableQuery, 20);
      const prices = listings.map((l) => l.price).filter((p) => typeof p === "number");
      const med = median(prices);
      if (med !== null) {
        return { value: med, source: "comparable_listings", sampleSize: prices.length };
      }
    } catch (_err) {
      // fall through to fallback
    }
  }
  return { value: fallbackSalePrice || 0, source: "fallback", sampleSize: 0 };
}

function buildComparableQuery(picks, fallbackQuery) {
  // Prefer a query built from what was actually picked, so the comparable listings match
  // the suggested build rather than a guess the client made before picks existed.
  const bits = ["CPU", "GPU", "RAM", "SSD"]
    .map((key) => picks[key]?.option)
    .filter(Boolean);
  if (bits.length > 0) return bits.join(" ");
  return typeof fallbackQuery === "string" ? fallbackQuery.trim() : "";
}

async function suggestBuild(body) {
  const categories = body.categories && typeof body.categories === "object" ? body.categories : {};
  const categoryNames = Object.keys(categories);

  const results = await Promise.all(
    categoryNames.map(async (name) => [name, await priceCategory(name, categories[name])])
  );

  const picks = {};
  let totalCost = 0;
  for (const [name, pick] of results) {
    if (!pick) continue;
    picks[name] = { option: pick.option, price: pick.price, itemWebUrl: pick.itemWebUrl, title: pick.title };
    totalCost += pick.price;
  }

  const comparableQuery = buildComparableQuery(picks, body.comparableQuery);
  const recommendedSalePrice = await recommendSalePrice(comparableQuery, body.fallbackSalePrice);

  const feePct = typeof body.feePct === "number" ? body.feePct : 6.9;
  const feeAmount = recommendedSalePrice.value * (feePct / 100);
  const netProfit = recommendedSalePrice.value - totalCost - feeAmount;
  const margin = recommendedSalePrice.value > 0 ? (netProfit / recommendedSalePrice.value) * 100 : 0;
  const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

  return {
    picks,
    totalCost,
    recommendedSalePrice,
    feePct,
    feeAmount,
    netProfit,
    margin,
    roi,
  };
}

module.exports = { suggestBuild };
