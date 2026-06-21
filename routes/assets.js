// Serves GAS .html source files as usable web assets:
//   GET /api/assets/script/Scripts_Core   → JS (strips <script> tags)
//   GET /api/assets/style                 → CSS (strips <style> tags)
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

const SRC_DIR = path.join(__dirname, '../src');
const ALLOWED = /^[a-zA-Z0-9_-]+$/;

router.get('/style', async (req, res) => {
  try {
    const content = await fs.readFile(path.join(SRC_DIR, 'Styles.html'), 'utf8');
    const css = content.replace(/<\/?style[^>]*>/gi, '');
    res.set('Cache-Control', 'no-store');
    res.type('text/css').send(css);
  } catch (e) {
    res.status(404).type('text/css').send('/* Styles.html not found */');
  }
});

router.get('/script/:name', async (req, res) => {
  const { name } = req.params;
  if (!ALLOWED.test(name)) return res.status(400).send('// Invalid name');
  try {
    const content = await fs.readFile(path.join(SRC_DIR, name + '.html'), 'utf8');
    const js = content.replace(/<script[^>]*>/gi, '').replace(/<\/script>/gi, '');
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(js);
  } catch {
    res.status(404).type('application/javascript').send(`// '${name}' not found`);
  }
});

module.exports = router;
