'use strict';

const DEFAULT_MODEL='qwen3:30b';
const NEXT_80B_MODEL='junction-qwen3-next:80b-q3km';
const PROFILES=Object.freeze({
  [DEFAULT_MODEL]:Object.freeze({thinking:true,thinkingBudget:1100}),
  [NEXT_80B_MODEL]:Object.freeze({thinking:false,thinkingBudget:0})
});

function profileFor(model=DEFAULT_MODEL){
  if(!Object.hasOwn(PROFILES,model))throw new Error('Unsupported Nethra model');
  return PROFILES[model];
}

module.exports={DEFAULT_MODEL,NEXT_80B_MODEL,profileFor};
