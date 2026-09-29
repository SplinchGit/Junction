"use strict";

const providers = [
  {id:"local",name:"Qwen on this PC",group:"Local",source:"Qwen · local",credentialId:null,tag:"This PC",detail:"Runs one selected loopback-only Ollama model. Agent iterations reuse that same model.",defaultModel:"qwen3.5:2b",models:[{id:"qwen3.5:2b",name:"Qwen3.5 2B",tier:"Balanced"},{id:"qwen3:1.7b",name:"Qwen3 1.7B",tier:"Fast"},{id:"gemma3:1b",name:"Gemma 3 1B",tier:"Fast conversational",autonomousToolUse:false}]},
  {id:"codex",name:"Codex on this PC",group:"Local",source:"OpenAI · ChatGPT subscription",credentialId:null,tag:"ChatGPT subscription",detail:"Uses the local Codex CLI signed into ChatGPT. No API key is stored.",defaultModel:"gpt-5.6-luna",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"Fast"},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"Balanced"},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"Most capable"}]},
  {id:"anthropic",name:"Anthropic",group:"First Party",source:"Anthropic · first party",credentialId:"anthropic",tag:"API key",detail:"Direct Anthropic API using the key encrypted on this device.",defaultModel:"claude-sonnet-5",models:[{id:"claude-haiku-4-5",name:"Claude Haiku 4.5",tier:"$ Cheap",input:1,output:5},{id:"claude-sonnet-5",name:"Claude Sonnet 5",tier:"$$ Balanced",input:3,output:15},{id:"claude-opus-4-8",name:"Claude Opus 4.8",tier:"$$$ Most capable",input:5,output:25}]},
  {id:"openai",name:"OpenAI",group:"First Party",source:"OpenAI · first party",credentialId:"openai",tag:"API key",detail:"Direct OpenAI API using the key encrypted on this device.",defaultModel:"gpt-5.6-luna",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"$ Efficient",input:1,output:6},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"$$ Balanced",input:2.5,output:15},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"$$$ Frontier",input:5,output:30}]},
  {id:"nvidia",name:"NVIDIA",group:"First Party",source:"NVIDIA · first party",credentialId:"nvidia",tag:"API key",detail:"Direct NVIDIA API using the key encrypted on this device.",defaultModel:"nvidia/nemotron-3-ultra-550b-a55b",models:[{id:"nvidia/nemotron-3-ultra-550b-a55b",name:"Nemotron 3 Ultra",tier:"NVIDIA API"}]},
  {id:"openrouter",name:"NVIDIA",group:"OpenRouter",source:"NVIDIA via OpenRouter",credentialId:"openrouter",tag:"OpenRouter key",detail:"NVIDIA Nemotron through OpenRouter. Uses only the OpenRouter key stored on this device.",defaultModel:"nvidia/nemotron-3-ultra-550b-a55b:free",models:[{id:"nvidia/nemotron-3-ultra-550b-a55b:free",name:"Nemotron 3 Ultra (FREE)",tier:"Free · OpenRouter",input:0,output:0}]},
  {id:"custom",name:"Custom compatible",group:"Advanced",source:"Custom endpoint",credentialId:"custom",tag:"Advanced",detail:"Any HTTPS or loopback OpenAI-compatible endpoint.",defaultModel:"",models:[]}
];

function estimate(providerId,modelId,inputTokens=0,outputTokens=0){const model=providers.find(p=>p.id===providerId)?.models.find(m=>m.id===modelId);const input=model?.input??1,output=model?.output??3;return inputTokens*input/1e6+outputTokens*output/1e6}
function providerById(providerId){return providers.find(provider=>provider.id===providerId)}
function normalizeModel(providerId,modelId){const provider=providerById(providerId);if(!provider||providerId==="custom")return String(modelId||"");return provider.models.some(model=>model.id===modelId)?modelId:provider.defaultModel}
function credentialProviderId(providerId){return providerById(providerId)?.credentialId??null}
function isSupportedLocalModel(model){return providerById("local").models.some(item=>item.id===model)}
function normalizeLocalModel(model){return normalizeModel("local",model)}
module.exports={providers,estimate,providerById,normalizeModel,credentialProviderId,normalizeLocalModel,isSupportedLocalModel};
