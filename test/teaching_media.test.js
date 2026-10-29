'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const app = express();
app.use('/teaching-media', require('../routes/teachingMedia'));
// Model the application's fallback so missing lessons cannot silently reach it.
app.get('*', (req, res) => res.send('SPA fallback'));
let server;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
});
after(() => new Promise(resolve => server.close(resolve)));

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('all four lessons open as isolated HTML without accessing application credentials', async () => {
  for (const slug of ['equilibrium', 'sound', 'electromagnetic-waves', 'air']) {
    const res = await get('/teaching-media/' + slug);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /<!doctype html>/i);
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /sandbox allow-scripts;/);
    assert.doesNotMatch(csp, /allow-same-origin|allow-forms|allow-popups/);
    assert.match(csp, /connect-src 'none'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cache-control'], 'no-cache');
  }
});

test('unknown lessons, filenames, and traversal attempts never reach files or SPA', async () => {
  for (const path of ['', '/', '/unknown', '/sound.html', '/%2e%2e%2fserver.js', '/sound/../../server.js', '/equilibrium/extra']) {
    const res = await get('/teaching-media' + path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, /SPA fallback|require\(/);
  }
});
