const test = require('node:test');
const assert = require('node:assert/strict');
// Replace the only external dependency before loading the calculator.
// No eBay credentials or network requests are used in this suite.
const clientPath = require.resolve('../ebayClient');
let listings;
require.cache[clientPath] = {id: clientPath, filename: clientPath, loaded: true,
  exports: {searchListings: async (query) => {
    const value = listings[query];
    if (value instanceof Error) throw value;
    return (value || []).map(price => ({price, title: query, itemWebUrl: 'https://example.invalid/item'}));
  }}};
const {suggestBuild} = require('../suggest');

test('selects ranked hardware within tolerance and computes fees and profit', async () => {
  listings = {budget: [100], better: [105], premium: [200]};
  const result = await suggestBuild({categories: {CPU: {options: ['budget', 'better', 'premium'], rank: {budget: 1, better: 2, premium: 3}}}, feePct: 10});
  assert.equal(result.picks.CPU.option, 'better');
  assert.equal(result.totalCost, 105);
  assert.equal(result.recommendedSalePrice.value, 105);
  assert.equal(result.feeAmount, 10.5);
  assert.equal(result.netProfit, -10.5);
});
test('missing prices use explicit fallback and never produce NaN', async () => {
  listings = {missing: new Error('fixture outage')};
  const result = await suggestBuild({categories: {CPU: {options: ['missing']}}, fallbackSalePrice: 250, feePct: 0});
  assert.deepEqual(result.picks, {});
  assert.equal(result.totalCost, 0);
  assert.equal(result.recommendedSalePrice.source, 'fallback');
  assert.equal(result.netProfit, 250);
  assert.equal(result.roi, 0);
});
test('comparable listing estimate uses median, including even sample count', async () => {
  listings = {comparison: [100, 400, 200, 300]};
  const result = await suggestBuild({categories: {}, comparableQuery: 'comparison'});
  assert.equal(result.recommendedSalePrice.value, 250);
  assert.equal(result.recommendedSalePrice.sampleSize, 4);
});
