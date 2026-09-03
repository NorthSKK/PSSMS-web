/**
 * นำเข้าข้อมูล — ล็อกบั๊กสามตัวที่หลุดไปถึง production ไว้ไม่ให้กลับมา
 *
 * 1. หน้าเว็บส่ง base64 แต่ backend รอ array → คืน success ปลอม ไม่มีอะไรลง DB
 * 2. `timetable.day` เป็น TEXT เปล่า ค่าอะไรก็ INSERT ผ่าน แล้วหายเงียบตอนอ่าน
 * 3. ชื่อโรงเรียน hardcode เป็นค่า default → โรงเรียนใหม่เห็นชื่อโรงเรียนอื่นบน ปพ.5
 */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');

/**
 * ⚠️ ไฟล์นี้ต้องคืนตารางสอนของ seed ให้ครบก่อนจบ ต่างจากเทสไฟล์อื่น
 * `importTimetableCSV` ล้างตารางสอนของเทอม/ปีที่ active ทั้งหมดตามดีไซน์ (ADR 0003)
 * ไฟล์เทสรันเรียงกันบน DB เดียว (`--test-concurrency=1`) ปล่อยไว้แล้ว
 * progress_board กับ substituteAuto ที่รันทีหลังจะพังเพราะไม่มีตารางสอนให้นับ
 */
let _ttBackup = [];
before(async () => {
  const { rows } = await query(
    `SELECT subject_code,subject_name,level,room,location,teacher_id,day,period,term,year
       FROM timetable WHERE term=$1 AND year=$2 ORDER BY id`, [TERM, YEAR]
  );
  _ttBackup = rows;
});

after(async () => {
  await query(`DELETE FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  for (const r of _ttBackup) {
    await query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [r.subject_code, r.subject_name, r.level, r.room, r.location,
       r.teacher_id, r.day, r.period, r.term, r.year]
    );
  }
  await stop();
});

// ── 1. ส่งอะไรที่ไม่ใช่ array เข้ามาต้องล้มดัง ๆ ไม่ใช่ success ปลอม ───────────

const BASE64ish = 'ccjguIfguJzguLnguYnguYPguIrguYk=';

for (const fn of ['importStudentCSV', 'importTeacherCSV', 'importTimetableCSV', 'importCalendarCSV']) {
  test(`${fn}: base64 string ต้องเป็น error ไม่ใช่ "นำเข้า 0 รายการ"`, async () => {
    const err = await denied(fn, [BASE64ish], 'admin');
    assert.match(err, /ไม่ถูกรูปแบบ/);
  });

  test(`${fn}: ไฟล์ที่มีแต่หัวตาราง (array ว่าง) ต้องบอกว่าไม่มีข้อมูล`, async () => {
    const err = await denied(fn, [[]], 'admin');
    assert.match(err, /ไม่พบข้อมูล/);
  });
}

// ── 2. ตารางสอน: ชื่อวันที่ระบบอ่านไม่ออกต้องบล็อก ไม่ใช่เขียนแล้วหายทีหลัง ──────

const ttRow = (over = {}) => ({
  subjectCode: 'ว30205', subjectName: 'ฟิสิกส์', level: 'ม.6', room: '1',
  teacherId: 'teacher1', day: 'จันทร์', period: '3', location: '', ...over,
});

test('ตารางสอน: วันที่อ่านไม่ออกบล็อกทั้งไฟล์ ไม่เขียนอะไรลง DB เลย', async () => {
  const before = await query(`SELECT count(*)::int n FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  const err = await denied('importTimetableCSV',
    [[ttRow(), ttRow({ day: 'Monday', period: '4' })]], 'admin');
  assert.match(err, /อ่านไม่ออก/);
  const after_ = await query(`SELECT count(*)::int n FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  assert.strictEqual(after_.rows[0].n, before.rows[0].n, 'ไฟล์ที่มีข้อผิดพลาดต้องไม่เขียนแม้แต่แถวเดียว');
});

test('ตารางสอน: รูปย่อ "จ." แปลงเป็น "จันทร์" ให้ตรงกับที่ slotsFromRows อ่านออก', async () => {
  const res = await ok('importTimetableCSV', [[ttRow({ day: 'จ.' })]], 'admin');
  assert.strictEqual(res.imported, 1);
  const { rows } = await query(`SELECT day FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  assert.strictEqual(rows[0].day, 'จันทร์');

  const { slotsFromRows } = require('../lib/sessionCalendar');
  assert.strictEqual(slotsFromRows(rows).length, 1, 'ต้องไม่ถูก slotsFromRows ทิ้ง');
});

test('ตารางสอน: ครูที่ไม่มีในระบบเป็นข้อผิดพลาด ไม่ใช่ข้ามแถวเงียบ ๆ', async () => {
  const err = await denied('importTimetableCSV',
    [[ttRow(), ttRow({ teacherId: 'ไม่มีคนนี้', period: '5' })]], 'admin');
  assert.match(err, /ไม่พบครู/);
});

test('ตารางสอน: อัปไฟล์เดิมซ้ำแล้วจำนวนแถวเท่าเดิม ไม่เกิดแถวซ้ำ', async () => {
  const file = [ttRow(), ttRow({ day: 'อังคาร', period: '4' })];
  await ok('importTimetableCSV', [file], 'admin');
  const first = await query(`SELECT count(*)::int n FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  await ok('importTimetableCSV', [file], 'admin');
  const second = await query(`SELECT count(*)::int n FROM timetable WHERE term=$1 AND year=$2`, [TERM, YEAR]);
  assert.strictEqual(second.rows[0].n, first.rows[0].n);
  assert.strictEqual(second.rows[0].n, 2);
});

test('ตารางสอน: DELETE กวาดเฉพาะเทอมที่ active ไม่แตะเทอมอื่น', async () => {
  await query(
    `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
     VALUES('ค21101','คณิต','ม.1','1','','teacher1','พุธ','2','2','2560')`
  );
  await ok('importTimetableCSV', [[ttRow()]], 'admin');
  const { rows } = await query(`SELECT count(*)::int n FROM timetable WHERE year='2560'`);
  assert.strictEqual(rows[0].n, 1, 'ตารางสอนของเทอม/ปีอื่นต้องอยู่ครบ');
  await query(`DELETE FROM timetable WHERE year='2560'`);
});

// ── 3. นักเรียน / ครู: ทับของเดิม ไม่ลบใคร + 0 นำหน้าต้องรอด ─────────────────

test('นักเรียน: รหัสที่มี 0 นำหน้าต้องเก็บครบ ไม่โดนตัด', async () => {
  await ok('importStudentCSV', [[
    { username: '00042', fullName: 'ทดสอบ ศูนย์นำหน้า', level: 'ม.1', room: '1', email: '' },
  ]], 'admin');
  const { rows } = await query(`SELECT username, department FROM users WHERE username='00042'`);
  assert.strictEqual(rows.length, 1, 'ต้องหาเจอด้วยรหัสดิบที่มี 0 นำหน้า');
  assert.strictEqual(rows[0].department, 'ม.1/1', 'ระดับ + ห้อง ต้องรวบเป็นห้องเรียน');
  await query(`DELETE FROM users WHERE username='00042'`);
});

test('นักเรียน: คนที่หายจากไฟล์ต้องยังอยู่ในระบบ (ไฟล์ไม่ใช่ความจริงทั้งหมด)', async () => {
  await ok('importStudentCSV', [[
    { username: 'zz001', fullName: 'ทดสอบ หนึ่ง', level: 'ม.1', room: '1', email: '' },
    { username: 'zz002', fullName: 'ทดสอบ สอง', level: 'ม.1', room: '1', email: '' },
  ]], 'admin');
  await ok('importStudentCSV', [[
    { username: 'zz001', fullName: 'ทดสอบ หนึ่ง แก้ชื่อ', level: 'ม.1', room: '2', email: '' },
  ]], 'admin');

  const { rows } = await query(`SELECT username, full_name, department FROM users WHERE username IN ('zz001','zz002') ORDER BY username`);
  assert.strictEqual(rows.length, 2, 'zz002 หายจากไฟล์รอบสอง แต่ต้องยังอยู่');
  assert.strictEqual(rows[0].full_name, 'ทดสอบ หนึ่ง แก้ชื่อ', 'คนที่อยู่ในไฟล์ต้องถูกทับด้วยค่าใหม่');
  assert.strictEqual(rows[0].department, 'ม.1/2');
  await query(`DELETE FROM users WHERE username IN ('zz001','zz002')`);
});

test('นักเรียน: ขาดคอลัมน์บังคับ บอกเลขแถวใน Excel ให้ไปหาเจอ', async () => {
  const err = await denied('importStudentCSV', [[
    { username: 'zz100', fullName: 'ทดสอบ', level: 'ม.1', room: '1' },
    { username: 'zz101', fullName: '', level: 'ม.1', room: '1' },
  ]], 'admin');
  assert.match(err, /แถว 3/);
  assert.match(err, /ชื่อ-สกุล/);
});

test('นักเรียน: รหัสซ้ำกันเองในไฟล์เป็นข้อผิดพลาด', async () => {
  const err = await denied('importStudentCSV', [[
    { username: 'zz200', fullName: 'ก', level: 'ม.1', room: '1' },
    { username: 'zz200', fullName: 'ข', level: 'ม.1', room: '1' },
  ]], 'admin');
  assert.match(err, /ซ้ำกับแถว 2/);
});

test('ครู: รับ alias อังกฤษของหัวตารางได้ และ role ว่าง = Teacher', async () => {
  await ok('importTeacherCSV', [[
    { username: 'zzt01', fullName: 'ทดสอบ ครูใหม่', department: 'ฟิสิกส์', email: '', role: '' },
  ]], 'admin');
  const { rows } = await query(`SELECT role, department FROM users WHERE username='zzt01'`);
  assert.strictEqual(rows[0].role, 'Teacher');
  assert.strictEqual(rows[0].department, 'ฟิสิกส์');
  await query(`DELETE FROM users WHERE username='zzt01'`);
});

// ── สิทธิ์ ────────────────────────────────────────────────────────────────

test('นำเข้าเป็น ADMIN_ONLY — ครูเรียกไม่ได้', async () => {
  for (const fn of ['importStudentCSV', 'importTeacherCSV', 'importTimetableCSV']) {
    await denied(fn, [[]], 'teacher1');
  }
});

test('getImportSpec: ครูเรียกไม่ได้ แต่ Admin ได้ spec ครบสามชนิด', async () => {
  await denied('getImportSpec', [], 'teacher1');
  const spec = await ok('getImportSpec', [], 'admin');
  assert.deepStrictEqual(spec.kinds.sort(), ['student', 'teacher', 'timetable']);
  for (const kind of spec.kinds) {
    assert.ok(spec.specs[kind].columns.length > 0, `${kind} ต้องมีคอลัมน์`);
    for (const c of spec.specs[kind].columns) {
      assert.ok(c.label && c.key, 'ทุกคอลัมน์ต้องมีทั้งหัวไทยและ key');
    }
  }
});

test('spec: กติกาตรวจต้องอยู่ในรูปข้อมูล หน้าเว็บจะได้ตรวจแบบเดียวกันโดยไม่ก๊อป logic', async () => {
  const spec = await ok('getImportSpec', [], 'admin');
  const day = spec.specs.timetable.columns.find((c) => c.key === 'day');
  assert.strictEqual(day.normalize, 'day');
  assert.ok(day.oneOf.includes('จันทร์'), 'ชื่อวันที่ยอมรับต้องส่งไปให้หน้าเว็บด้วย');

  const period = spec.specs.timetable.columns.find((c) => c.key === 'period');
  assert.ok(new RegExp(period.pattern).test('3'));
  assert.ok(!new RegExp(period.pattern).test('เช้า'));

  const sid = spec.specs.student.columns.find((c) => c.key === 'username');
  assert.ok(sid.unique && sid.keepLeadingZero, 'คอลัมน์รหัสนักเรียนต้องบอกทั้งสองอย่าง');

  // ตัวสร้างแม่แบบใช้ example — ขาดไปแล้วแม่แบบจะมีแต่หัวตารางเปล่า
  for (const kind of spec.kinds) {
    for (const c of spec.specs[kind].columns) {
      assert.notStrictEqual(c.example, undefined, `${kind}.${c.key} ไม่มี example`);
    }
  }
});

test('ตารางสอน: คาบที่ไม่ใช่ตัวเลขถูกบล็อกด้วยกติกา pattern จาก spec', async () => {
  const err = await denied('importTimetableCSV', [[ttRow({ period: 'เช้า' })]], 'admin');
  assert.match(err, /คาบ "เช้า" รูปแบบไม่ถูกต้อง/);
});

test('ครู: บทบาทนอกลิสต์ถูกบล็อกด้วยกติกา oneOf จาก spec', async () => {
  const err = await denied('importTeacherCSV',
    [[{ username: 'zzt02', fullName: 'ทดสอบ', role: 'ผู้อำนวยการ' }]], 'admin');
  assert.match(err, /ต้องเป็นหนึ่งใน/);
});

test('spec ไม่มีคอลัมน์ เทอม/ปี/รหัสผ่าน — ค่าพวกนี้ห้ามมาจากไฟล์', async () => {
  const spec = await ok('getImportSpec', [], 'admin');
  for (const kind of spec.kinds) {
    for (const c of spec.specs[kind].columns) {
      assert.ok(!['term', 'year', 'password'].includes(c.key), `${kind} ไม่ควรมีคอลัมน์ ${c.key}`);
    }
  }
});

// ── 3. ชื่อโรงเรียนต้องไม่มี default เป็นชื่อโรงเรียนใด ────────────────────────

test('getSystemConfig: ไม่ hardcode ชื่อโรงเรียนใดเป็นค่า default', async () => {
  const saved = await query(`SELECT value1 FROM system_settings WHERE key='schoolName'`);
  await query(`DELETE FROM system_settings WHERE key='schoolName' OR key='school_name'`);
  require('../lib/cache').del('system_config');
  try {
    const cfg = await ok('getSystemConfig', [], 'admin');
    assert.strictEqual(cfg.schoolName, '', 'DB ไม่มีชื่อโรงเรียน = ต้องได้ค่าว่าง ไม่ใช่ชื่อโรงเรียนอื่น');
  } finally {
    if (saved.rows.length) {
      await query(`INSERT INTO system_settings(key,subkey,value1) VALUES('schoolName','',$1)
                   ON CONFLICT DO NOTHING`, [saved.rows[0].value1]);
    }
    require('../lib/cache').del('system_config');
  }
});

test('ไม่มีชื่อโรงเรียนใด hardcode อยู่ในโค้ดที่ผู้ใช้เห็น', async () => {
  const { execSync } = require('node:child_process');
  const path = require('node:path');
  const root = path.join(__dirname, '..');
  // seed เป็นข้อมูลสมมติ · คอมเมนต์อธิบายบั๊กเก่าอ้างชื่อได้ · ตัวเทสนี้เองก็มีคำนี้
  const out = execSync(
    `grep -rn "ภูพระบาท" --include="*.html" --include="*.js" . ` +
    `| grep -v node_modules | grep -v "^./db/seed" | grep -v "^./test/" ` +
    `| grep -v "^[^:]*:[0-9]*: *[/*]" | grep -v "// " || true`,
    { cwd: root, encoding: 'utf8' }
  ).trim();
  assert.strictEqual(out, '', `ชื่อโรงเรียนยัง hardcode อยู่:\n${out}`);
});
