"use strict";

async function discoverOllama(baseUrl = "http://127.0.0.1:11434") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    return { available: true, baseUrl, models: Array.isArray(body.models) ? body.models.map(model => ({ name: model.name, size: model.size })) : [] };
  } catch (error) {
    return { available: false, baseUrl, models: [], reason: error.name === "AbortError" ? "timeout" : "unavailable" };
  } finally { clearTimeout(timer); }
}

module.exports = { discoverOllama };
