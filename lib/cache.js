const store = {};

function get(key) {
  const entry = store[key];
  if (!entry) return null;
  if (Date.now() > entry.exp) { delete store[key]; return null; }
  return entry.val;
}

function set(key, val, ttlSec) {
  store[key] = { val, exp: Date.now() + ttlSec * 1000 };
}

function del(key) { delete store[key]; }

function delPrefix(prefix) {
  Object.keys(store).forEach(k => { if (k.startsWith(prefix)) delete store[k]; });
}

module.exports = { get, set, del, delPrefix };
