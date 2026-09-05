/**
 * วันหมดอายุที่ผู้ขายตั้งมาทาง env — `db/applyLicense.js`
 *
 * ทางนี้เป็นทางเดียวที่ผู้ขายตั้งวันหมดอายุได้โดยไม่ต้องต่อ Postgres ของโรงเรียน
 * (ADR 0001) ถ้าพังจะพังเงียบ — โรงเรียนใช้งานต่อไปโดยไม่มีวันหมดอายุ
 */
'use strict';
const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const applyLicense = require('../db/applyLicense');
const cache = require('../lib/cache');

const read = async () => {
  const { rows } = await query(
    "SELECT value1 FROM system_settings WHERE key='license' AND subkey='until'");
  return rows.length ? rows[0].value1 : null;
};

beforeEach(async () => {
  delete process.env.LICENSE_UNTIL;
  await query("DELETE FROM system_settings WHERE key='license' AND subkey='until'");
  cache.del('license_status');
});

// ⚠️ ต้องล้างค่าก่อน `after(stop)` — hook วิ่งตามลำดับที่ประกาศ
// ปิด pool ไปแล้วค่อยสั่ง query จะได้ "Cannot use a pool after calling end"
after(async () => {
  delete process.env.LICENSE_UNTIL;
  await query("DELETE FROM system_settings WHERE key='license' AND subkey='until'");
  cache.del('license_status');
});

after(stop);

test('ไม่ตั้ง env = ไม่แตะอะไรเลย', async () => {
  await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('license','until','2027-01-01')`);
  assert.strictEqual(await applyLicense.run(), null);
  assert.strictEqual(await read(), '2027-01-01', 'ค่าเดิมต้องอยู่ครบ');
});

test('ตั้งวันมาแล้วเขียนลงฐานข้อมูลจริง', async () => {
  process.env.LICENSE_UNTIL = '2027-03-31';
  assert.strictEqual(await applyLicense.run(), '2027-03-31');
  assert.strictEqual(await read(), '2027-03-31');
});

test('ค่าเดิมตรงกันแล้วไม่เขียนซ้ำ', async () => {
  process.env.LICENSE_UNTIL = '2027-03-31';
  await applyLicense.run();
  assert.strictEqual(await applyLicense.run(), null, 'รอบสองไม่ต้องทำอะไร');
});

test('โรงเรียนแก้วันเองแล้วค่าของผู้ขายกลับมาตอน deploy', async () => {
  process.env.LICENSE_UNTIL = '2027-03-31';
  await applyLicense.run();
  await query(`UPDATE system_settings SET value1='2099-12-31' WHERE key='license' AND subkey='until'`);

  assert.strictEqual(await applyLicense.run(), '2027-03-31',
    'วันหมดอายุเป็นของผู้ขาย ไม่ใช่ของโรงเรียน — ต่างจากรหัส admin ที่ทำครั้งเดียว');
  assert.strictEqual(await read(), '2027-03-31');
});

test('none = ปลดวันหมดอายุ (โรงเรียนเรา เดโม)', async () => {
  await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('license','until','2027-01-01')`);
  process.env.LICENSE_UNTIL = 'none';
  assert.strictEqual(await applyLicense.run(), 'none');
  assert.strictEqual(await read(), null);
});

test('ค่าผิดรูปไม่เขียนอะไรลงไป', async () => {
  await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('license','until','2027-01-01')`);
  process.env.LICENSE_UNTIL = '31/03/2027';
  assert.strictEqual(await applyLicense.run(), null);
  assert.strictEqual(await read(), '2027-01-01',
    'เขียนค่าผิดรูปลงไป = lib/license.js อ่านไม่ออกแล้วโรงเรียนกลายเป็นไม่จำกัดเงียบ ๆ');
});

test('getLicenseInfo บอกวันหมดอายุเสมอ ต่างจากแถบเตือน', async () => {
  process.env.LICENSE_UNTIL = '2027-03-31';
  await applyLicense.run();

  const info = await ok('getLicenseInfo', [], 'admin');
  assert.strictEqual(info.until, '2027-03-31');
  assert.strictEqual(info.state, 'active');
  assert.ok(info.daysLeft > 30);

  // แถบเตือนยังเงียบอยู่ เพราะยังเหลือเวลาเยอะ — คนละหน้าที่กัน
  const banner = await ok('getLicenseStatus', [], 'admin');
  assert.strictEqual(banner.show, false);
});

test('getLicenseInfo เป็นของ Admin เท่านั้น', async () => {
  const { denied } = require('./helpers/api');
  await denied('getLicenseInfo', [], 'teacher1');
});
