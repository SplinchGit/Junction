'use strict';
// One context size for every qwen3:30b caller. Ollama reloads the model (about a minute)
// whenever a request asks for a different num_ctx than the resident one, so chat, warm-up,
// objectives and World must agree. Measured on this PC on 25 October 2026: 8,192 adds
// 0.38 GiB over 4,096 and leaves GPU offload and 22 tok/s generation unchanged.
const CONTEXT_TOKENS=8192;
// Conservative for this vocabulary: measured JSON tool schemas run near 6.9 chars/token
// and prose near 4, so 3.5 overestimates and compaction starts early rather than late.
const CHARS_PER_TOKEN=3.5;
const COMPACTED='{"compacted":true,"note":"Earlier tool result removed to fit the context window. Its evidence is saved on the host and summarised in the objective seed."}';

const estimateTokens=value=>Math.ceil(JSON.stringify(value).length/CHARS_PER_TOKEN);

/**
 * Keeps a multi-step conversation inside the window instead of letting Ollama truncate it
 * silently. The oldest tool results go first; the system prompt, seed and latest exchange stay.
 */
function fitContext(messages,tools,{contextTokens=CONTEXT_TOKENS,reserveTokens=1536+256}={}){
  const budget=contextTokens-reserveTokens,fixed=estimateTokens(tools||[]);
  let compacted=0,removedExchanges=0;
  for(let i=2;i<messages.length-1&&fixed+estimateTokens(messages)>budget;i++){
    if(messages[i].role!=='tool'||messages[i].content===COMPACTED)continue;
    messages[i]={...messages[i],content:COMPACTED};compacted++;
  }
  // Once raw results are gone, old assistant calls and their tool replies can still
  // fill the window. Remove complete exchanges so no orphaned tool reply remains.
  while(fixed+estimateTokens(messages)>budget&&messages.length>4){
    let end=3;
    if(messages[2].role==='assistant'&&messages[2].tool_calls?.length){
      while(end<messages.length&&messages[end].role==='tool')end++;
    }else if(messages[2].role==='assistant'&&messages[3]?.role==='user')end=4;
    if(messages.length-end<2)break; // Keep the latest exchange as well as system and seed.
    messages.splice(2,end-2);removedExchanges++;
  }
  const estimatedTokens=fixed+estimateTokens(messages);
  return {compacted,removedExchanges,estimatedTokens,budget,fits:estimatedTokens<=budget};
}

module.exports={CONTEXT_TOKENS,fitContext,estimateTokens,COMPACTED};
