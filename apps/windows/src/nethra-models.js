'use strict';

const DEFAULT_MODEL='qwen3:30b';
const NEXT_80B_MODEL='junction-qwen3-next:80b-q3km';
const NEXT_80B_THINKING_MODEL='junction-qwen3-next-thinking:80b-q3km';
const NEXT_80B_THINKING_Q4_MODEL='junction-qwen3-next-thinking:80b-q4km';
const OFFICIAL_THINKING_Q4_SOURCE='hf.co/Qwen/Qwen3-Next-80B-A3B-Thinking-GGUF:Q4_K_M';
const Q4_CONTEXT_TOKENS=8192;
const Q4_OUTPUT_TOKENS=2048;
const isNextThinkingModel=model=>model===NEXT_80B_THINKING_MODEL||model===NEXT_80B_THINKING_Q4_MODEL;
const PROFILES=Object.freeze({
  [DEFAULT_MODEL]:Object.freeze({thinking:true,thinkingBudget:1100}),
  [NEXT_80B_MODEL]:Object.freeze({thinking:false,thinkingBudget:0}),
  // Thinking-only weights. No forced early reasoning cutoff; reserve enough output
  // for a complete thought AND a tool call, without changing the 30B budget.
  [NEXT_80B_THINKING_MODEL]:Object.freeze({thinking:true,thinkingBudget:0,outputTokens:6144}),
  [NEXT_80B_THINKING_Q4_MODEL]:Object.freeze({thinking:true,thinkingBudget:0,contextTokens:Q4_CONTEXT_TOKENS,outputTokens:Q4_OUTPUT_TOKENS})
});

function profileFor(model=DEFAULT_MODEL){
  if(!Object.hasOwn(PROFILES,model))throw new Error('Unsupported Nethra model');
  return PROFILES[model];
}

module.exports={DEFAULT_MODEL,NEXT_80B_MODEL,NEXT_80B_THINKING_MODEL,NEXT_80B_THINKING_Q4_MODEL,OFFICIAL_THINKING_Q4_SOURCE,Q4_CONTEXT_TOKENS,Q4_OUTPUT_TOKENS,isNextThinkingModel,profileFor};
