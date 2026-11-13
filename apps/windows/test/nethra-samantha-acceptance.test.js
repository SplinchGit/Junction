'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NethraStore } = require('../src/nethra-store');

test('WP1a: boot recovers an abandoned unexpired lease without losing the checkpoint', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nethra-samantha-'));
  let now = 1_000_000;
  const previous = new NethraStore(directory, { now: () => now });
  let restarted;
  t.after(() => {
    previous.close();
    restarted?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const task = previous.create({ goal: 'Verify continuity after a host restart' });
  const claim = previous.claim('previous-host', 60_000);
  previous.update(task.id, { contextCheckpoint: { activeHypothesis: 'Continue from saved evidence' } }, 'CHECKPOINT', claim.token);
  previous.close();

  now += 1_000;
  restarted = new NethraStore(directory, { now: () => now });
  assert.equal(restarted.claim('another-scheduler'), null);
  assert.equal(restarted.recoverAbandoned(), 1);
  assert.equal(restarted.recoverAbandoned(), 0);
  const resumed = restarted.claim('restarted-host');
  assert.equal(resumed.task.id, task.id);
  assert.notEqual(resumed.token, claim.token);
  assert.equal(resumed.task.contextCheckpoint.activeHypothesis, 'Continue from saved evidence');
  assert.equal(restarted.events(task.id).filter(event => event.kind === 'RECOVERED').length, 1);
});
