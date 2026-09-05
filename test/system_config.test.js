/**
 * ตั้งค่าระบบ — ภาคเรียนและปีการศึกษาที่ใช้งาน
 *
 * ค่านี้เป็นตัวกำหนดว่าข้อมูลที่นำเข้าจะเข้าเทอมไหน ตารางสอนของใครจะขึ้น
 * และรายงานทั้งระบบจะนับจากช่วงไหน — ตั้งไม่ได้ = ใช้ระบบต่อไม่ได้ทั้งโรงเรียน
 *
 * ⚠️ **ห้ามเขียนทับเทอมของ seed** ไฟล์เทสอื่นบน DB เดียวกันอ่าน `TermData` ของ
 * เทอมปัจจุบันเป็นช่วงวันสำหรับ "คาบที่ควรสอน" — เขียนทับเมื่อไหร่ progress_board
 * กับ student_watch พังทั้งไฟล์โดยที่ error ไม่ได้ชี้มาทางนี้เลย (เคยทำมาแล้ว)
 * เทสนี้จึงเขียนลงปี 2570 ซึ่งไม่มีใครใช้ แล้วเก็บกวาดใน after()
 *
 * ⚠️ **วันที่ใน `TermData` เป็น ค.ศ. ไม่ใช่ พ.ศ.** แม้ป้ายปีการศึกษาจะเป็น พ.ศ.
 * (ดูแถว `2_2568` = `2025-10-27` ของจริง) · ใส่ `2570-05-11` แล้วช่วงเทอมกลายเป็น
 * ปี ค.ศ. 2570 ซึ่งยังมาไม่ถึง แล้วทุกอย่างที่นับ "คาบที่ควรสอน" จะได้ศูนย์
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { ok, denied, stop } = require('./helpers/api');
const { TERM, YEAR } = require('./helpers/fixtures');
const { query } = require('../lib/db');
const cache = require('../lib/cache');

const Y = '2570';                       // ปีที่ seed ไม่ได้ใช้ — เขียนทับได้ปลอดภัย

// ⚠️ ต้องคืนค่าเดิมก่อน `after(stop)` — pool ปิดไปแล้วเขียนไม่ได้อีก
// (ลำดับการทำงานของ after() คือลำดับที่ประกาศ)
after(async () => {
  await query(
    `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('Active','Term',$1,$2)
     ON CONFLICT(key,subkey) DO UPDATE SET value1=$1, value2=$2`, [TERM, YEAR],
  );
  await query(
    `DELETE FROM system_settings WHERE key='TermData' AND subkey LIKE $1`, [`%_${Y}`],
  );
  cache.del('system_config');
});
after(stop);

const config = async () => { cache.del('system_config'); return ok('getSystemConfig', [], 'admin'); };

test('บันทึกภาคเรียนแล้วต้องเปลี่ยนจริง ไม่ใช่ขึ้นสำเร็จแล้วค่าเดิมค้าง', async () => {
  // ⚠️ หน้าเว็บส่ง 4 ตัวเรียงกัน `saveSystemConfig(term, year, start, end)`
  // เดิม backend รับเป็นก้อนเดียว → term (สตริง) ไปเป็น configData แล้วทุก if ตกหมด
  // ไม่เขียนอะไรลง DB เลยสักบรรทัด แต่คืน success ทุกครั้ง
  assert.strictEqual((await config()).term, TERM, 'seed เปลี่ยนไปแล้วหรือเปล่า');

  const res = await ok('saveSystemConfig', ['2', Y, '2027-11-01', '2028-03-31'], 'admin');
  assert.strictEqual(res.status, 'success');

  const after_ = await config();
  assert.strictEqual(after_.term, '2', 'ภาคเรียนไม่เปลี่ยน ทั้งที่ขึ้นว่าบันทึกสำเร็จ');
  assert.strictEqual(after_.year, Y);
  assert.strictEqual(after_.termStart, '2027-11-01', 'วันเปิดเทอมไม่ถูกเขียน');
  assert.strictEqual(after_.termEnd, '2028-03-31');
});

test('วันเปิด-ปิดเทอมผูกกับเทอมนั้น ๆ ไม่ใช่ค่าเดียวทั้งระบบ', async () => {
  await ok('saveSystemConfig', ['1', Y, '2027-05-11', '2027-10-10'], 'admin');
  assert.strictEqual((await config()).termStart, '2027-05-11');

  // สลับกลับไปเทอม 2 ของปีเดียวกัน ต้องได้ช่วงวันของเทอมนั้นคืนมา ไม่ใช่ของเทอม 1
  await ok('saveSystemConfig', ['2', Y, '2027-11-01', '2028-03-31'], 'admin');
  assert.strictEqual((await config()).termStart, '2027-11-01',
    'TermData ต้องแยกตามเทอม — massive grid เติมคาบย้อนหลังจากช่วงนี้');
});

test('ยังรับรูปก้อนเดียวได้ — เป็นทางเดียวที่ส่ง schoolName ผ่านฟังก์ชันนี้ได้', async () => {
  const res = await ok('saveSystemConfig',
    [{ term: '1', year: Y, termStart: '2027-05-11', termEnd: '2027-10-10' }], 'admin');
  assert.strictEqual(res.status, 'success');

  const c = await config();
  assert.strictEqual(c.term, '1');
  assert.strictEqual(c.year, Y);
});

test('เป็น ADMIN_ONLY — ครูเปลี่ยนภาคเรียนของทั้งโรงเรียนไม่ได้', async () => {
  await denied('saveSystemConfig', ['2', '2599', '2099-01-01', '2099-02-02'], 'teacher1');
  assert.notStrictEqual((await config()).year, '2599');
});
