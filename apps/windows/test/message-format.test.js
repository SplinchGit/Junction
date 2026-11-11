"use strict";
const assert = require("node:assert/strict");
const { messageParts, taskActionLog } = require("../renderer/message-format");
assert.deepEqual(messageParts("Fact [GOV.UK](https://www.gov.uk/example)."), [{text:"Fact "},{text:"GOV.UK",url:"https://www.gov.uk/example"},{text:"."}]);
assert.ok(messageParts("[bad](javascript:alert(1))").every(p => !p.url));
assert.ok(messageParts("`[code](https://example.com)`").every(p => !p.url));
assert.ok(messageParts("```js\n[x](https://example.com)\n```").every(p => !p.url));
assert.ok(messageParts("[secret](https://user:pass@example.com)").every(p => !p.url));
assert.deepEqual(messageParts("<script>hello</script>"), [{text:"<script>hello</script>"}]);
console.log("Safe inline citation rendering passed");

assert.equal(typeof taskActionLog, "function", "Task reports must expose their action log separately from the visible update");
const progress = 'Progress on "Compare desks": Searched the web.\nRecorded actions:\n• Searched [reviews](https://example.com/reviews) — Nethra\n• Checked prices — Junction\n1 of 4 steps done.\nNext: Compare the shortlist.\nContinuing now.\n\nMy note: Two options look promising.\n\nReply here to steer this task.';
assert.deepEqual(taskActionLog(progress), {
  before: 'Progress on "Compare desks": Searched the web.\n',
  actions: '• Searched [reviews](https://example.com/reviews) — Nethra\n• Checked prices — Junction\n',
  after: '1 of 4 steps done.\nNext: Compare the shortlist.\nContinuing now.\n\nMy note: Two options look promising.\n\nReply here to steer this task.',
  count: 2
});
assert.deepEqual(taskActionLog('Progress on "Check": Started.\r\nRecorded actions:\r\n• Checked the source — Nethra\r\nI need your input: which date?'), {
  before: 'Progress on "Check": Started.\r\n',
  actions: '• Checked the source — Nethra\r\n',
  after: 'I need your input: which date?',
  count: 1
});
assert.equal(taskActionLog('Progress on "Check": Started.\nRecorded actions:\n• Checked the source — Nethra')?.after, "");
for (const content of [
  'A regular reply.\nRecorded actions:\n• Keep this example visible.',
  '```\nProgress on "Check": Started.\nRecorded actions:\n• A quoted example\n```',
  'Progress on "Check": Started.\nNext: Read the source.',
  'Progress on "Check": Started.\nRecorded actions:\nNext: Read the source.',
  'Progress on "Check": Started.\nRecorded actions:\n• \nNext: Read the source.',
  'I need your input on "Check".\nWhich date should I use?',
  ''
]) assert.equal(taskActionLog(content), null, `Not an action log: ${JSON.stringify(content)}`);
console.log("Task action logs preserve the visible update and ordinary replies");
