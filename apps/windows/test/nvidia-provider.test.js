"use strict";
const assert = require("node:assert/strict");
const { sendChat } = require("../src/provider-client");

(async () => {
  let request;
  const result = await sendChat({
    config: {id:"nvidia",model:"nvidia/nemotron-3-ultra-550b-a55b"},
    key: "nvidia-device-key",
    messages: [{role:"user",content:"Hello"}],
    fetchImpl: async (url, options) => {
      request = {url, options, body:JSON.parse(options.body)};
      return {ok:true,status:200,json:async()=>({model:"nvidia/nemotron-3-ultra-550b-a55b",choices:[{message:{content:"Hi"}}],usage:{}})};
    }
  });
  assert.equal(request.url,"https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(request.options.headers.authorization,"Bearer nvidia-device-key");
  assert.equal(request.body.model,"nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(result.content,"Hi");
  console.log("NVIDIA first-party endpoint, key, and selected model routing passed");
})().catch(error=>{console.error(error);process.exitCode=1});
