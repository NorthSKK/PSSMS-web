/**
 * ระบบจัดตารางสอนแทนอัตโนมัติ — ยิงผ่าน HTTP layer จริง (JWT + role check ครอบด้วย)
 *
 * ⚠️ เทสหลายข้อพึ่ง tie-break ที่ deterministic ของ getAutoAssignPreview
 * (คะแนนมากก่อน → ภาระน้อยก่อน → ชื่อ) อย่า "จัดระเบียบ" sort ตัวนั้นโดยไม่รันเทสนี้
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');

after(stop);

const pendingIds = async () => (await query(
  `SELECT id FROM substitute_assignments WHERE status='รอจัด' ORDER BY date, period`
)).rows.map(r => r.id);

const snapshot = async () => JSON.stringify((await query(
  `SELECT id, status, sub_teacher_id, assigned_by FROM substitute_assignments ORDER BY id`
)).rows);

const preview = async (ids) => ok('getAutoAssignPreview', [ids, TERM, YEAR], 'admin');

// ครูทุกคนที่ระบบ "พิจารณา" สำหรับคาบหนึ่ง (คนที่เสนอ + ตัวสำรอง)
const consideredIn = (slot) =>
  [slot.subTeacherId].concat((slot.alternatives || []).map(a => a.teacherId));

const findSlot = (res, code, period) =>
  res.suggestions.find(s => s.subjectCode === code && String(s.period) === String(period));

test('getAutoAssignPreview เป็น ADMIN_ONLY', async () => {
  const ids = await pendingIds();
  const err = await denied('getAutoAssignPreview', [ids, TERM, YEAR], 'teacher1');
  assert.match(err, /ผู้ดูแลระบบ/);
});

test('applyAutoAssign เป็น ADMIN_ONLY', async () => {
  const err = await denied('applyAutoAssign', [[{ assignmentId: 'x', subTeacherId: 'teacher2' }]], 'teacher1');
  assert.match(err, /ผู้ดูแลระบบ/);
});

test('preview ไม่เขียน DB เลย', async () => {
  const before = await snapshot();
  const res = await preview(await pendingIds());
  assert.ok(res.suggestions.length > 0, 'ต้องมีข้อเสนออย่างน้อย 1 คาบ');
  assert.strictEqual(await snapshot(), before);
});

test('เสนอครบทุกคาบที่ส่งไป (suggestions + unassigned + skipped)', async () => {
  const ids = await pendingIds();
  const res = await preview(ids);
  assert.strictEqual(
    res.suggestions.length + res.unassigned.length + res.skipped.length, ids.length
  );
  assert.strictEqual(res.summary.total, ids.length);
});

test('ครูที่สอนกลุ่มสาระเดียวกันชนะครูที่ไม่ตรงอะไรเลย', async () => {
  const res = await preview(await pendingIds());
  const sci = findSlot(res, 'ว30205', '2');
  assert.ok(sci, 'ต้องมีคาบ ว30205 คาบ 2');
  // teacher3 สอน ว31101 5 คาบ / teacher4 สอน ท21101 อย่างเดียว
  assert.strictEqual(sci.subTeacherId, 'teacher3');
  assert.ok(sci.score > 0);
});

test('ครูที่ปรึกษาห้องนั้นได้แต้มพิเศษ', async () => {
  const res = await preview(await pendingIds());
  const health = res.suggestions.find(s => s.subjectCode === 'พ22101');
  assert.ok(health, 'ต้องมีคาบ พ22101');
  assert.strictEqual(health.subTeacherId, 'teacher5');   // ครูที่ปรึกษาร่วม ม.2/1
  assert.ok(health.reasons.some(r => r.indexOf('ครูที่ปรึกษา') === 0));
});

test('ครูที่ติดคาบสอนตัวเองไม่ถูกพิจารณาเลย', async () => {
  const res = await preview(await pendingIds());
  // teacher3 สอน ว31101 คาบ 4 ทุกวันทำการ
  const p4 = res.suggestions.filter(s => String(s.period) === '4');
  assert.ok(p4.length > 0, 'ต้องมีคาบที่ 4');
  for (const s of p4) assert.ok(!consideredIn(s).includes('teacher3'));
});

test('ครูที่ลาเองวันนั้นไม่ถูกเสนอ (บั๊กเดิมของ getAvailableSubstitutes)', async () => {
  const { rows } = await query(
    `SELECT start_date::text AS s FROM leave_records WHERE teacher_id='teacher4' AND status='อนุมัติ'`
  );
  assert.ok(rows.length, 'seed ต้องมีใบลาอนุมัติของ teacher4');
  const res = await preview(await pendingIds());
  const sameDay = res.suggestions.filter(s => s.date === rows[0].s);
  assert.ok(sameDay.length > 0, 'ต้องมีคาบในวันที่ teacher4 ลา');
  for (const s of sameDay) assert.ok(!consideredIn(s).includes('teacher4'));
});

test('ไม่จัดครูคนเดียวกันซ้อน 2 คาบที่วัน+คาบเดียวกัน', async () => {
  const res = await preview(await pendingIds());
  const seen = new Set();
  for (const s of res.suggestions) {
    const k = `${s.date}|${s.period}|${s.subTeacherId}`;
    assert.ok(!seen.has(k), `ครูซ้ำที่ ${k}`);
    seen.add(k);
  }
  // seed มีคาบวัน+คาบเดียวกัน 2 แถวโดยตั้งใจ — ถ้าหายไปเทสข้อนี้จะไร้ความหมาย
  const byKey = {};
  res.suggestions.forEach(s => { byKey[`${s.date}|${s.period}`] = (byKey[`${s.date}|${s.period}`] || 0) + 1; });
  assert.ok(Object.values(byKey).some(n => n > 1), 'seed ต้องมีคาบชนกันให้ทดสอบ');
});

test('ไม่มีใครเกินโควตาสอนแทนต่อวัน', async () => {
  const { MAX_PER_DAY } = require('../functions/substituteAuto');
  const res = await preview(await pendingIds());
  const perDay = {};
  for (const s of res.suggestions) {
    const k = `${s.subTeacherId}|${s.date}`;
    perDay[k] = (perDay[k] || 0) + 1;
    assert.ok(perDay[k] <= MAX_PER_DAY, `${k} เกินโควตา`);
  }
});

test('คาบโฮมรูมไม่เข้าระบบสอนแทน', async () => {
  const { rows } = await query(
    `INSERT INTO substitute_assignments(date, period, day_of_week, original_teacher_id,
       original_teacher_name, subject_code, subject_name, class, room, status)
     VALUES('2026-09-21','0','จันทร์','teacher2','ครูสมหญิง ตั้งใจสอน','HR',
            'กิจกรรมโฮมรูมหน้าเสาธง','ม.2/1','','รอจัด') RETURNING id`
  );
  const res = await preview([rows[0].id]);
  assert.strictEqual(res.suggestions.length, 0);
  assert.strictEqual(res.skipped.length, 1);
  assert.match(res.skipped[0].reason, /โฮมรูม/);
  await query(`DELETE FROM substitute_assignments WHERE id=$1`, [rows[0].id]);
});

test('manualCreateAffected ไม่สร้างคาบสอนแทนให้คาบโฮมรูม', async () => {
  const { rows: lv } = await query(`SELECT id FROM leave_records WHERE teacher_id='teacher2' LIMIT 1`);
  await ok('manualCreateAffected', ['teacher2', '2026-10-05', '2026-10-09', lv[0].id], 'admin');
  const { rows } = await query(
    `SELECT COUNT(*)::int c FROM substitute_assignments
      WHERE original_teacher_id='teacher2' AND date BETWEEN '2026-10-05' AND '2026-10-09'
        AND UPPER(subject_code)='HR'`
  );
  assert.strictEqual(rows[0].c, 0);
  await query(`DELETE FROM substitute_assignments WHERE date BETWEEN '2026-10-05' AND '2026-10-09'`);
});

test('applyAutoAssign เขียนจริง — assigned_by มาจาก JWT ไม่ใช่ payload', async () => {
  const res = await preview(await pendingIds());
  const picks = res.suggestions.map(s => ({
    assignmentId: s.assignmentId, subTeacherId: s.subTeacherId, note: 'จัดอัตโนมัติ',
  }));
  const out = await ok('applyAutoAssign', [picks], 'admin');
  assert.strictEqual(out.status, 'success');
  assert.strictEqual(out.failed.length, 0, JSON.stringify(out.failed));
  assert.strictEqual(out.applied.length, picks.length);

  const { rows } = await query(
    `SELECT status, sub_teacher_id, assigned_by, note FROM substitute_assignments WHERE id = ANY($1)`,
    [out.applied]
  );
  for (const r of rows) {
    assert.strictEqual(r.status, 'จัดแล้ว');
    assert.strictEqual(r.assigned_by, 'admin');
    assert.strictEqual(r.note, 'จัดอัตโนมัติ');
    assert.ok(r.sub_teacher_id);
  }

  // ยิงซ้ำด้วย picks ชุดเดิม (preview เก่า) — ต้องไม่มีอะไรถูกเขียนทับ
  const before = await snapshot();
  const again = await ok('applyAutoAssign', [picks], 'admin');
  assert.strictEqual(again.status, 'success');
  assert.strictEqual(again.applied.length, 0);
  assert.strictEqual(again.failed.length, picks.length);
  assert.strictEqual(await snapshot(), before);
});

test('applyAutoAssign: ครูเจ้าของคาบเองเข้า failed แต่แถวที่ถูกต้องยังสำเร็จ', async () => {
  const { rows } = await query(
    `INSERT INTO substitute_assignments(date, period, day_of_week, original_teacher_id,
       original_teacher_name, subject_code, subject_name, class, room, status)
     VALUES('2026-11-02','5','จันทร์','teacher1','ครูสมชาย ใจดี','ว30205','ฟิสิกส์','ม.6/1','214','รอจัด'),
           ('2026-11-02','6','จันทร์','teacher1','ครูสมชาย ใจดี','ว30205','ฟิสิกส์','ม.6/1','214','รอจัด')
     RETURNING id`
  );
  const out = await ok('applyAutoAssign', [[
    { assignmentId: rows[0].id, subTeacherId: 'teacher1' },   // เจ้าของคาบเอง → ต้องล้ม
    { assignmentId: rows[1].id, subTeacherId: 'teacher3' },   // ปกติ → ต้องสำเร็จ
  ]], 'admin');
  assert.strictEqual(out.applied.length, 1);
  assert.strictEqual(out.failed.length, 1);
  assert.strictEqual(out.applied[0], rows[1].id);
  assert.match(out.message, /ล้มเหลว 1 คาบ/);
  await query(`DELETE FROM substitute_assignments WHERE id = ANY($1)`, [rows.map(r => r.id)]);
});

test('applyAutoAssign ที่ไม่มี picks → error ไม่ใช่ success เงียบ ๆ', async () => {
  const err = await denied('applyAutoAssign', [[]], 'admin');
  assert.match(err, /ยังไม่ได้เลือก/);
});
