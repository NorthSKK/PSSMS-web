'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();

// Only reviewed, bundled lessons are executable. Never serve arbitrary uploads here.
const LESSONS = new Set(['equilibrium', 'sound', 'electromagnetic-waves', 'air']);
const CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

router.get('/:lesson', (req, res, next) => {
  if (!LESSONS.has(req.params.lesson)) return next();
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  });
  res.sendFile(path.join(__dirname, '../teaching-media', req.params.lesson + '.html'));
});

// Do not let unknown lesson paths fall through to the SPA (200 with login HTML).
router.use((req, res) => res.status(404).type('txt').send('ไม่พบสื่อการสอน'));

module.exports = router;
