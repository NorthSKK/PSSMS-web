'use strict';
/**
 * จัดตารางสอนแทนอัตโนมัติ — เสนอครูให้หลายคาบพร้อมกัน แล้วให้แอดมินตรวจก่อนยืนยัน
 *
 * แยกเป็น 2 RPC โดยตั้งใจ:
 *   getAutoAssignPreview  — read-only พิสูจน์ได้ว่าไม่เขียน DB (ไม่มี UPDATE/INSERT ในไฟล์ส่วนนี้)
 *   applyAutoAssign       — เขียนจริง
 * ถ้าทำเป็นฟังก์ชันเดียวแล้วใส่ flag `dryRun` การเป็นสมาชิก ADMIN_ONLY / write-set ใน
 * routes/gas.js ซึ่ง key ด้วย "ชื่อฟังก์ชัน" จะไร้ความหมายทันที
 */
const { query } = require('../lib/db');
const { normalizeKey } = require('../lib/permissions');
const { subjectPrefixOf, subjectGroupOf, isHomeroomSubject } = require('../lib/subjectGroup');
const { _assertSubstituteFree } = require('./leave');

// ปรับที่เดียวจบ — ตัวเลขพวกนี้คือ "นโยบายการจัด" ไม่ใช่รายละเอียดการทำงาน
const SCORE_WEIGHTS = {
  exactSubject:   50,  // สอน subject_code นี้อยู่แล้วในเทอมปัจจุบัน
  strongPrefix:   30,  // สอนกลุ่มสาระเดียวกัน >= STRONG_PREFIX_MIN คาบ
  weakPrefix:     15,  // สอนกลุ่มสาระเดียวกัน 1-2 คาบ
  homeroom:       25,  // เป็นครูที่ปรึกษาของห้องนั้น
  sameClass:       8,  // สอนห้องนี้อยู่แล้ว (คนละวิชา)
  workloadPer:    -6,  // ต่อ 1 คาบสอนแทนในหน้าต่าง FAIRNESS_WINDOW_DAYS
};
const STRONG_PREFIX_MIN = 3;
const FAIRNESS_WINDOW_DAYS = 30;
const MAX_PER_DAY = 2;          // โควตาสอนแทนต่อครู 1 คน ต่อ 1 วัน

const PENDING = 'รอจัด';

// ── helpers ────────────────────────────────────────────────
const slotKey = (date, period) => `${date}|${String(period)}`;
const ttKey = (teacherId, day, period) => `${teacherId}|${day}|${String(period)}`;

function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function addTo(map, key, val) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(val);
}

async function _activeTermYear(term, year) {
  const t = String(term || '').trim();
  const y = String(year || '').trim();
  if (t && y) return { term: t, year: y };
  // client ส่ง user.currentTerm/currentYear ซึ่งว่างบ่อย — ห้ามปล่อยให้ query ไป match ค่าว่าง
  const { rows } = await query(
    `SELECT value1, value2 FROM system_settings WHERE key='Active' AND subkey='Term' LIMIT 1`
  );
  return { term: t || (rows[0]?.value1 || '1'), year: y || (rows[0]?.value2 || '') };
}

/**
 * โหลดทุกอย่างที่ต้องใช้ในรอบเดียว (~6 query) แทนที่จะวน getAvailableSubstitutes ต่อคาบ
 * ซึ่งเป็น 4 query × N คาบ และไม่มีความจำข้ามคาบเลย
 */
async function _loadContext(slots, term, year) {
  const dates = slots.map(s => s.date);
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const { rows: teachers } = await query(
    `SELECT username, full_name, department FROM users
      WHERE UPPER(role)='TEACHER' AND (status IS NULL OR status='ปกติ')
      ORDER BY full_name`
  );

  // timetable query เดียว รับใช้ 5 อย่าง: คาบชน / สอนวิชานี้ / ถนัดกลุ่มไหน / สอนห้องนี้ / ครูที่ปรึกษา
  const { rows: tt } = await query(
    `SELECT teacher_id, day, period, subject_code, level, room
       FROM timetable WHERE term=$1 AND year=$2`,
    [term, year]
  );
  const busy = new Map();        // teacher|day|period -> [{subjectCode, normClass}]
  const teaches = new Map();     // teacher -> Set<subject_code>
  const prefixCount = new Map(); // teacher|prefix -> n
  const classTaught = new Map(); // teacher -> Set<normClass>
  const homeroom = new Map();    // normClass -> Set<teacher>
  for (const r of tt) {
    const normClass = normalizeKey(`${r.level}/${r.room}`);
    const k = ttKey(r.teacher_id, r.day, r.period);
    if (!busy.has(k)) busy.set(k, []);
    busy.get(k).push({ subjectCode: r.subject_code, normClass });
    addTo(teaches, r.teacher_id, r.subject_code);
    addTo(classTaught, r.teacher_id, normClass);
    if (isHomeroomSubject(r.subject_code)) addTo(homeroom, normClass, r.teacher_id);
    const p = subjectPrefixOf(r.subject_code);
    if (p) bump(prefixCount, `${r.teacher_id}|${p}`);
  }

  // ครูที่ถูกจัดสอนแทนคาบนั้นแล้ว + ครูที่ "เป็นเจ้าของคาบ" ที่ถูกจัดสอนแทน (คือครูไม่อยู่)
  // ⚠️ ต้องเช็คทั้งสองคอลัมน์ — คาบที่กด "เพิ่มเอง" ไม่มี leave_id ตารางใบลาจึงจับไม่ได้
  const { rows: subRows } = await query(
    `SELECT date::text AS date, period, sub_teacher_id, original_teacher_id
       FROM substitute_assignments
      WHERE status <> 'ยกเลิก' AND date BETWEEN $1::date AND $2::date`,
    [minDate, maxDate]
  );
  const booked = new Map();   // date|period -> Set<teacher>
  for (const r of subRows) {
    const k = slotKey(r.date, r.period);
    if (r.sub_teacher_id) addTo(booked, k, r.sub_teacher_id);
    if (r.original_teacher_id) addTo(booked, k, r.original_teacher_id);
  }

  // ครูที่ลาเอง — getAvailableSubstitutes เดิมไม่เช็คข้อนี้ ครูที่ไม่อยู่โรงเรียนจึงขึ้นว่า "ว่าง"
  const { rows: leaveRows } = await query(
    `SELECT teacher_id, start_date::text AS s, end_date::text AS e
       FROM leave_records
      WHERE status='อนุมัติ' AND start_date <= $2::date AND end_date >= $1::date`,
    [minDate, maxDate]
  );

  // ภาระ 30 วันย้อนหลัง — query เดียวได้ทั้งยอดรวมและยอดรายวัน (โควตา MAX_PER_DAY)
  // substitute_assignments ไม่มีคอลัมน์ term/year จึงนับต่อภาคเรียนไม่ได้ ต้องใช้ rolling window
  // (ของเดิมนับ lifetime ซึ่งทำให้ลำดับแช่แข็งถาวรรอบคนที่เคยสอนแทนเยอะเมื่อสองปีก่อน)
  const { rows: loadRows } = await query(
    `SELECT sub_teacher_id, date::text AS d, COUNT(*)::int AS n
       FROM substitute_assignments
      WHERE sub_teacher_id IS NOT NULL AND status <> 'ยกเลิก'
        AND date >= $1::date - ($3 || ' days')::interval AND date <= $2::date
      GROUP BY 1, 2`,
    [minDate, maxDate, String(FAIRNESS_WINDOW_DAYS)]
  );
  const windowCount = new Map();  // teacher -> n
  const dayCount = new Map();     // teacher|date -> n
  for (const r of loadRows) {
    windowCount.set(r.sub_teacher_id, (windowCount.get(r.sub_teacher_id) || 0) + r.n);
    dayCount.set(`${r.sub_teacher_id}|${r.d}`, (dayCount.get(`${r.sub_teacher_id}|${r.d}`) || 0) + r.n);
  }

  return { teachers, busy, teaches, prefixCount, classTaught, homeroom,
           booked, leaves: leaveRows, windowCount, dayCount };
}

// ครูติดคาบสอนของตัวเองในวัน+คาบนั้นหรือไม่ — ตรงกับ _assertSubstituteFree ใน leave.js
// (คาบโฮมรูมไม่เข้ามาถึงตรงนี้ ถูกกรองออกตั้งแต่ตอนเลือก slot)
function _hasTimetableClash(ctx, teacherId, slot) {
  const rows = ctx.busy.get(ttKey(teacherId, slot.dayOfWeek, slot.period));
  return Boolean(rows && rows.length);
}

function _onLeave(ctx, teacherId, date) {
  return ctx.leaves.some(l => l.teacher_id === teacherId && l.s <= date && l.e >= date);
}

// เหตุผลที่ครูคนนี้ถูกตัดออก — คืน null ถ้าผ่านทุกข้อ (นับไปทำข้อความ explain ด้วย)
function _rejectReason(ctx, teacherId, slot) {
  if (teacherId === slot.originalTeacherId) return 'self';
  if (_hasTimetableClash(ctx, teacherId, slot)) return 'clash';
  if ((ctx.booked.get(slotKey(slot.date, slot.period)) || new Set()).has(teacherId)) return 'booked';
  if (_onLeave(ctx, teacherId, slot.date)) return 'leave';
  if ((ctx.dayCount.get(`${teacherId}|${slot.date}`) || 0) >= MAX_PER_DAY) return 'quota';
  return null;
}

const REJECT_LABEL = {
  clash:  'ติดสอนคาบเดียวกัน',
  booked: 'ถูกจัดสอนแทน/ไม่อยู่คาบนี้แล้ว',
  leave:  'ลาวันนี้',
  quota:  `ครบโควตาวันละ ${MAX_PER_DAY} คาบ`,
};

function _explain(counts) {
  const parts = Object.keys(REJECT_LABEL)
    .filter(k => counts[k])
    .map(k => `${REJECT_LABEL[k]} ${counts[k]} คน`);
  return parts.length
    ? `ไม่มีครูว่างในคาบนี้ (${parts.join(' · ')})`
    : 'ไม่มีครูที่จัดได้ในคาบนี้';
}

/**
 * ความถนัดดูจาก timetable ว่าครูสอน prefix นี้กี่คาบ — **ไม่ใช่** จาก users.department
 * production เก็บ department เป็น "วิชาเอก" (ฟิสิกส์ / ดนตรีศึกษา / นาฏศิลป์ / อุตสาหกรรม)
 * ซึ่งไม่ตรงชื่อกลุ่มสาระ 9 ใน 12 คน และครูวิชาเอกเดียวกันก็สอนคนละกลุ่มได้
 */
function _scoreOf(ctx, t, slot) {
  const id = t.username;
  const reasons = [];
  let score = 0;

  const prefix = subjectPrefixOf(slot.subjectCode);
  // ⚠️ นับ "สอนวิชานี้อยู่แล้ว" เฉพาะรหัสที่เป็นรายวิชาจริง — 'HR' / '-' / 'CLUB_*' ใช้รหัส
  // เดียวกันทั้งโรงเรียน ครูที่ปรึกษาห้องอื่นจะได้ +50 สำหรับคาบโฮมรูมของห้องที่ไม่เกี่ยวกับตัวเอง
  // (คาบโฮมรูมต้องชนะด้วยคะแนนครูที่ปรึกษาเท่านั้น)
  if (prefix && (ctx.teaches.get(id) || new Set()).has(slot.subjectCode)) {
    score += SCORE_WEIGHTS.exactSubject;
    reasons.push('สอนวิชานี้อยู่แล้ว');
  } else {
    const n = prefix ? (ctx.prefixCount.get(`${id}|${prefix}`) || 0) : 0;
    if (n >= STRONG_PREFIX_MIN) {
      score += SCORE_WEIGHTS.strongPrefix;
      reasons.push(`สอน${subjectGroupOf(slot.subjectCode) || 'กลุ่มเดียวกัน'} ${n} คาบ`);
    } else if (n > 0) {
      score += SCORE_WEIGHTS.weakPrefix;
      reasons.push(`สอน${subjectGroupOf(slot.subjectCode) || 'กลุ่มเดียวกัน'} ${n} คาบ`);
    }
  }

  const normClass = normalizeKey(slot.className);
  if ((ctx.homeroom.get(normClass) || new Set()).has(id)) {
    score += SCORE_WEIGHTS.homeroom;
    reasons.push('ครูที่ปรึกษาห้องนี้');
  } else if ((ctx.classTaught.get(id) || new Set()).has(normClass)) {
    score += SCORE_WEIGHTS.sameClass;
    reasons.push('สอนห้องนี้อยู่แล้ว');
  }

  const load = ctx.windowCount.get(id) || 0;
  if (load) {
    score += SCORE_WEIGHTS.workloadPer * load;
    reasons.push(`สอนแทนแล้ว ${load} คาบใน ${FAIRNESS_WINDOW_DAYS} วัน`);
  }

  return { teacherId: id, name: t.full_name, department: t.department || '', score, reasons };
}

async function getAutoAssignPreview([assignmentIds, term, year]) {
  const ids = Array.isArray(assignmentIds) ? assignmentIds.map(String).filter(Boolean) : [];
  if (!ids.length) throw new Error('ยังไม่ได้เลือกคาบที่ต้องการจัด');

  const active = await _activeTermYear(term, year);

  const { rows } = await query(
    `SELECT id, date::text AS date, period, day_of_week, status,
            original_teacher_id, original_teacher_name,
            subject_code, subject_name, class, room
       FROM substitute_assignments WHERE id = ANY($1)`,
    [ids]
  );
  const found = new Map(rows.map(r => [r.id, r]));

  const skipped = [];
  for (const id of ids) {
    const r = found.get(id);
    if (!r) skipped.push({ assignmentId: id, reason: 'ไม่พบคาบสอนแทนนี้' });
    else if (r.status !== PENDING) skipped.push({ assignmentId: id, reason: `คาบนี้สถานะ "${r.status}" แล้ว` });
    // manualCreateAffected ไม่สร้างคาบโฮมรูมแล้ว แต่แถวเก่าที่สร้างไว้ก่อนหน้ายังมีอยู่
    else if (isHomeroomSubject(r.subject_code)) {
      skipped.push({ assignmentId: id, reason: 'คาบโฮมรูมไม่ต้องจัดสอนแทน — ครูที่ปรึกษาอีกคนดูแลแทน' });
    }
  }

  const slots = rows.filter(r => r.status === PENDING && !isHomeroomSubject(r.subject_code)).map(r => ({
    assignmentId: r.id,
    date: r.date,
    period: String(r.period || ''),
    dayOfWeek: r.day_of_week || '',   // ใช้คอลัมน์ที่เก็บไว้ ห้ามคำนวณจาก date ใหม่ (TZ +07)
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    className: r.class || '',
    room: r.room || '',
    originalTeacherId: r.original_teacher_id || '',
    originalTeacherName: r.original_teacher_name || '',
  }));

  if (!slots.length) {
    return { term: active.term, year: active.year, suggestions: [], unassigned: [], skipped,
             summary: { total: ids.length, assigned: 0, unassigned: 0, perTeacher: [] } };
  }

  const ctx = await _loadContext(slots, active.term, active.year);

  // เรียงแบบ "คาบที่หาคนยากที่สุดก่อน" — เรียงตามเวลาล้วนจะทำให้คาบเช้าง่าย ๆ กินครู
  // เฉพาะทางคนเดียวที่ว่างไป แล้วคาบบ่ายที่ต้องใช้คนคนนั้นค้างเป็นรอจัด
  const eligibleCountOf = (slot) =>
    ctx.teachers.filter(t => !_rejectReason(ctx, t.username, slot)).length;
  const ordered = slots
    .map(s => ({ s, n: eligibleCountOf(s) }))
    .sort((a, b) => (a.n - b.n)
      || a.s.date.localeCompare(b.s.date)
      || (Number(a.s.period) - Number(b.s.period)))   // period เป็น string — เรียงตรง ๆ คาบ 10 มาก่อนคาบ 2
    .map(x => x.s);

  const suggestions = [];
  const unassigned = [];
  const perTeacher = new Map();

  for (const slot of ordered) {
    const counts = { self: 0, clash: 0, booked: 0, leave: 0, quota: 0 };
    const eligible = [];
    for (const t of ctx.teachers) {
      const why = _rejectReason(ctx, t.username, slot);
      if (why) counts[why]++;
      else eligible.push(t);
    }
    if (!eligible.length) {
      unassigned.push({ ...slot, reason: _explain(counts) });
      continue;
    }

    // tie-break: คะแนนมากก่อน → ภาระน้อยก่อน → ชื่อ (deterministic เพราะเทสพึ่งลำดับนี้)
    const ranked = eligible
      .map(t => _scoreOf(ctx, t, slot))
      .sort((a, b) => (b.score - a.score)
        || ((ctx.windowCount.get(a.teacherId) || 0) - (ctx.windowCount.get(b.teacherId) || 0))
        || String(a.name).localeCompare(String(b.name), 'th'));

    const pick = ranked[0];
    // จองทันที ไม่งั้นคาบถัดไปที่ date+period เดียวกันจะได้ครูคนเดิมซ้อน
    addTo(ctx.booked, slotKey(slot.date, slot.period), pick.teacherId);
    bump(ctx.windowCount, pick.teacherId);
    bump(ctx.dayCount, `${pick.teacherId}|${slot.date}`);
    bump(perTeacher, pick.teacherId);

    suggestions.push({
      ...slot,
      subTeacherId: pick.teacherId,
      subTeacherName: pick.name,
      subTeacherDept: pick.department,   // คืนมาให้เห็นบนจอ เผื่อ department เพี้ยน
      score: pick.score,
      reasons: pick.reasons,
      alternatives: ranked.slice(1, 5).map(r => ({
        teacherId: r.teacherId, name: r.name, department: r.department,
        score: r.score, reasons: r.reasons,
      })),
    });
  }

  // คืนตามลำดับที่คนอ่านคาดหวัง (วัน → คาบ) ไม่ใช่ลำดับที่อัลกอริทึมประมวลผล
  const byDayPeriod = (a, b) =>
    a.date.localeCompare(b.date) || (Number(a.period) - Number(b.period));
  suggestions.sort(byDayPeriod);
  unassigned.sort(byDayPeriod);

  const nameOf = new Map(ctx.teachers.map(t => [t.username, t.full_name]));
  return {
    term: active.term,
    year: active.year,
    suggestions,
    unassigned,
    skipped,
    summary: {
      total: ids.length,
      assigned: suggestions.length,
      unassigned: unassigned.length,
      perTeacher: [...perTeacher.entries()]
        .map(([teacherId, count]) => ({ teacherId, name: nameOf.get(teacherId) || '', count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * เขียน 1 แถว — ทรานแซกชันของตัวเอง
 *
 * ⚠️ ห้ามเรียก leave.assignSubstitute แทน: UPDATE ของมัน **ไม่มี status guard**
 * แอดมิน 2 คนที่ preview แถวเดียวกันจะผ่าน _assertSubstituteFree ทั้งคู่ แล้วคนที่สอง
 * ทับงานของคนแรกเงียบ ๆ  ที่นี่ล็อกแถวก่อน (FOR UPDATE) แล้วบังคับ status='รอจัด' ตอนเขียน
 */
async function _applyOne(assignmentId, subTeacherId, note, user) {
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: lock } = await client.query(
      `SELECT status FROM substitute_assignments WHERE id=$1 FOR UPDATE`, [assignmentId]
    );
    if (!lock.length) throw new Error('ไม่พบคาบสอนแทนนี้');
    if (lock[0].status !== PENDING) throw new Error('คาบนี้ถูกจัดไปแล้วโดยผู้อื่น กรุณาโหลดหน้าใหม่');

    await _assertSubstituteFree(assignmentId, subTeacherId);

    const { rows: u } = await client.query(
      `SELECT full_name FROM users WHERE username=$1`, [subTeacherId]
    );
    if (!u.length) throw new Error('ไม่พบครูคนนี้ในระบบ');

    const { rowCount } = await client.query(
      `UPDATE substitute_assignments
          SET sub_teacher_id=$1, sub_teacher_name=$2, status='จัดแล้ว',
              assigned_by=$3, note=$4, assigned_at=NOW()
        WHERE id=$5 AND status=$6`,
      [subTeacherId, u[0].full_name || '', String(user?.id || ''), note || '',
       assignmentId, PENDING]
    );
    if (rowCount === 0) throw new Error('คาบนี้ถูกจัดไปแล้วโดยผู้อื่น กรุณาโหลดหน้าใหม่');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * ยืนยันผลจากหน้า preview — picks = [{ assignmentId, subTeacherId, note }]
 *
 * ⚠️ วนตามลำดับด้วย for...of **ห้ามเปลี่ยนเป็น Promise.all** — การกันจัดครูคนเดียวซ้อน
 * 2 คาบใน batch เดียวพึ่งการที่แถว N-1 commit เสร็จก่อนที่ _assertSubstituteFree ของแถว N
 * จะอ่าน ถ้ารันขนานทั้งคู่จะอ่านเจอ "ว่าง" พร้อมกันแล้วเขียนทับกัน
 *
 * ไม่ห่อทั้งชุดใน transaction เดียวโดยตั้งใจ — แถวที่ preview เก่าไป 1 แถว ไม่ควร
 * rollback อีก 29 แถวที่ดี รายงาน partial success แล้วให้หน้าจอ reload กลับมาตรงกับ DB
 */
async function applyAutoAssign([picks], user) {
  const list = (Array.isArray(picks) ? picks : []).filter(p => p && p.assignmentId && p.subTeacherId);
  if (!list.length) throw new Error('ยังไม่ได้เลือกคาบที่ต้องการบันทึก');

  const applied = [];
  const failed = [];
  for (const p of list) {
    try {
      await _applyOne(String(p.assignmentId), String(p.subTeacherId), p.note, user);
      applied.push(String(p.assignmentId));
    } catch (e) {
      failed.push({ assignmentId: String(p.assignmentId), subTeacherId: String(p.subTeacherId), error: e.message });
    }
  }

  return {
    status: 'success',
    message: failed.length
      ? `จัดสอนแทนสำเร็จ ${applied.length} คาบ (ล้มเหลว ${failed.length} คาบ)`
      : `จัดสอนแทนสำเร็จ ${applied.length} คาบ`,
    applied,
    failed,
  };
}

module.exports = {
  getAutoAssignPreview,
  applyAutoAssign,
  SCORE_WEIGHTS, FAIRNESS_WINDOW_DAYS, MAX_PER_DAY, STRONG_PREFIX_MIN,
};
