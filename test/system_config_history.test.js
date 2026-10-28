'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual handler with isolated settings, without a database or
// changing the shared development/production term.
function handler(rows) {
  const cache = new Map();
  let reads = 0;
  const sandbox = {
    module: { exports: {} },
    require(name) {
      if (name === '../lib/db') return { query: async () => { reads++; return { rows }; } };
      if (name === '../lib/cache') return { get: key => cache.get(key), set: (key, value) => cache.set(key, value) };
      if (name === '../lib/appInfo') return { appInfo: () => ({ build: 'test' }) };
      if (name === '../lib/featureFlags') return { professionalDevelopmentEnabled: () => false };
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/getSystemConfig.js'), 'utf8'), sandbox);
  const getConfig = sandbox.module.exports;
  getConfig.readCount = () => reads;
  return getConfig;
}

test('settings include saved date ranges for switching back to another term/year', async () => {
  const getConfig = handler([
    { key: 'TermData', subkey: '1_2569', value1: '2026-05-18', value2: '2026-10-09' },
    { key: 'TermData', subkey: '2_2569', value1: '2026-10-26', value2: '2027-04-01' },
    { key: 'TermData', subkey: '1_2568', value1: '2025-05-19', value2: '2025-10-10' },
    { key: 'Active', subkey: 'Term', value1: '2', value2: '2569' },
  ]);
  const config = await getConfig();
  assert.equal(config.termStart, '2026-10-26');
  assert.equal(config.termEnd, '2027-04-01');
  assert.ok(config.termHistory, 'getSystemConfig must return the history consumed by the settings form');
  assert.deepEqual(JSON.parse(JSON.stringify(config.termHistory)), {
    '1_2569': { start: '2026-05-18', end: '2026-10-09' },
    '2_2569': { start: '2026-10-26', end: '2027-04-01' },
    '1_2568': { start: '2025-05-19', end: '2025-10-10' },
  });
  const cached = await getConfig();
  assert.strictEqual(cached, config, 'cached settings retain the complete history');
  assert.equal(getConfig.readCount(), 1);
});

test('settings without term dates return an empty history and empty active range', async () => {
  const config = await handler([])();
  assert.deepEqual(JSON.parse(JSON.stringify(config.termHistory)), {});
  assert.equal(config.termStart, '');
  assert.equal(config.termEnd, '');
});
