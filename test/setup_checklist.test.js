/**
 * รายการตั้งค่าเริ่มต้นของโรงเรียนใหม่ — `functions/setupChecklist.js`
 *
 * การ์ดนี้เป็นสิ่งเดียวที่บอกโรงเรียนใหม่ว่าต้องทำอะไรบ้าง ถ้ามันรายงานผิด
 * (บอกว่าครบทั้งที่ยังไม่ครบ) โรงเรียนจะไปเจอปัญหาตอนครูเริ่มใช้จริงแทน
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const cache = require('../lib/cache');
const adminIssued = require('../db/adminIssued');

after(stop);

const item = (res, key) => res.items.find((i) => i.key === key);
const fresh = async () => { cache.del('system_config'); return ok('getSetupChecklist', [], 'admin'); };

test('ทุกข้อมี label, hint และหน้าปลายทางให้กดไป', async () => {
  const res = await fresh();
  assert.strictEqual(res.total, res.items.length);
  assert.strictEqual(res.done, res.items.filter((i) => i.done).length);
  for (const i of res.items) {
    assert.ok(i.key && i.label && i.hint, `${i.key} ข้อมูลไม่ครบ`);
    assert.match(i.page, /^Page_/, `${i.key} ไม่มีหน้าปลายทาง`);
  }
});

test('หน้าปลายทางทุกข้อต้องมีอยู่จริง และเป็นหน้าที่แก้เรื่องนั้นได้', async () => {
  // เคยชี้ข้อ "ตั้งครูที่ปรึกษา" ไปหน้าตารางสอน ทั้งที่ตัวแก้อยู่ในแท็บของหน้าจัดการผู้ใช้งาน
  // ปุ่ม "ไปตั้งค่า" พาไปผิดหน้าแล้วโรงเรียนใหม่จะหาไม่เจอ โดยที่ไม่มีอะไรพัง
  const fs = require('node:fs');
  const path = require('node:path');
  const srcDir = path.join(__dirname, '../src');

  // key ของ element ที่พิสูจน์ว่าหน้านั้นแก้เรื่องนั้นได้จริง
  const PROOF = {
    schoolName:    'inputSchoolName',
    schoolLogo:    'logoFileInput',
    term:          'inputTerm',
    termDates:     'inputStartDate',
    teachers:      "handleFileUpload(this, 'teacher')",
    students:      "handleFileUpload(this, 'student')",
    timetable:     'handleTimetableUpload(this)',
    homeroom:      'ttoAddHomeroomRow()',
    pp5Header:     'cfg_principal_name',
    adminPassword: "openModal('add')",
  };

  const res = await fresh();
  for (const it of res.items) {
    const candidates = [`${it.page}.html`, `${it.page}.html.html`]
      .map((f) => path.join(srcDir, f)).filter((f) => fs.existsSync(f));
    assert.ok(candidates.length, `ไม่มีไฟล์หน้า ${it.page} ใน src/`);
    const html = fs.readFileSync(candidates[0], 'utf8');
    assert.ok(html.includes(PROOF[it.key]),
      `${it.key} ชี้ไป ${it.page} แต่หน้านั้นไม่มี "${PROOF[it.key]}"`);
  }
});

test('ลำดับในลิสต์ต้องเป็นลำดับที่ทำได้จริง — ครูมาก่อนตารางสอน, นักเรียนมาก่อนครูที่ปรึกษา', async () => {
  const keys = (await fresh()).items.map((i) => i.key);
  assert.ok(keys.indexOf('teachers') < keys.indexOf('timetable'),
    'นำเข้าตารางสอนก่อนครูจะถูกปฏิเสธทั้งไฟล์');
  assert.ok(keys.indexOf('students') < keys.indexOf('homeroom'),
    'ตั้งครูที่ปรึกษาก่อนมีนักเรียนจะไม่มีรายชื่อห้องให้เลือก');
});

test('seed dev: ยังไม่ได้ตั้งชื่อโรงเรียน → ข้อนั้นต้องยังไม่ติ๊ก', async () => {
  await query(`DELETE FROM system_settings WHERE key IN ('schoolName','school_name')`);
  const res = await fresh();
  assert.strictEqual(item(res, 'schoolName').done, false);
});

test('ตั้งชื่อโรงเรียนแล้วข้อนั้นติ๊กเอง และยอดรวมขยับ', async () => {
  await query(`DELETE FROM system_settings WHERE key IN ('schoolName','school_name')`);
  const before = await fresh();
  await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('schoolName','','โรงเรียนทดสอบวิทยา')`);
  const afterSet = await fresh();
  assert.strictEqual(item(afterSet, 'schoolName').done, true);
  assert.strictEqual(afterSet.done, before.done + 1);
  await query(`DELETE FROM system_settings WHERE key='schoolName'`);
  cache.del('system_config');
});

test('ยังไม่ตั้งเทอม/ปี → ข้อนั้นต้องไม่ติ๊ก แม้ getSystemConfig จะใส่ default ให้', async () => {
  // `getSystemConfig` คืน term:'1' year:'2568' เป็น default เมื่อไม่มีแถว Active/Term
  // ถ้า checklist เชื่อค่านั้น ข้อนี้จะติ๊ก ✓ เสมอแม้แต่ DB เปล่า แล้วโรงเรียนใหม่
  // จะนำเข้านักเรียนทั้งรุ่นเข้าปี 2568 โดยไม่มีอะไรเตือน
  const { rows: saved } = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='Active' AND subkey='Term'`
  );
  await query(`DELETE FROM system_settings WHERE key='Active' AND subkey='Term'`);
  try {
    const res = await fresh();
    assert.strictEqual(item(res, 'term').done, false);
    // ยืนยันว่ามันเป็น default จริง ไม่ใช่ว่า config ว่างไปด้วย
    const cfg = await ok('getSystemConfig', [], 'admin');
    assert.strictEqual(cfg.year, '2568', 'ค่า default ที่หลอกให้ข้อนี้ติ๊กยังอยู่');
  } finally {
    if (saved.length) {
      await query(
        `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('Active','Term',$1,$2)`,
        [saved[0].value1, saved[0].value2]
      );
    }
    cache.del('system_config');
  }
});

test('ตั้งเทอม/ปีแล้วข้อนั้นติ๊ก', async () => {
  const res = await fresh();
  assert.strictEqual(item(res, 'term').done, true, 'seed มีแถว Active/Term อยู่');
});

test('นับครู/นักเรียน/ตารางสอน/ครูที่ปรึกษา จาก DB จริง ไม่ใช่ค่าคงที่', async () => {
  const res = await fresh();
  for (const key of ['teachers', 'students', 'timetable', 'homeroom']) {
    assert.strictEqual(typeof item(res, key).count, 'number', `${key} ต้องบอกจำนวน`);
    assert.ok(item(res, key).count > 0, `seed มีข้อมูล ${key} อยู่แล้ว`);
    assert.strictEqual(item(res, key).done, true);
  }
});

test('ตารางสอนไม่นับแถว HR — ไม่งั้นตั้งครูที่ปรึกษาแล้วข้อนำเข้าตารางสอนติ๊กเอง', async () => {
  const { rows } = await query(
    `SELECT count(*)::int n FROM timetable WHERE subject_code='HR'`
  );
  assert.ok(rows[0].n > 0, 'seed ต้องมีแถว HR ไม่งั้นเทสนี้ไม่ได้ทดสอบอะไร');
  const res = await fresh();
  const { rows: real } = await query(
    `SELECT count(*)::int n FROM timetable
      WHERE term='1' AND year='2569' AND subject_code<>'HR'`
  );
  assert.strictEqual(item(res, 'timetable').count, real[0].n);
});

test('บัญชี admin ที่ยังใช้รหัสเริ่มต้นต้องขึ้นว่ายังไม่ทำ', async () => {
  const res = await fresh();
  assert.strictEqual(item(res, 'adminPassword').done, false, 'seed ตั้ง admin/1234 ไว้');

  await query(`UPDATE users SET password='ยาวและเดายาก' WHERE username='admin'`);
  try {
    assert.strictEqual(item(await fresh(), 'adminPassword').done, true);
  } finally {
    await query(`UPDATE users SET password='1234' WHERE username='admin'`);
  }
});

test('รหัสสุ่มที่ผู้ขายออกให้ก็ยังนับว่ายังไม่เปลี่ยน', async () => {
  // โรงเรียนใหม่ไม่มีรหัส '1234' อีกแล้ว — bootstrapAdmin บังคับให้ตั้งรหัสเอง
  // ถ้าข้อนี้ดูแค่ '1234' มันจะติ๊ก ✓ ตั้งแต่วินาทีแรกทั้งที่ยังใช้รหัสที่เราส่งไปทางไลน์
  const issued = 'สุ่มมาจากระบบหลังบ้าน';
  await query(`UPDATE users SET password=$1 WHERE username='admin'`, [issued]);
  await adminIssued.record(issued);
  try {
    assert.strictEqual(item(await fresh(), 'adminPassword').done, false);

    await query(`UPDATE users SET password='ที่โรงเรียนตั้งเอง' WHERE username='admin'`);
    assert.strictEqual(item(await fresh(), 'adminPassword').done, true);
  } finally {
    await query(`UPDATE users SET password='1234' WHERE username='admin'`);
    await query('DELETE FROM system_settings WHERE key=$1 AND subkey=$2',
      [adminIssued.KEY, adminIssued.SUBKEY]);
  }
});

test('ไม่คืนรหัสผ่านออกมาไม่ว่าข้อไหน', async () => {
  const res = await fresh();
  assert.ok(!JSON.stringify(res).includes('1234'), 'ห้ามให้รหัสผ่านหลุดออกไปกับผลลัพธ์');
});

test('เป็น ADMIN_ONLY — ครูและ Executive เรียกไม่ได้', async () => {
  await denied('getSetupChecklist', [], 'teacher1');
  await denied('getSetupChecklist', [], 'executive');
});

test('อยู่ใน READONLY_ALLOWED — โรงเรียนหมดสัญญายังดูรายการตั้งค่าได้', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../routes/gas.js'), 'utf8'
  );
  const list = src.slice(src.indexOf('READONLY_ALLOWED'), src.indexOf('const leaveBundle'));
  assert.ok(list.includes("'getSetupChecklist'"));
});
