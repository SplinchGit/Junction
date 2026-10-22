'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startupScriptPath } = require('../src/nethra-startup');

test('packaged startup resolves its PowerShell script from unpacked resources', () => {
  assert.equal(startupScriptPath({
    packaged: true,
    resourcesPath: 'C:\\Junction\\resources',
    sourceDirectory: 'C:\\Junction\\resources\\app.asar\\src',
  }), path.join('C:\\Junction\\resources', 'nethra-startup.ps1'));
});

test('development startup resolves its PowerShell script beside its source module', () => {
  assert.equal(startupScriptPath({
    packaged: false,
    resourcesPath: 'C:\\Junction\\resources',
    sourceDirectory: 'C:\\Junction\\src',
  }), path.join('C:\\Junction\\src', 'nethra-startup.ps1'));
});
