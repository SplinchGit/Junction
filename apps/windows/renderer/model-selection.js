"use strict";
(function expose(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JunctionModelSelection = api;
})(typeof window === "object" ? window : globalThis, () => {
  function groupedProviderOptions(providers) {
    const labels = ["Local", "First Party", "OpenRouter", "Advanced"];
    return labels.map(label => ({label, options: providers.filter(provider => provider.group === label)}))
      .filter(group => group.options.length);
  }
  function selectionFor(providers, providerId, modelId) {
    const provider = providers.find(item => item.id === providerId) || null;
    if (!provider) return {provider:null, model:null};
    const model = provider.models.find(item => item.id === modelId)
      || provider.models.find(item => item.id === provider.defaultModel)
      || provider.models[0]
      || null;
    return {provider, model};
  }
  function modelValueFor(providerId, selectedModel, customModel) {
    return providerId === "custom" ? String(customModel || "").trim() : selectedModel;
  }
  return {groupedProviderOptions, selectionFor, modelValueFor};
});
