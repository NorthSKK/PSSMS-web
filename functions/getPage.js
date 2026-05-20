const path = require('path');
const fs = require('fs').promises;

const SRC_DIR = path.join(__dirname, '../../Wap app PSSMS/src');
const ALLOWED = /^[a-zA-Z0-9_-]+$/;

module.exports = async function getPage([pageName]) {
  if (!pageName || !ALLOWED.test(pageName)) throw new Error('Invalid page name');

  // GAS stores pages as either Name.html.html or Name.html
  for (const candidate of [
    path.join(SRC_DIR, pageName + '.html.html'),
    path.join(SRC_DIR, pageName + '.html'),
  ]) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {}
  }

  throw new Error(`Page '${pageName}' not found`);
};
