'use strict';
/**
 * นาฬิกาหมดอายุการใช้งาน
 *
 * เทสต์ชุดนี้ล็อกสองอย่างที่พลาดแล้วเจ็บคนละแบบ:
 *   1) หมดอายุแล้วแต่ยังบันทึกได้ — เราไม่รู้ตัว โรงเรียนใช้ฟรีต่อไป
 *   2) หมดอายุแล้วพิมพ์ ปพ.5 ไม่ได้ — ครูส่งเอกสารราชการไม่ทันเพราะเรื่องค่าบริการ
 *      ข้อนี้หนักกว่ามาก และห้ามเกิดเด็ดขาดไม่ว่าสถานะจะเป็นอะไร
 */
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { call, ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const license = require('../lib/license');

const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function setLicense(until) {
  if (until === null) {
    await query(`DELETE FROM system_settings WHERE key='license' AND subkey='until'`);
  } else {
    await query(
      `INSERT INTO system_settings(key, subkey, value1) VALUES('license','until',$1)
       ON CONFLICT(key, subkey) DO UPDATE SET value1=$1`,
      [until]
    );
  }
  license.invalidate();   // แคช 60 วินาที ไม่ล้างแล้วเทสต์ถัดไปเห็นค่าเก่า
}

afterEach(() => setLicense(null));
after(async () => { await setLicense(null); await stop(); });

// ---------------------------------------------------------------- classify

test('ไม่ได้ตั้งวันหมดอายุ = ใช้งานได้ไม่จำกัด', () => {
  assert.equal(license.classify(null).state, 'none');
});

test('เส้นแบ่งของแต่ละสถานะ', () => {
  const now = new Date('2026-06-15T10:00:00Z');
  const st = (d) => license.classify(d, now).state;
  assert.equal(st('2026-07-16'), 'active', 'เหลือ 31 วัน ยังไม่ต้องเตือน');
  assert.equal(st('2026-07-15'), 'warn',   'เหลือ 30 วัน เริ่มเตือน');
  assert.equal(st('2026-06-15'), 'warn',   'วันสุดท้ายยังใช้ได้เต็มวัน');
  assert.equal(st('2026-06-14'), 'grace',  'เลยกำหนด 1 วัน = ผ่อนผัน');
  assert.equal(st('2026-06-01'), 'grace',  'เลยกำหนด 14 วัน = วันสุดท้ายของผ่อนผัน');
  assert.equal(st('2026-05-31'), 'locked', 'เลยกำหนด 15 วัน = อ่านอย่างเดียว');
});

// ---------------------------------------------------------------- dispatcher

test('ยังไม่หมดอายุ — บันทึกได้ตามปกติ', async () => {
  await setLicense(iso(60));
  const cards = await ok('getMediaCards', [], 'admin');
  assert.ok(Array.isArray(cards));
});

test('ช่วงผ่อนผัน — ยังบันทึกได้', async () => {
  await setLicense(iso(-3));
  const res = await call('saveTodoList', ['admin', '[]'], 'admin');
  assert.equal(res.__error, undefined, 'อยู่ในช่วงผ่อนผันต้องยังบันทึกได้');
});

test('พ้นผ่อนผัน — บันทึกไม่ได้', async () => {
  await setLicense(iso(-20));
  const res = await call('saveTodoList', ['admin', '[]'], 'admin');
  assert.equal(res.__licenseLocked, true);
  assert.match(res.__error, /อ่านอย่างเดียว/);
});

test('พ้นผ่อนผัน — อ่านข้อมูลได้อยู่', async () => {
  await setLicense(iso(-20));
  const cards = await ok('getMediaCards', [], 'admin');
  assert.ok(Array.isArray(cards), 'ครูต้องยังเปิดดูข้อมูลเดิมได้');
});

test('พ้นผ่อนผัน — พิมพ์ ปพ.5 และ export ต้องไม่ถูกบล็อก', async () => {
  await setLicense(iso(-365));
  for (const fn of ['generatePP5Template', 'exportClubsForTerm', 'getPrintConfigData']) {
    const res = await call(fn, [], 'admin');
    assert.notEqual(res.__licenseLocked, true, `${fn} ต้องไม่โดนกำแพงค่าบริการ`);
  }
});

test('พ้นผ่อนผัน — ยังเข้าสู่ระบบได้', async () => {
  await setLicense(iso(-365));
  const res = await call('checkLogin', ['admin', 'admin123']);
  assert.notEqual(res.__licenseLocked, true, 'ล็อกอินไม่ได้ = เปิดดูข้อมูลตัวเองไม่ได้เลย');
});

test('ฟังก์ชันเขียนที่เพิ่มใหม่ต้องถูกบล็อกโดยปริยาย', async () => {
  await setLicense(iso(-20));
  // ชื่อที่ไม่มีอยู่จริง — ถ้าเป็น denylist จะหลุดไปถึง "not implemented"
  const res = await call('saveSomethingInvented', [], 'admin');
  assert.equal(res.__licenseLocked, true, 'allowlist ต้อง fail closed');
});

// ---------------------------------------------------------------- แถบแจ้งเตือน

test('ไม่ได้ตั้งวันหมดอายุ — ไม่ขึ้นแถบ', async () => {
  await setLicense(null);
  assert.equal((await ok('getLicenseStatus', [], 'admin')).show, false);
});

test('เหลือน้อยกว่า 30 วัน — Admin เห็น ครูไม่เห็น', async () => {
  await setLicense(iso(10));
  const forAdmin = await ok('getLicenseStatus', [], 'admin');
  assert.equal(forAdmin.show, true);
  assert.match(forAdmin.text, /ต่ออายุ/);

  const forTeacher = await ok('getLicenseStatus', [], 'teacher1');
  assert.equal(forTeacher.show, false, 'ครูไม่ควรถูกรบกวนตอนที่ยังไม่ถึงกำหนด');
});

test('เลยกำหนดแล้ว — ทุกคนเห็น', async () => {
  await setLicense(iso(-3));
  for (const who of ['admin', 'teacher1', 'student']) {
    const st = await ok('getLicenseStatus', [], who);
    assert.equal(st.show, true, `${who} ต้องเห็นแถบ`);
    assert.equal(st.state, 'grace');
  }
});

test('โหมดอ่านอย่างเดียว — แถบต้องบอกว่าพิมพ์ ปพ.5 ได้', async () => {
  await setLicense(iso(-30));
  const st = await ok('getLicenseStatus', [], 'teacher1');
  assert.equal(st.state, 'locked');
  assert.match(st.text, /ปพ\.5/);
});
