'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importMedia } = require('../scripts/import-pw-physics-media');

// Test import boundaries without importing DB configuration or touching any database.
function fixture({ school = 'โรงเรียนภูพระบาทวิทยา', demo = false, teacher = true } = {}) {
  const cards = [];
  const writes = [];
  return {
    cards, writes,
    query: async (sql, args) => {
      if (sql.includes('FROM system_settings')) return { rows: [
        { key: 'schoolName', subkey: '', value1: school },
        ...(demo ? [{ key: 'instance', subkey: '', value1: 'demo' }] : []),
      ] };
      if (sql.includes('FROM users')) return { rows: teacher ? [{ username: 'teacher12', role: 'Teacher' }] : [] };
      if (sql.includes('FROM media_cards')) return { rows: cards.filter(c => c.owner === args[0] && c.url === args[1]) };
      throw new Error('Unexpected query');
    },
    saveMediaCard: async ([payload], user) => {
      writes.push({ payload, user });
      const card = { id: cards.length + 1, owner: user.id, url: payload.url };
      cards.push(card);
      return { status: 'success', id: card.id };
    },
  };
}

test('wrong school, demo, or missing teacher12 never writes cards', async () => {
  for (const options of [{ school: 'โรงเรียนอื่น' }, { demo: true }, { teacher: false }]) {
    const db = fixture(options);
    await assert.rejects(importMedia(db, true));
    assert.equal(db.writes.length, 0);
  }
});

test('default is dry-run; apply creates three teacher-only cards owned by teacher12', async () => {
  const db = fixture();
  assert.equal((await importMedia(db)).filter(r => r.status === 'would-create').length, 3);
  assert.equal(db.writes.length, 0);
  assert.equal((await importMedia(db, true)).filter(r => r.status === 'created').length, 3);
  for (const { payload, user } of db.writes) {
    assert.equal(user.id, 'teacher12');
    assert.deepEqual(payload.visibleLevels, []);
    assert.equal(payload.isFeatured, false);
    assert.match(payload.url, /^https:\/\/pw\.pssms\.app\/teaching-media\//);
  }
});

test('reimport preserves existing cards including teacher deletions', async () => {
  const db = fixture();
  await importMedia(db, true);
  db.cards[0].deleted_at = '2026-10-29';
  assert.equal((await importMedia(db, true)).filter(r => r.status === 'exists').length, 3);
  assert.equal(db.writes.length, 3);
  assert.equal(db.cards[0].deleted_at, '2026-10-29');
});
