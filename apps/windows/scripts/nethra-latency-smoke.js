'use strict';
// Local synthetic prompts only. No searches, objectives or owner conversation data.
const fs = require('node:fs');
const {LocalAgentRuntime} = require('../src/local-agent-runtime');
(async () => {
  const runtime = new LocalAgentRuntime();
  const rows = [];
  for (const goal of ['Hello', 'Are you the 30B model?', 'Hello']) {
    const started = Date.now(); let firstTextMs = null;
    const result = await runtime.run({goal, model:'qwen3:30b', onProgress: progress => {
      if (progress.text && firstTextMs === null) firstTextMs = Date.now() - started;
    }});
    if (!result.content?.trim()) throw new Error('Empty answer');
    const row = {goal, firstTextMs, wallMs:Date.now()-started, content:result.content, metrics:result.metrics};
    rows.push(row); console.log(JSON.stringify(row));
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(rows,null,2));
})().catch(error => {console.error(error);process.exitCode=1;});
