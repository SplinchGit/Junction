const env = process.env;

const port = parseInt(env.PORT || "4001", 10);

const config = {
  port,
  ebayAppId: env.EBAY_APP_ID || "",
  ebayCertId: env.EBAY_CERT_ID || "",
  ebayMarketplace: env.EBAY_MARKETPLACE || "EBAY_GB",
};

function isEbayConfigured() {
  return Boolean(config.ebayAppId && config.ebayCertId);
}

module.exports = { config, isEbayConfigured };
