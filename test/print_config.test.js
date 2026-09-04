/**
 * หัวกระดาษ ปพ.5 — `savePrintConfigData` / `getPrintConfigData`
 *
 * ค่าพวกนี้พิมพ์ลงเอกสารราชการ หายไปแล้วไม่มี error ไม่มีใครรู้จนครูดูกระดาษ
 * ⚠️ `savePrintConfigData` เขียน `sys_data` **ทับทั้งก้อน ไม่ได้ merge**
 * ฟิลด์ใดที่ฟอร์มไม่ส่งมาจึงหายทันทีที่กดบันทึก — เทสนี้ล็อกไว้ไม่ให้เกิดอีก
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');

after(stop);

const ADDRESS = 'อำเภอทดสอบ จังหวัดทดสอบ';

const fullSys = (over = {}) => ({
  school_name: 'โรงเรียนทดสอบวิทยา',
  school_address: ADDRESS,
  principal_name: 'ผอ.ทดสอบ',
  measure_head: 'ครูทดสอบ',
  ...over,
});

const save = (sys) => ok('savePrintConfigData', [{ term: TERM, year: YEAR, sys, hr: [] }], 'admin');
const read = () => ok('getPrintConfigData', [TERM, YEAR], 'admin');

test('ที่ตั้งโรงเรียนบันทึกแล้วอ่านกลับมาได้', async () => {
  await save(fullSys());
  const res = await read();
  assert.strictEqual(res.sys.school_address, ADDRESS);
  assert.strictEqual(res.sys.school_name, 'โรงเรียนทดสอบวิทยา');
});

test('ฟอร์มที่ไม่ส่งที่ตั้งมาด้วยจะลบค่าเดิมทิ้ง — นี่คือเหตุผลที่ต้องมีช่องกรอกใน UI', async () => {
  await save(fullSys());
  assert.strictEqual((await read()).sys.school_address, ADDRESS);

  // จำลองฟอร์มรุ่นเก่าที่ไม่มีช่อง school_address
  const without = fullSys();
  delete without.school_address;
  await save(without);

  const res = await read();
  assert.strictEqual(res.sys.school_address, '',
    'sys_data ถูกเขียนทับทั้งก้อน ฟิลด์ที่ฟอร์มไม่ส่งมาจึงหาย — ถ้าเทสนี้แดงแปลว่า ' +
    'พฤติกรรมเปลี่ยนไปเป็น merge แล้ว ให้แก้คอมเมนต์ใน Scripts_Admin.html ตามด้วย');

  await save(fullSys());   // คืนค่าให้เทสอื่น
});

test('ฟอร์มตั้งค่าการพิมพ์มีช่องที่ตั้งโรงเรียน และส่งค่านั้นตอนบันทึก', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');

  assert.ok(src('Page_Score_Entry.html').includes('id="cfg_school_address"'),
    'ไม่มีช่องกรอก = ผู้ดูแลโรงเรียนใหม่ตั้งที่อยู่บนเอกสารราชการไม่ได้เลย');
  assert.ok(src('Scripts_Admin.html').includes('school_address:'),
    'ฟอร์มต้องส่ง school_address ตอนบันทึก ไม่งั้นค่าเดิมโดนลบทุกครั้งที่กด');
});

test('ชื่อโรงเรียนบนหัวเอกสารไม่มี default เป็นชื่อโรงเรียนอื่น', async () => {
  const without = fullSys();
  delete without.school_name;
  await query(`DELETE FROM system_settings WHERE key IN ('schoolName','school_name')`);
  require('../lib/cache').del('system_config');
  try {
    await save(without);
    assert.strictEqual((await read()).sys.school_name, '');
  } finally {
    require('../lib/cache').del('system_config');
    await save(fullSys());
  }
});

test('เป็น ADMIN_ONLY — ครูแก้หัวกระดาษเอกสารราชการไม่ได้', async () => {
  await denied('savePrintConfigData', [{ term: TERM, year: YEAR, sys: fullSys(), hr: [] }], 'teacher1');
});
