/**
 * ตัวกันชนฐานข้อมูล dev — `lib/devLock.js`
 *
 * ⚠️ ปัญหาที่แก้: `npm test` ล้างฐานข้อมูลเป็น pretest ทุกครั้ง สอง process ที่รัน
 * พร้อมกันบน DB เดียวกันจะล้างทับกันกลางคัน แล้วอีกฝ่ายได้เทสแดงที่ไม่ใช่บั๊กของใครเลย
 * เกิดจริงตอนมี agent สองตัวทำงานใน repo เดียวกัน
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { acquire } = require('../lib/devLock');
const { stop } = require('./helpers/api');

after(stop);

test('จับล็อกซ้อนไม่ได้ และข้อความบอกทางออก', async () => {
  const release = await acquire('ฝั่งแรก');
  try {
    await assert.rejects(() => acquire('ฝั่งที่สอง'), (err) => {
      assert.match(err.message, /มี process อื่นใช้อยู่/);
      // ต้องบอกวิธีทำงานพร้อมกันจริง ๆ ไม่ใช่แค่บอกว่าชน
      assert.match(err.message, /createdb pssms_dev_/);
      return true;
    });
  } finally {
    await release();
  }
});

test('คืนล็อกแล้วจับใหม่ได้', async () => {
  const release = await acquire('รอบแรก');
  await release();
  const again = await acquire('รอบสอง');
  await again();
});

test('คีย์ต้องไม่ชนกับล็อกของ migration', () => {
  // ชนกันเมื่อไหร่ = seed จะบล็อก migration ตอน boot โดยไม่มีใครเดาออก
  const migrate = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../db/migrate.js'), 'utf8');
  const key = Number(String(migrate.match(/LOCK_KEY\s*=\s*([\d_]+)/)[1]).replace(/_/g, ''));
  assert.notStrictEqual(key, require('../lib/devLock').LOCK_KEY);
});
