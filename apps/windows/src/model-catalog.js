"use strict";
const providers=[
  {id:"local",name:"Local LLM",tag:"This PC",detail:"Runs one selected loopback-only Ollama model. Agent iterations reuse that same model.",models:[{id:"qwen3.5:2b",name:"Qwen3.5 2B",tier:"Recommended"},{id:"qwen3:1.7b",name:"Qwen3 1.7B",tier:"Fast"},{id:"lfm2.5:2.6b",name:"LFM2.5 2.6B",tier:"Official GGUF"},{id:"qwen3.5:4b",name:"Qwen3.5 4B",tier:"High memory"}]},
  {id:"codex",name:"Codex on this PC",tag:"ChatGPT subscription",detail:"Uses the local Codex CLI signed into ChatGPT. No API key is stored.",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"Fast"},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"Balanced"},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"Most capable"}]},
  {id:"anthropic",name:"Anthropic",tag:"Recommended",detail:"Best balance of quality and cost for everyday use.",models:[{id:"claude-haiku-4-5",name:"Claude Haiku 4.5",tier:"$ Cheap",input:1,output:5},{id:"claude-sonnet-5",name:"Claude Sonnet 5",tier:"$$ Balanced",input:3,output:15},{id:"claude-opus-4-8",name:"Claude Opus 4.8",tier:"$$$ Most capable",input:5,output:25}]},
  {id:"openai",name:"OpenAI",tag:"Most capable",detail:"Wide model support and strong reasoning.",models:[{id:"gpt-5.6-luna",name:"GPT-5.6 Luna",tier:"$ Efficient",input:1,output:6},{id:"gpt-5.6-terra",name:"GPT-5.6 Terra",tier:"$$ Balanced",input:2.5,output:15},{id:"gpt-5.6-sol",name:"GPT-5.6 Sol",tier:"$$$ Frontier",input:5,output:30}]},
  {id:"deepseek",name:"DeepSeek",tag:"Cheapest",detail:"Low-cost models for high-volume use.",models:[{id:"deepseek-chat",name:"DeepSeek Chat",tier:"$ Cheapest",input:.27,output:1.1},{id:"deepseek-reasoner",name:"DeepSeek Reasoner",tier:"$ Cheap",input:.55,output:2.19}]},
  {id:"groq",name:"Groq",tag:"Fastest",detail:"Low-latency open models.",models:[{id:"llama-3.1-8b-instant",name:"Llama 3.1 8B (Instant)",tier:"$ Cheapest",input:.05,output:.08},{id:"llama-3.3-70b-versatile",name:"Llama 3.3 70B",tier:"$ Cheap",input:.59,output:.79}]},
  {id:"custom",name:"Custom",tag:"Advanced",detail:"Any HTTPS or loopback OpenAI-compatible endpoint.",models:[]}
];
function estimate(providerId,modelId,inputTokens=0,outputTokens=0){const model=providers.find(p=>p.id===providerId)?.models.find(m=>m.id===modelId);const input=model?.input??1,output=model?.output??3;return inputTokens*input/1e6+outputTokens*output/1e6;}
module.exports={providers,estimate};
