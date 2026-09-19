"use strict";
const providers=[
  {id:"local",name:"Local LLM",tag:"This PC",detail:"Runs one selected loopback-only Ollama model. Agent iterations reuse that same model.",models:[{id:"qwen3.5:2b",name:"Qwen3.5 2B",tier:"Balanced"},{id:"qwen3:1.7b",name:"Qwen3 1.7B",tier:"Fast"},{id:"lfm2.5:2.6b",name:"LFM2.5 2.6B",tier:"Official GGUF"}]},
  {id:"codex",name:"Codex on this PC",tag:"ChatGPT subscription",detail:"Uses the local Codex CLI signed into ChatGPT. No API key is stored.",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"Fast"},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"Balanced"},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"Most capable"}]},
  {id:"openai",name:"OpenAI (GPT)",tag:"API Key",detail:"Wide model support and strong reasoning.",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"$ Efficient",input:1,output:6},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"$$ Balanced",input:2.5,output:15},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"$$$ Frontier",input:5,output:30}]},
  {id:"anthropic",name:"Claude (Anthropic)",tag:"Low priority",detail:"Best balance of quality and cost for everyday use.",models:[{id:"claude-haiku-4-5",name:"Claude Haiku 4.5",tier:"$ Cheap",input:1,output:5},{id:"claude-sonnet-5",name:"Claude Sonnet 5",tier:"$$ Balanced",input:3,output:15},{id:"claude-opus-4-8",name:"Claude Opus 4.8",tier:"$$$ Most capable",input:5,output:25}]},
  {id:"custom",name:"Custom",tag:"Advanced",detail:"Any HTTPS or loopback OpenAI-compatible endpoint.",models:[]}
];
function estimate(providerId,modelId,inputTokens=0,outputTokens=0){
  const model=providers.find(p=>p.id===providerId)?.models.find(m=>m.id===modelId);
  const input=model?.input ?? 1, output=model?.output ?? 3;
  return inputTokens*input/1e6 + outputTokens*output/1e6;
}
function isSupportedLocalModel(model) { return providers.find(p => p.id === "local").models.some(m => m.id === model); }
function normalizeLocalModel(model) { return isSupportedLocalModel(model) ? model : "qwen3.5:2b"; }
function isRetiredLocalModel(model) { return /^qwen3\.5:4b(?:$|-)/i.test(String(model)); }
module.exports={providers,estimate,normalizeLocalModel,isSupportedLocalModel,isRetiredLocalModel};
