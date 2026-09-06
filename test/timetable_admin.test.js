/**
 * แก้ไขตารางสอนจากหน้าจัดการตารางสอน
 *
 * บั๊กที่ล็อกไว้ที่นี่: modal "จัดการคาบเรียน" มีคาบให้เลือกแค่ 1–8 พอเปิดแถวโฮมรูม
 * (คาบ '0') `select.value` กลายเป็น '' แล้วกดบันทึกคือเขียนคาบว่างทับของจริง
 * ขึ้น "บันทึกสำเร็จ" ตามปกติ แล้วคาบนั้นหลุดจากทุกหน้าที่จับคู่ด้วยวัน+คาบ
 * — ฝั่งหน้าเว็บกันด้วย dropdown ที่ใส่ค่าเดิมเข้าไปเสมอ ฝั่ง server กันด้วยเทสชุดนี้
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');

after(stop);

const src = (f) => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8');

async function makeRow(over = {}) {
  const r = {
    subject_code: 'ว30205', subject_name: 'ฟิสิกส์', level: 'ม.6', room: '1',
    location: '', teacher_id: 'teacher1', day: 'จันทร์', period: '6', ...over,
  };
  const { rows } = await query(
    `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [r.subject_code, r.subject_name, r.level, r.room, r.location,
     r.teacher_id, r.day, r.period, TERM, YEAR]
  );
  return rows[0].id;
}

// รูป data ที่ frontend ส่งมา: [code, name, level, room, location, teacherId, day, period, term, year]
const asArray = (over = {}) => {
  const r = {
    subject_code: 'ว30205', subject_name: 'ฟิสิกส์', level: 'ม.6', room: '1',
    location: '', teacher_id: 'teacher1', day: 'จันทร์', period: '6', ...over,
  };
  return [r.subject_code, r.subject_name, r.level, r.room, r.location,
    r.teacher_id, r.day, r.period, TERM, YEAR];
};

const readRow = async (id) =>
  (await query(`SELECT * FROM timetable WHERE id=$1`, [id])).rows[0];

test('แก้คาบเรียนแล้วค่าที่เปลี่ยนต้องลง DB จริง', async () => {
  const id = await makeRow();
  try {
    const res = await ok('updateTimetableRow', [String(id), asArray({
      subject_code: 'ว30205', subject_name: 'ฟิสิกส์ 2', level: 'ม.5', room: '2',
      location: 'อาคาร 3', teacher_id: 'teacher1', day: 'อังคาร', period: '4',
    })], 'admin');
    assert.strictEqual(res.status, 'success');
    const row = await readRow(id);
    assert.strictEqual(row.subject_name, 'ฟิสิกส์ 2');
    assert.strictEqual(row.level, 'ม.5');
    assert.strictEqual(row.room, '2');
    assert.strictEqual(row.day, 'อังคาร');
    assert.strictEqual(row.period, '4');
  } finally {
    await query(`DELETE FROM timetable WHERE id=$1`, [id]);
  }
});

test('คาบว่างต้องถูกปฏิเสธ ไม่ใช่เขียนทับแล้วบอกว่าสำเร็จ', async () => {
  const id = await makeRow({ subject_code: 'HR', subject_name: 'โฮมรูม', period: '0' });
  try {
    const err = await denied('updateTimetableRow',
      [String(id), asArray({ subject_code: 'HR', subject_name: 'โฮมรูม', period: '' })], 'admin');
    assert.match(err, /กรอกไม่ครบ/);
    assert.strictEqual((await readRow(id)).period, '0', 'ของเดิมต้องไม่ถูกแตะ');
  } finally {
    await query(`DELETE FROM timetable WHERE id=$1`, [id]);
  }
});

test('ระดับชั้น/ห้องว่างก็ต้องถูกปฏิเสธเหมือนกัน', async () => {
  const id = await makeRow();
  try {
    const err = await denied('updateTimetableRow',
      [String(id), asArray({ level: '', room: '' })], 'admin');
    assert.match(err, /ระดับชั้น/);
    assert.match(err, /ห้อง/);
  } finally {
    await query(`DELETE FROM timetable WHERE id=$1`, [id]);
  }
});

// หน้าเว็บฝั่งครูส่งคาบผ่าน parseInt — ช่องว่างกลายเป็น NaN ซึ่งไม่ใช่ค่าว่าง
test('คาบที่ไม่ใช่ตัวเลข (NaN จาก parseInt) ต้องถูกปฏิเสธ', async () => {
  const id = await makeRow();
  try {
    const err = await denied('updateTimetableRow',
      [String(id), asArray({ period: 'NaN' })], 'admin');
    assert.match(err, /คาบต้องเป็นตัวเลข/);
  } finally {
    await query(`DELETE FROM timetable WHERE id=$1`, [id]);
  }
});

// ── markup ที่บั๊กเดิมพึ่งพา — ย้อนกลับไปเป็นช่องพิมพ์เมื่อไหร่บั๊กกลับมาทันที ────

test('ชั้น/ห้องในโมดัลจัดการคาบเรียนต้องเป็น dropdown ไม่ใช่ช่องพิมพ์', () => {
  const html = src('Page_Admin_Timetable.html');
  assert.match(html, /<select id="editLevel"/, 'ระดับชั้นต้องเป็น select');
  assert.match(html, /<select id="editRoom"/, 'ห้องต้องเป็น select');
});

test('ปุ่มบันทึก/ลบคาบเรียนต้องมีตัวรับ error ไม่งั้นปุ่มค้างหมุนตลอดกาล', () => {
  const js = src('Scripts_Admin.html');
  const save = js.slice(js.indexOf('function saveTimetableEdit'), js.indexOf('function _ttoReloadAllRows'));
  assert.ok(save.includes('withFailureHandler'), 'saveTimetableEdit ต้องมี withFailureHandler');
  const del = js.slice(js.indexOf('function confirmDeleteTimetable'));
  assert.ok(del.slice(0, 800).includes('withFailureHandler'), 'confirmDeleteTimetable ต้องมี withFailureHandler');
});

test('แก้/ลบคาบแล้วต้องรีเฟรชตารางรวมทุกครู ไม่งั้นแท็บแรกโชว์ค่าเดิม', () => {
  const js = src('Scripts_Admin.html');
  assert.ok(js.includes('function _ttoReloadAllRows'));
  const save = js.slice(js.indexOf('function saveTimetableEdit'), js.indexOf('function _ttoReloadAllRows'));
  assert.ok(save.includes('_ttoReloadAllRows()'));
});
