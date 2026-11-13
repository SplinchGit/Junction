'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NethraStore } = require('../src/nethra-store');

function taskFamily(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nethra-samantha-'));
  const store = new NethraStore(directory);
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  store.setSettings({ taskAgentsEnabled: true });
  const parent = store.create({ goal: 'Parent objective' });
  const agent = store.create({ goal: 'Child objective', parentTaskId: parent.id, priority: 1 });
  const control = (task, action, request = task.id + action) =>
    store.control(task.id, action, store.get(task.id).revision, request);
  return { store, parent, agent, control };
}

test('WP3a: deleting a parent fences its agent and retains agent history', t => {
  const { store, parent, agent } = taskFamily(t);
  const lease = store.claim('agent-host');
  assert.equal(lease.task.id, agent.id);
  store.remove(parent.id, 'remove-parent');
  store.remove(parent.id, 'remove-parent');
  assert.equal(store.get(agent.id).status, 'CANCELLED');
  assert.equal(store.events(agent.id).filter(event => event.kind === 'PARENT_DELETED').length, 1);
  assert.equal(store.renew(agent.id, lease.token), false);
  assert.equal(store.claim('other-host'), null);
});

test('WP3b: parent resume restores only agents paused by the parent', t => {
  const { store, parent, agent, control } = taskFamily(t);
  const manual = store.create({ goal: 'Manually paused child', parentTaskId: parent.id });
  const overridden = store.create({ goal: 'Child paused again by owner', parentTaskId: parent.id });
  const lease = store.claim('agent-host');
  assert.equal(lease.task.id, agent.id);
  control(manual, 'pause');
  control(parent, 'pause');
  assert.equal(store.get(agent.id).status, 'PAUSED');
  assert.equal(store.renew(agent.id, lease.token), false);
  control(overridden, 'pause');
  control(parent, 'resume');
  assert.equal(store.get(agent.id).status, 'ACTIVE');
  assert.equal(store.get(manual.id).status, 'PAUSED');
  assert.equal(store.get(overridden.id).status, 'PAUSED');
});

test('WP3c: cancelling a parent cancels its active and paused agents', t => {
  const { store, parent, agent, control } = taskFamily(t);
  const manual = store.create({ goal: 'Manually paused child', parentTaskId: parent.id });
  control(manual, 'pause');
  const lease = store.claim('agent-host');
  assert.equal(lease.task.id, agent.id);
  control(parent, 'cancel');
  assert.equal(store.get(agent.id).status, 'CANCELLED');
  assert.equal(store.get(manual.id).status, 'CANCELLED');
  assert.equal(store.renew(agent.id, lease.token), false);
  assert.equal(store.claim('other-host'), null);
});

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
