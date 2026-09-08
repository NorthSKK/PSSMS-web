/**
 * Implements functions referenced in GAS frontend but not yet in Phase 2/3.
 * Grouped here to keep other files clean.
 */
const { resolveStudentId } = require('../lib/permissions');
const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { schoolToday, schoolDayIndex } = require('../lib/schoolDate');
const getCalendarEvents = require('./getCalendarEvents');
const { assertRows, prepareRows, assertNoErrors } = require('../lib/importSpec');

// ============================================================
// getTeacherRiskDashboard — grade-based risk (0, ร, มส)
// returns { status, summary: {zero,r,ms}, details: [{className,subjectCode,subjectName,stdName,type}] }
// ============================================================
async function getTeacherRiskDashboard([teacherId, term, year]) {
  // LEFT JOIN users — เดิมเป็น INNER ทำให้นักเรียนที่ถูก promote/ลบออกจาก users
  // หายจากการ์ดเงียบ ๆ ทั้งที่เกรดยังค้างอยู่
  // class_name ต้องเป็นห้อง "ตอนเทอมนั้น" ไม่ใช่ห้องปัจจุบัน (users.department ถูกทับตอน promote)
  //   1. attendance.class ของเทอม/ปีนั้น — ห้องจริงตอนเรียน
  //   2. snapshot ก่อน promote ใน user_history
  //   3. users.department (ปีปัจจุบันเท่านั้นที่ยังถูก)
  const { rows } = await query(
    `SELECT gs.student_id,
            COALESCE(NULLIF(u.full_name,''), att.student_name, gs.student_id) AS std_name,
            gs.subject_code, sc.subject_name,
            COALESCE(NULLIF(att.class,''), NULLIF(hist.old_class,''), u.department, '') AS class_name,
            gs.grade
     FROM grade_summary gs
     LEFT JOIN users u ON u.username = gs.student_id
     LEFT JOIN LATERAL (
       SELECT a.class, a.student_name
       FROM attendance a
       WHERE a.student_id = gs.student_id AND a.term = gs.term AND a.year = gs.year
       ORDER BY a.date DESC LIMIT 1
     ) att ON TRUE
     LEFT JOIN LATERAL (
       SELECT uh.old_data->>'department' AS old_class
       FROM user_history uh
       WHERE uh.username = gs.student_id AND uh.action = 'promote'
         AND uh.old_data->>'year' = gs.year
       ORDER BY uh.timestamp DESC LIMIT 1
     ) hist ON TRUE
     LEFT JOIN (
       SELECT DISTINCT subject_code, subject_name
       FROM timetable WHERE teacher_id=$1 AND term=$2 AND year=$3
     ) sc ON sc.subject_code = gs.subject_code
     WHERE gs.term=$2 AND gs.year=$3
       AND gs.grade IN ('0','ร','มส','มส.')
       AND gs.subject_code IN (
         SELECT DISTINCT subject_code FROM timetable
         WHERE teacher_id=$1 AND term=$2 AND year=$3
       )
     ORDER BY gs.subject_code, class_name, gs.student_id`,
    [teacherId, term, year]
  );

  const details = rows.map(r => ({
    className: r.class_name || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    stdName: r.std_name || '',
    type: r.grade === '0' ? '0' : r.grade === 'ร' ? 'ร' : 'มส',
  }));

  const summary = {
    zero: details.filter(d => d.type === '0').length,
    r: details.filter(d => d.type === 'ร').length,
    ms: details.filter(d => d.type === 'มส').length,
  };

  return { status: 'success', summary, details };
}

// ============================================================
// getTeacherAtRiskDashboard — delegates to shared report logic
// (matches GAS: periodsPerWeek × 20 weeks, percent < 60/80/85 buckets)
// ============================================================
const { getTeacherAtRiskDashboard } = require('./attendanceReport');

// ============================================================
// getStudentDashboardBundle
// ============================================================
async function getStudentDashboardBundle([studentId, term, year], user) {
  // นักเรียนดูแดชบอร์ดของตัวเองเท่านั้น — เดิมเชื่อรหัสที่ส่งมาใน payload
  // ทำให้เปลี่ยนตัวเลขใน request แล้วอ่านเกรดของเพื่อนทั้งห้องได้
  const sid = resolveStudentId(user, studentId);
  const userRes = await query(
    `SELECT department FROM users WHERE username=$1`, [sid]
  );
  const className = userRes.rows[0]?.department || '';
  const parts = className.split('/');
  const level = parts[0] || '';
  const room = parts[1] || '';

  const DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  // ห้ามใช้ new Date().getDay() — บน Railway process รันเป็น UTC เด็กเปิดแอปตีห้า
  // จะได้ตารางเรียนของเมื่อวาน (ดู lib/schoolDate.js)
  const todayDay = DAYS[schoolDayIndex(schoolToday())];

  let timetable = { ok: false, data: [] };
  try {
    if (todayDay && level) {
      const { rows } = await query(
        `SELECT t.subject_code, t.subject_name, t.level||'/'||t.room as class_id,
                t.period, t.location, u.full_name as teacher_name
         FROM timetable t
         LEFT JOIN users u ON u.username = t.teacher_id
         WHERE t.level=$1 AND t.room=$2 AND t.day=$3 AND t.term=$4 AND t.year=$5
         ORDER BY t.period::integer`,
        [level, room, todayDay, term, year]
      );
      timetable = { ok: true, data: rows };
    } else {
      timetable = { ok: true, data: [] };
    }
  } catch (e) { timetable = { ok: false, error: e.message, data: [] }; }

  let scoreFeed = { ok: true, data: [] };
  try {
    // หน้านักเรียนต้องการคะแนน "รายชิ้น" ไม่ใช่แค่ยอดรวม — ชื่อชิ้นงานกับคะแนนเต็ม
    // อยู่ใน subject_config.indicators_json / exam_indicators_json ส่วนคะแนนที่ครูกรอก
    // อยู่ใน score_database (indicator_id = formative_0..N, midterm, final)
    //
    // ⚠️ รูปร่างที่คืนต้องตรงกับ _renderScoreFeed ใน src/Scripts_Core.html ทุกชื่อคีย์
    //    (camelCase + items[]) — เดิมคืน snake_case แบน ๆ ไม่มี items ทำให้ renderer
    //    โยน TypeError กลางทาง แล้ว skeleton ค้างอยู่อย่างนั้นโดยไม่มี error ให้เห็น
    const { rows: subjRows } = await query(
      `SELECT sc.subject_code,
              COALESCE(tt.subject_name, sc.subject_code) AS subject_name,
              sc.class_name, sc.indicators_json, sc.exam_indicators_json,
              gs.total_score, gs.grade, gs.remedial_status
       FROM subject_config sc
       LEFT JOIN LATERAL (
         SELECT t.subject_name FROM timetable t
         WHERE t.subject_code = sc.subject_code AND t.term = sc.term AND t.year = sc.year
         LIMIT 1
       ) tt ON TRUE
       LEFT JOIN grade_summary gs
         ON gs.student_id = $1 AND gs.subject_code = sc.subject_code
        AND gs.term = sc.term AND gs.year = sc.year
       WHERE sc.class_name = $2 AND sc.term = $3 AND sc.year = $4
       ORDER BY sc.subject_code`,
      [sid, className, term, year]
    );

    const { rows: scoreRows } = await query(
      `SELECT subject_code, indicator_id, score
       FROM score_database WHERE student_id=$1 AND term=$2 AND year=$3`,
      [sid, term, year]
    );
    const scoreOf = new Map(scoreRows.map(r => [`${r.subject_code}_${r.indicator_id}`, r.score]));

    const asArray = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (_) { return []; } }
      return [];
    };

    scoreFeed = {
      ok: true,
      data: subjRows.map(r => {
        const items = [];
        asArray(r.indicators_json).forEach((ind, idx) => {
          items.push({
            type: 'formative',
            name: ind.name || `ชิ้นงานที่ ${idx + 1}`,
            maxScore: Number(ind.score) || 0,
            score: scoreOf.get(`${r.subject_code}_formative_${idx}`) ?? null,
          });
        });
        // exam_indicators_json เก็บสองแถวเรียง กลางภาค แล้วปลายภาค
        const exams = asArray(r.exam_indicators_json);
        [['midterm', 'สอบกลางภาค'], ['final', 'สอบปลายภาค']].forEach(([key, fallback], k) => {
          const e = exams[k];
          if (!e) return;
          items.push({
            type: key,
            name: e.name || fallback,
            maxScore: Number(e.score) || 0,
            score: scoreOf.get(`${r.subject_code}_${key}`) ?? null,
          });
        });
        return {
          subjectCode: r.subject_code,
          subjectName: r.subject_name,
          className: r.class_name,
          totalScore: r.total_score,
          grade: r.grade,
          remedialStatus: r.remedial_status,
          items,
        };
      }),
    };
  } catch (e) { scoreFeed = { ok: false, error: e.message, data: [] }; }

  // ---- แถบตัวเลขบนสุดของหน้า: ร้อยละการมาเรียน และเกรดเฉลี่ย ----
  // สองช่องนี้เป็น "—" มาตลอด — มี element ในหน้าแต่ไม่เคยมีใครส่งค่ามาให้
  let kpi = { ok: true, data: { attendancePercent: null, gpa: null } };
  try {
    const { rows: att } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('มา','สาย'))::int AS present
       FROM attendance
       WHERE student_id=$1 AND term=$2 AND year=$3 AND subject_code NOT LIKE 'CLUB%'`,
      [sid, term, year]
    );
    const { rows: gp } = await query(
      // เกรด 'ร' และ 'มส' ไม่ใช่ตัวเลข ไม่นับเข้าค่าเฉลี่ย
      `SELECT AVG(NULLIF(grade,'')::numeric) AS gpa
       FROM grade_summary
       WHERE student_id=$1 AND term=$2 AND year=$3 AND grade ~ '^[0-9]+(\\.[0-9]+)?$'`,
      [sid, term, year]
    );
    const a = att[0] || { total: 0, present: 0 };
    kpi = {
      ok: true,
      data: {
        attendancePercent: a.total > 0 ? Math.round((a.present / a.total) * 1000) / 10 : null,
        gpa: gp[0] && gp[0].gpa !== null ? Number(Number(gp[0].gpa).toFixed(2)) : null,
      },
    };
  } catch (e) { kpi = { ok: false, error: e.message, data: {} }; }

  return { timetable, scoreFeed, kpi };
}

// ============================================================
// getExecutiveDashboardBundle
// ============================================================
// This bundle deliberately has no department filter.  Executive users are the
// director/deputy-director role, so their dashboard is a whole-school view.
function dashboardSection(fn) {
  return Promise.resolve().then(fn)
    .then(data => ({ ok: true, data }))
    .catch(error => ({ ok: false, error: error.message }));
}

async function executiveKpi(config) {
  const today = schoolToday();
  const [people, morning, budget] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(role)='STUDENT' AND year=$1)::int AS students,
         COUNT(*) FILTER (WHERE UPPER(role) != 'STUDENT')::int AS staff
       FROM users`,
      [config.year]
    ),
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE flag_status IN ('มา','เข้าแถว','เข้า','ปกติ'))::int AS present
       FROM morning_activity WHERE date=$1 AND term=$2 AND year=$3`,
      [today, config.term, config.year]
    ),
    query(
      `SELECT COALESCE(SUM(budget_amount),0) AS total,
              COALESCE(SUM(used_amount),0) AS used
       FROM budgets WHERE year=$1`,
      [config.year]
    ),
  ]);
  const total = Number(morning.rows[0]?.total || 0);
  const present = Number(morning.rows[0]?.present || 0);
  const budgetTotal = Number(budget.rows[0]?.total || 0);
  const budgetUsed = Number(budget.rows[0]?.used || 0);
  return {
    studentCount: Number(people.rows[0]?.students || 0),
    teacherCount: Number(people.rows[0]?.staff || 0),
    attPct: total ? Math.round((present / total) * 1000) / 10 : null,
    todayPresent: present,
    todayTotal: total,
    budgetUsedPct: budgetTotal ? Math.round((budgetUsed / budgetTotal) * 100) : 0,
  };
}

async function executiveAcademic(config) {
  const today = schoolToday();
  const [trend, risk, missing] = await Promise.all([
    query(
      `SELECT to_char(day::date,'YYYY-MM-DD') AS date,
              COUNT(a.id) FILTER (WHERE a.status IN ('มา','สาย'))::int AS present,
              COUNT(a.id) FILTER (WHERE a.status IN ('ขาด','โดด'))::int AS absent,
              COUNT(a.id) FILTER (WHERE a.status IN ('ลา'))::int AS leave
       FROM generate_series(($1::date - INTERVAL '6 days'), $1::date, INTERVAL '1 day') AS day
       LEFT JOIN attendance a ON a.date=day::date AND a.term=$2 AND a.year=$3
       GROUP BY day ORDER BY day`,
      [today, config.term, config.year]
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT student_id FROM attendance
          WHERE term=$1 AND year=$2 AND status IN ('ขาด','โดด')
          GROUP BY student_id HAVING COUNT(*) >= 3
       ) AS at_risk`,
      [config.term, config.year]
    ),
    query(
      `SELECT u.username AS teacher_id, u.full_name AS name
       FROM users u
       WHERE UPPER(u.role)='TEACHER'
         AND EXISTS (SELECT 1 FROM timetable t WHERE t.teacher_id=u.username AND t.term=$1 AND t.year=$2)
         AND NOT EXISTS (
           SELECT 1 FROM academic_records r
            WHERE r.teacher_id=u.username AND r.term=$1 AND r.year=$2
              AND r.date BETWEEN ($3::date - INTERVAL '2 days') AND $3::date
         )
       ORDER BY u.full_name`,
      [config.term, config.year, today]
    ),
  ]);
  return {
    trend: trend.rows.map(r => ({
      date: r.date,
      present: Number(r.present || 0), absent: Number(r.absent || 0), leave: Number(r.leave || 0),
    })),
    riskCount: Number(risk.rows[0]?.count || 0),
    noAttendanceTeachers: missing.rows.map(r => ({ teacherId: r.teacher_id, name: r.name || '' })),
  };
}

async function executiveBudget(config) {
  const { rows } = await query(
    `SELECT project_name, budget_amount, used_amount
     FROM budgets WHERE year=$1 ORDER BY used_amount DESC, budget_amount DESC, project_name LIMIT 5`,
    [config.year]
  );
  const totals = await query(
    `SELECT COALESCE(SUM(budget_amount),0) AS total, COALESCE(SUM(used_amount),0) AS used
     FROM budgets WHERE year=$1`,
    [config.year]
  );
  return {
    total: Number(totals.rows[0]?.total || 0),
    used: Number(totals.rows[0]?.used || 0),
    projects: rows.map(r => {
      const total = Number(r.budget_amount || 0);
      const used = Number(r.used_amount || 0);
      return { name: r.project_name || '', total, used, pct: total ? Math.round((used / total) * 100) : 0 };
    }),
  };
}

async function executivePersonnel(config) {
  const today = schoolToday();
  const monthlyLeaves = await query(
    `SELECT staff_name, type, start_date, end_date
     FROM leave_records
     WHERE status='อนุมัติ' AND start_date < (date_trunc('month', $1::date) + INTERVAL '1 month')::date
       AND end_date >= date_trunc('month', $1::date)::date
     ORDER BY start_date DESC, request_date DESC`,
    [today]
  );
  const [staff, approvedToday, pending] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM users WHERE UPPER(role) != 'STUDENT'`),
    query(
      `SELECT COUNT(*)::int AS count FROM leave_records
       WHERE status='อนุมัติ' AND start_date <= $1 AND end_date >= $1`,
      [today]
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM leave_records WHERE status='รอพิจารณา' AND year=$1`,
      [config.year]
    ),
  ]);
  const rows = monthlyLeaves.rows;
  const leaveByType = {};
  for (const row of rows) leaveByType[row.type || 'อื่น ๆ'] = (leaveByType[row.type || 'อื่น ๆ'] || 0) + 1;
  return {
    staffCount: Number(staff.rows[0]?.count || 0),
    approvedLeaveToday: Number(approvedToday.rows[0]?.count || 0),
    pendingLeaveCount: Number(pending.rows[0]?.count || 0),
    leaveByType,
    thisMonthLeave: rows.slice(0, 5).map(r => ({ name: r.staff_name || '', type: r.type || '', startDate: r.start_date, endDate: r.end_date })),
  };
}

async function executiveGeneral(config) {
  const [recent, pending] = await Promise.all([
    query(
      `SELECT doc_type, doc_number, subject FROM sarabun WHERE year=$1 ORDER BY timestamp DESC, id DESC LIMIT 5`,
      [config.year]
    ),
    query(
      `SELECT COUNT(*)::int AS count FROM sarabun
       WHERE year=$1 AND NULLIF(file_key,'') IS NULL AND NULLIF(file_url,'') IS NULL`,
      [config.year]
    ),
  ]);
  return {
    recent: recent.rows.map(r => ({ docType: r.doc_type || '-', docNumber: r.doc_number || '-', subject: r.subject || '' })),
    pendingFile: Number(pending.rows[0]?.count || 0),
  };
}

async function executiveCalendar() {
  return getCalendarEvents();
}

async function getExecutiveDashboardBundle() {
  const getSystemConfig = require('./getSystemConfig');
  const config = await getSystemConfig();

  const [kpi, academic, budget, personnel, general, calendar] = await Promise.all([
    dashboardSection(() => executiveKpi(config)),
    dashboardSection(() => executiveAcademic(config)),
    dashboardSection(() => executiveBudget(config)),
    dashboardSection(() => executivePersonnel(config)),
    dashboardSection(() => executiveGeneral(config)),
    dashboardSection(() => executiveCalendar()),
  ]);

  return {
    ts: Date.now(),
    systemConfig: { ok: true, data: config },
    kpi, academic, budget, personnel, general, calendar,
  };
}

// ============================================================
// Club helpers
// ============================================================
async function getClubMembers([clubId, term, year]) {
  const { rows } = await query(
    `SELECT cm.student_id, cm.student_name, cm.class_name,
            to_char(cm.registered_at,'YYYY-MM-DD') as registered_at
     FROM club_members cm
     WHERE cm.club_id=$1 AND cm.term=$2 AND cm.year=$3
     ORDER BY cm.class_name, cm.student_id`,
    [clubId, term, year]
  );
  return rows.map(r => ({
    studentId: r.student_id,
    studentName: r.student_name || '',
    className: r.class_name || '',
    registeredAt: r.registered_at || '',
  }));
}

async function getClubMembersForTeacher([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT ca.club_id, c.club_name, cm.student_id, cm.student_name, cm.class_name
     FROM club_advisors ca
     JOIN clubs c ON c.club_id = ca.club_id AND c.term=ca.term AND c.year=ca.year
     JOIN club_members cm ON cm.club_id = ca.club_id AND cm.term=ca.term AND cm.year=ca.year
     WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3
     ORDER BY cm.class_name, cm.student_id`,
    [teacherId, term, year]
  );
  return rows.map(r => ({
    clubId: r.club_id,
    clubName: r.club_name,
    studentId: r.student_id,
    studentName: r.student_name || '',
    className: r.class_name || '',
  }));
}

/**
 * สรุปการเช็คชื่อของชุมนุม — คืน `{ sessions: ['YYYY-MM-DD'...], members: [{...pct}] }`
 *
 * ⚠️ ของเดิมพังสองชั้นพร้อมกัน หน้าจอเลยขึ้น "ยังไม่มีข้อมูลการเช็คชื่อ" ตลอดกาล:
 *  1. หน้าเว็บส่ง `(user.id, clubId, term, year, role)` 5 ตัว แต่ backend รับ 3
 *     → `clubId` ได้ค่าเป็น `user.id` แล้วเอาไปจับกับ `attendance.class` ซึ่งคนละอย่าง
 *  2. คืนเป็น "อาร์เรย์ของนักเรียน" แต่ฝั่งหน้าเว็บอ่าน `summary.sessions` /
 *     `summary.members` / `m.pct` — คนละรูปกันทั้งก้อน
 *
 * แถวเช็คชื่อของชุมนุมใช้ `subject_code = 'CLUB_<clubId>'` (ตั้งโดย `tcGoToAttendance`)
 * ไม่ใช่ `class` · รายชื่อยึดจาก `club_members` ไม่ใช่จากแถวเช็คชื่อ เด็กที่ไม่เคยมาเลย
 * ต้องขึ้นเป็น 0% ไม่ใช่หายไปจากรายการ
 */
async function getClubAttendanceSummary([clubId, term, year]) {
  const code = `CLUB_${String(clubId || '').trim()}`;
  const t = String(term || '');
  const y = String(year || '');

  const { rows: sessionRows } = await query(
    `SELECT DISTINCT to_char(date,'YYYY-MM-DD') AS d
       FROM attendance WHERE subject_code=$1 AND term=$2 AND year=$3
      ORDER BY d`,
    [code, t, y]
  );
  const sessions = sessionRows.map((r) => r.d);

  const { rows } = await query(
    `SELECT m.student_id, m.student_name, m.class_name,
            COUNT(a.id) FILTER (WHERE a.status IN ('มา','สาย')) AS present
       FROM club_members m
       LEFT JOIN attendance a
              ON a.student_id = m.student_id
             AND a.subject_code = $1 AND a.term = $2 AND a.year = $3
      WHERE m.club_id = $4 AND m.term = $2 AND m.year = $3
      GROUP BY m.student_id, m.student_name, m.class_name
      ORDER BY m.class_name, m.student_id`,
    [code, t, y, String(clubId || '').trim()]
  );

  return {
    sessions,
    members: rows.map((r) => ({
      studentId: r.student_id,
      studentName: r.student_name || '',
      className: r.class_name || '',
      present: parseInt(r.present, 10),
      // ยังไม่มีคาบที่เช็ค = ไม่มีเปอร์เซ็นต์ให้พูดถึง ไม่ใช่ 0% (หน้าเว็บแสดง '-')
      pct: sessions.length ? Math.round((parseInt(r.present, 10) / sessions.length) * 100) : null,
    })),
  };
}

async function deleteClub([clubId]) {
  await query(`DELETE FROM clubs WHERE club_id=$1`, [clubId]);
  cache.del('clubs_all');
  return { status: 'success', message: 'ลบชุมนุมสำเร็จ' };
}

/**
 * นักเรียนลงทะเบียนชุมนุมด้วยตัวเอง — `registerToClub(studentId, clubId)`
 *
 * ⚠️ เดิมรับ 7 ตัว (`[studentId, studentName, className, clubId, term, year, registeredBy]`)
 * แต่หน้าเว็บส่งมาแค่ 3 (`user.id, clubId, 'self'`) → `clubId` เป็น `undefined` ทุกครั้ง
 * นักเรียนกดลงทะเบียนแล้วเจอ **"ไม่พบชุมนุม" เสมอ ลงชุมนุมไม่ได้เลยทั้งระบบ**
 *
 * ชื่อ/ห้อง/เทอม/ปี **ไม่รับจาก client อีกแล้ว** — ชื่อกับห้องอ่านสดจาก `users`
 * (เด็กเปลี่ยนชื่อหรือเลื่อนชั้นแล้วแถวเก่าค้างชื่อเดิม) เทอม/ปีเอาจากค่า active
 * ส่วนตัวตนผ่าน `resolveStudentId` — นักเรียนลงให้ตัวเองเท่านั้น ส่งรหัสเพื่อนมาก็ไม่มีผล
 */
async function registerToClub([studentId, clubId], user) {
  const sid = resolveStudentId(user, studentId);
  const cid = String(clubId || '').trim();
  if (!cid) throw new Error('ไม่ได้ระบุชุมนุม');

  const { term, year } = await require('./getSystemConfig')();
  const { rows } = await query(
    `SELECT full_name, department FROM users WHERE username=$1`, [sid]
  );
  if (!rows.length) throw new Error('ไม่พบข้อมูลนักเรียน');

  return require('./clubs_write').registerClub([
    sid, rows[0].full_name || '', rows[0].department || '',
    cid, String(term), String(year), sid,
  ]);
}

/**
 * ยกเลิกชุมนุมของตัวเอง — `unregisterFromClub(studentId)`
 *
 * ⚠️ เดิมรับ `[studentId, term, year]` แต่หน้าเว็บส่ง `(user.id, clubId, 'self')`
 * → `term` ได้ค่าเป็น clubId, `year` เป็น `'self'` → `DELETE` ไม่ตรงแถวไหนเลย
 * แล้ว **คืน "ยกเลิกสำเร็จ"** นักเรียนเชื่อว่ายกเลิกแล้ว แต่ยังอยู่ในชุมนุมเดิม
 * (1 นักเรียน : 1 ชุมนุม : 1 เทอม จึงไม่ต้องระบุ clubId — เทอม/ปีเอาจากค่า active)
 */
async function unregisterFromClub([studentId], user) {
  const sid = resolveStudentId(user, studentId);
  const { term, year } = await require('./getSystemConfig')();
  return require('./clubs_write').unregisterClub([sid, String(term), String(year)]);
}

// ============================================================
// Leave
// ============================================================
async function getAllLeaves([year, statusFilter]) {
  const params = [year];
  let sql = `SELECT id, teacher_id, staff_name, type,
             to_char(start_date,'YYYY-MM-DD') as start_date,
             to_char(end_date,'YYYY-MM-DD') as end_date,
             days, reason, status, year, admin_comment, reviewed_by
             FROM leave_records WHERE year=$1`;
  if (statusFilter && statusFilter !== 'all') {
    params.push(statusFilter);
    sql += ` AND status=$${params.length}`;
  }
  sql += ' ORDER BY request_date DESC';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    leaveId: r.id, teacherId: r.teacher_id, teacherName: r.staff_name || '',
    type: r.type, startDate: r.start_date, endDate: r.end_date,
    days: parseFloat(r.days || 1), reason: r.reason || '',
    status: r.status, year: r.year,
    adminComment: r.admin_comment || '', reviewerName: r.reviewed_by || '',
  }));
}

// ============================================================
// Config / School info
// ============================================================
async function saveSchoolInfo([schoolName, logoBase64, logoFilename]) {
  if (schoolName) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1) VALUES('school_name','',$1)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1`,
      [schoolName]
    );
  }
  if (logoBase64) {
    await query(
      `INSERT INTO system_settings(key,subkey,value1,value2) VALUES('school_logo','',$1,$2)
       ON CONFLICT(key,subkey) DO UPDATE SET value1=$1, value2=$2`,
      [logoBase64, logoFilename || '']
    );
  }
  cache.del('system_config');
  return { status: 'success', message: 'บันทึกข้อมูลโรงเรียนสำเร็จ' };
}

async function savePrintConfigData([payload]) {
  // Frontend sends one object: { term, year, sys, hr }
  const term = payload?.term;
  const year = payload?.year;
  const sysData = payload?.sys || {};
  const homeroomData = payload?.hr || [];
  await query(
    `INSERT INTO print_config(term,year,sys_data,homeroom_data)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(term,year) DO UPDATE SET sys_data=$3, homeroom_data=$4`,
    [term, year, JSON.stringify(sysData), JSON.stringify(homeroomData)]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

// ============================================================
// Curriculum
// ============================================================
async function getCurriculumData([subjectCode]) {
  const params = [];
  let sql = `SELECT id, subject_code, subject_type, standard_code, description, eval_type FROM curriculum`;
  if (subjectCode) { params.push(subjectCode); sql += ` WHERE subject_code=$1`; }
  sql += ' ORDER BY subject_code, id';
  const { rows } = await query(sql, params);
  return rows.map(r => ({
    id: r.id, subjectCode: r.subject_code,
    subjectType: r.subject_type || '', standardCode: r.standard_code || '',
    description: r.description || '', evalType: r.eval_type || '',
  }));
}

/**
 * นำเข้าคลังตัวชี้วัด — เดินตาม `lib/importSpec.js` ชุดเดียวกับครู/นักเรียน/ตารางสอน
 *
 * ⚠️ เดิมคืน `{status:'success', message:'นำเข้า 0 รายการ'}` เมื่อ rows ไม่ใช่ array
 * และรับแถวดิบจากหน้าเว็บที่ `split(',')` เอง ไม่ข้ามหัวตาราง — แถวหัวตารางจึงเข้า DB
 * เป็นตัวชี้วัดจริง (prod มีแถว subject_type='ประเภท' ค้างอยู่ 1 แถวเป็นหลักฐาน)
 *
 * `clearOld` = ล้างคลังทั้งก้อนก่อนใส่ใหม่ · ต่างจากครู/นักเรียนที่ทับของเดิมอย่างเดียว
 * ตรงที่คลังเป็นของกลางที่แอดมินคุมทั้งชุด ไม่ใช่ตัวตนของใคร — แต่ต้องบอกจำนวนที่จะลบ
 * บนหน้ายืนยันก่อนเสมอ
 */
async function importCurriculumCSV([rows, clearOld]) {
  assertRows(rows);
  const { rows: clean, errors } = prepareRows('curriculum', rows);
  assertNoErrors(errors);

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  let deleted = 0;
  try {
    await client.query('BEGIN');
    if (clearOld) {
      const res = await client.query('DELETE FROM curriculum');
      deleted = res.rowCount || 0;
    }
    for (const r of clean) {
      await client.query(
        `INSERT INTO curriculum(subject_code,subject_type,standard_code,description,eval_type)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(subject_code,standard_code) DO UPDATE
           SET subject_type=$2, description=$4, eval_type=$5`,
        [r.subjectCode, r.subjectType, r.standardCode, r.description, r.evalType]
      );
      count++;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const wiped = clearOld ? ` (ลบของเดิม ${deleted} รายการ)` : '';
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ${wiped}` };
}

/** จำนวนแถวในคลังตอนนี้ — หน้ายืนยันต้องถามสด ไม่ใช่นับจากตัวแปรที่หน้าโหลดไว้ */
async function getCurriculumCount() {
  const { rows } = await query('SELECT count(*)::int AS n FROM curriculum');
  return { count: rows[0].n };
}

// ============================================================
// Stubs (DB already set up, just return success)
// ============================================================
async function setupCalendarDatabase() {
  return 'ฐานข้อมูลปฏิทินพร้อมใช้งานแล้ว';
}
async function setupClubDatabase() {
  return { status: 'success', message: 'ฐานข้อมูลชุมนุมพร้อมใช้งานแล้ว' };
}
// Instant-save for the ร/มส dropdown in the ปพ.5 grid (updateRemarkInstant in
// Scripts_Score.html) — writes the same score_database row the full save uses.
// Frontend order: (studentId, subjectCode, term, year, remark) — must stay in sync.
// Returns {success, val} because that is what updateRemarkInstant checks.
async function saveStudentRemarkDirectly([studentId, subjectCode, term, year, remark], user) {
  const { verifyTeacherOwnsSubject } = require('../lib/permissions');
  await verifyTeacherOwnsSubject(user, subjectCode, null, term, year);

  const val = String(remark ?? '').trim();
  const stored = val === '' ? '-' : val;
  const uid = `${studentId}_${subjectCode}_remark_${term}_${year}`;
  await query(
    `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
     VALUES($1,$2,$3,'remark',$4,$5,$6)
     ON CONFLICT(student_id,subject_code,indicator_id,term,year) DO UPDATE
       SET score=EXCLUDED.score, uid=EXCLUDED.uid`,
    [uid, String(studentId), subjectCode, stored, String(term), String(year)]
  );
  await query(
    `INSERT INTO score_history(teacher_id,student_id,subject_code,indicator_id,new_score,term,year)
     VALUES($1,$2,$3,'remark',$4,$5,$6)`,
    [String(user?.id || ''), String(studentId), subjectCode, stored, String(term), String(year)]
  );
  return { success: true, val, status: 'success', message: 'บันทึกหมายเหตุสำเร็จ' };
}
async function getTeacherListForDropdown() {
  const teachers = await require('./getTeachersForTimetable')();
  return teachers.map(t => t.name).filter(Boolean);
}

// ============================================================
// getPrintConfigData — reads print_config + homeroom assignments
// ============================================================
async function getPrintConfigData([term, year]) {
  const { getHomeroomAssignments } = require('./timetable_admin');
  const getSystemConfig = require('./getSystemConfig');

  const sysConfig = await getSystemConfig();
  const t = term || sysConfig.term;
  const y = year || sysConfig.year;

  // sys data from print_config table
  let sys = {
    school_name: sysConfig.schoolName || '',
    school_address: '',
    principal_name: '', measure_head: '', academic_head: '',
  };
  try {
    const { rows } = await query(
      `SELECT sys_data FROM print_config WHERE term=$1 AND year=$2`, [t, y]
    );
    if (rows.length > 0 && rows[0].sys_data) {
      const parsed = typeof rows[0].sys_data === 'string'
        ? JSON.parse(rows[0].sys_data) : rows[0].sys_data;
      sys = { ...sys, ...parsed };
    }
  } catch (_) { /* table may not exist yet */ }

  // homeroom from timetable
  let hr = [];
  try {
    const assignments = await getHomeroomAssignments([t, y]);
    const allIds = [...new Set(assignments.flatMap(a => a.teacherIds))].filter(Boolean);
    let nameMap = {};
    if (allIds.length > 0) {
      const { rows: urows } = await query(
        `SELECT username, full_name FROM users WHERE username = ANY($1)`, [allIds]
      );
      nameMap = Object.fromEntries(urows.map(u => [u.username, u.full_name || u.username]));
    }
    hr = assignments.map(a => ({
      cls: `${a.level}/${a.room}`,
      t1: nameMap[a.teacherIds[0]] || a.teacherIds[0] || '',
      t2: nameMap[a.teacherIds[1]] || a.teacherIds[1] || '',
    }));
  } catch (_) {}

  return { status: 'success', sys, hr };
}

// ============================================================
// getMyClub — club a student is registered to
// ============================================================
async function getMyClub([studentId, term, year], user) {
  const sid = resolveStudentId(user, studentId);
  const { rows } = await query(
    `SELECT cm.club_id, c.club_name, c.capacity,
            (SELECT COUNT(*) FROM club_members m2 WHERE m2.club_id=cm.club_id AND m2.term=$2 AND m2.year=$3) as member_count
     FROM club_members cm
     JOIN clubs c ON c.club_id=cm.club_id AND c.term=$2 AND c.year=$3
     WHERE cm.student_id=$1 AND cm.term=$2 AND cm.year=$3
     LIMIT 1`,
    [sid, term, year]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    clubId: r.club_id,
    clubName: r.club_name,
    maxMembers: parseInt(r.capacity || 0),
    memberCount: parseInt(r.member_count || 0),
  };
}

// ============================================================
// getMyClubs — clubs where teacher is advisor
// ============================================================
async function getMyClubs([teacherId, term, year]) {
  const { rows } = await query(
    `SELECT c.club_id, c.club_name, c.capacity, ca.role as my_role,
            (SELECT COUNT(*) FROM club_members m WHERE m.club_id=c.club_id AND m.term=$2 AND m.year=$3) as member_count
     FROM club_advisors ca
     JOIN clubs c ON c.club_id=ca.club_id AND c.term=ca.term AND c.year=ca.year
     WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3
     ORDER BY c.club_name`,
    [teacherId, term, year]
  );
  return rows.map(r => ({
    clubId: r.club_id,
    clubName: r.club_name,
    maxMembers: parseInt(r.capacity || 0),
    memberCount: parseInt(r.member_count || 0),
    myRole: r.my_role || 'หัวหน้า',
  }));
}

// ============================================================
// getCurriculumBySubject — filtered alias of getCurriculumData
// ============================================================
async function getCurriculumBySubject([subjectCode]) {
  return getCurriculumData([subjectCode]);
}

async function addCurriculumItem([item]) {
  const { rows } = await query(
    `INSERT INTO curriculum(subject_code, subject_type, standard_code, description, eval_type)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(subject_code, standard_code) DO NOTHING
     RETURNING id`,
    [String(item.subjectCode||'').trim(), String(item.subjectType||'').trim(),
     String(item.standardCode||'').trim(), String(item.description||'').trim(),
     String(item.evalType||'').trim()]
  );
  if (rows.length === 0) return { status: 'error', message: 'รหัสตัวชี้วัดนี้มีอยู่ในระบบแล้ว' };
  return { status: 'success', message: 'เพิ่มตัวชี้วัดสำเร็จ', id: rows[0].id };
}

async function updateCurriculumItem([id, item]) {
  await query(
    `UPDATE curriculum SET subject_code=$1, subject_type=$2, standard_code=$3,
     description=$4, eval_type=$5 WHERE id=$6`,
    [String(item.subjectCode||'').trim(), String(item.subjectType||'').trim(),
     String(item.standardCode||'').trim(), String(item.description||'').trim(),
     String(item.evalType||'').trim(), id]
  );
  return { status: 'success', message: 'แก้ไขสำเร็จ' };
}

async function deleteCurriculumItem([id]) {
  await query(`DELETE FROM curriculum WHERE id=$1`, [id]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

// ============================================================
// getAvailableSubstitutes — teachers free at given date/period
// ============================================================
async function getAvailableSubstitutes([date, period, originalSubjectCode, originalTeacherId, term, year]) {
  const DAYS = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  const dayName = DAYS[new Date(date).getDay()];

  // Get original teacher's department for group matching
  const { rows: origRows } = await query(
    `SELECT department FROM users WHERE username=$1 LIMIT 1`, [originalTeacherId]
  );
  const origDept = origRows[0]?.department || '';

  // Find teachers who have a timetable conflict at that slot
  const { rows: conflictRows } = await query(
    `SELECT DISTINCT teacher_id FROM timetable
     WHERE day=$1 AND period=$2 AND term=$3 AND year=$4`,
    [dayName, String(period), String(term), String(year)]
  );
  const conflictSet = new Set(conflictRows.map(r => r.teacher_id));

  // Also conflict if already assigned as substitute that date+period
  try {
    const { rows: subRows } = await query(
      `SELECT DISTINCT sub_teacher_id FROM substitute_assignments
       WHERE date=$1 AND period=$2 AND status != 'ยกเลิก'`,
      [date, String(period)]
    );
    subRows.forEach(r => conflictSet.add(r.sub_teacher_id));
  } catch (_) {}

  // Get all teachers + their lifetime substitute count
  const { rows: teachers } = await query(
    `SELECT u.username, u.full_name, u.department,
            COUNT(sa.id) AS sub_count
     FROM users u
     LEFT JOIN substitute_assignments sa ON sa.sub_teacher_id=u.username
     WHERE UPPER(u.role) = 'TEACHER' AND u.username != $1
     GROUP BY u.username, u.full_name, u.department
     ORDER BY u.full_name`,
    [originalTeacherId]
  );

  // Find teachers who taught same subject (for 'exact' badge)
  const { rows: exactRows } = await query(
    `SELECT DISTINCT teacher_id FROM timetable
     WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [originalSubjectCode, String(term), String(year)]
  );
  const exactSet = new Set(exactRows.map(r => r.teacher_id));

  const RANK = { exact: 0, group: 1, none: 2 };
  const result = teachers.map(t => ({
    teacherId:    t.username,
    name:         t.full_name,
    department:   t.department,
    subjectMatch: exactSet.has(t.username) ? 'exact'
                : (origDept && t.department === origDept ? 'group' : 'none'),
    hasConflict:  conflictSet.has(t.username),
    subCount:     Number(t.sub_count || 0),
  }));

  // Sort: no conflict first → exact > group > none → subCount ASC
  result.sort((a, b) => {
    if (a.hasConflict !== b.hasConflict) return a.hasConflict ? 1 : -1;
    const rd = RANK[a.subjectMatch] - RANK[b.subjectMatch];
    if (rd !== 0) return rd;
    return a.subCount - b.subCount;
  });
  return result;
}

// ============================================================
// updateTaskStatus — Notion todo update (stub: uses in-memory todo)
// ============================================================
async function updateTaskStatus([pageId, isDone]) {
  return { status: 'success' };
}

// sendTaskToNotion — คู่กับ updateTaskStatus, no-op เหมือนกัน (web ไม่ได้ต่อ Notion)
// เรียกเฉพาะ user 'teacher12' ตอนเพิ่ม todo. frontend ทำ JSON.parse(response) แล้วอ่าน .id
// ต้องคืน "สตริง JSON" ไม่ใช่ object และไม่มี id เพื่อให้ frontend ข้ามการผูก notionId ไป
// (todo จริง sync ผ่าน getTodoList.save อยู่แล้ว)
async function sendTaskToNotion([text]) {
  return '{}';
}

// ============================================================
// adminAddMember / adminRemoveMember — club admin actions
// ============================================================
async function adminAddMember([clubId, studentId]) {
  // Lookup student info
  const { rows } = await query(
    `SELECT username, full_name, department FROM users WHERE username=$1`, [studentId]
  );
  const u = rows[0] || {};

  // Check if already registered
  const existing = await query(
    `SELECT club_id FROM club_members WHERE student_id=$1`, [studentId]
  );
  if (existing.rows.length > 0) {
    return { status: 'already', message: `${studentId} ลงทะเบียนชุมนุมอื่นแล้ว` };
  }

  // Get club term/year
  const clubRes = await query(`SELECT term, year, capacity FROM clubs WHERE club_id=$1`, [clubId]);
  if (clubRes.rows.length === 0) return { status: 'error', message: 'ไม่พบชุมนุม' };
  const club = clubRes.rows[0];

  try {
    await query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,$3,$4,$5,$6,'admin')`,
      [clubId, studentId, u.full_name || '', u.department || '', club.term, club.year]
    );
    return { status: 'success', message: 'เพิ่มสมาชิกสำเร็จ' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function adminRemoveMember([clubId, studentId]) {
  await query(
    `DELETE FROM club_members WHERE club_id=$1 AND student_id=$2`, [clubId, studentId]
  );
  return { status: 'success', message: 'ลบสมาชิกสำเร็จ' };
}

// ============================================================
// promoteStudentsToNextYear — elevate class level, graduate ม.3 & ม.6
// ============================================================
async function promoteStudentsToNextYear() {
  const getSystemConfig = require('./getSystemConfig');
  const config = await getSystemConfig();
  const currentYear = parseInt(config.year);
  if (!currentYear) return { status: 'error', message: 'อ่านค่าปีการศึกษาไม่สำเร็จ' };

  // Snapshot full row before mutation
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status
     FROM users
     WHERE UPPER(role)='STUDENT' AND status='ปกติ' AND CAST(year AS INTEGER) < $1`,
    [currentYear]
  );

  if (rows.length === 0) {
    return { status: 'error', message: '⚠️ ไม่พบนักเรียนที่เข้าเงื่อนไขการเลื่อนชั้น!' };
  }

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let updateCount = 0;
  let graduateCount = 0;

  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const cls = String(r.department || '');
      const m = cls.match(/ม\.(\d+)\/(\d+)/);
      let newDept = r.department;
      let newStatus = r.status;
      let isGraduate = false;

      if (m) {
        const level = parseInt(m[1]);
        const room = parseInt(m[2]);
        if (level === 3 || level === 6) {
          newStatus = 'จบการศึกษา';
          isGraduate = true;
        } else {
          newDept = `ม.${level + 1}/${room}`;
        }
      }

      // Snapshot old row to user_history before mutation
      await client.query(
        `INSERT INTO user_history(username, action, changed_by, old_data, new_data)
         VALUES($1, 'promote', 'system', $2::jsonb, $3::jsonb)`,
        [
          r.username,
          JSON.stringify(r),
          JSON.stringify({ ...r, department: newDept, year: String(currentYear), status: newStatus }),
        ]
      );

      if (isGraduate) {
        await client.query(
          `UPDATE users SET status='จบการศึกษา', year=$1 WHERE username=$2`,
          [currentYear, r.username]
        );
        graduateCount++;
      } else {
        await client.query(
          `UPDATE users SET department=$1, year=$2 WHERE username=$3`,
          [newDept, currentYear, r.username]
        );
        updateCount++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const cache = require('../lib/cache');
  cache.del('all_users');

  return {
    status: 'success',
    message: `✅ เลื่อนชั้นสำเร็จ ${updateCount} คน\n🎓 จบการศึกษา (ม.3, ม.6) ${graduateCount} คน`,
  };
}

async function exportClubsForTerm([term, year]) {
  const clubsRes = await query(
    `SELECT club_id, club_name, capacity FROM clubs WHERE term=$1 AND year=$2 ORDER BY club_name`,
    [term, year]
  );
  const clubs = [];
  for (const c of clubsRes.rows) {
    const advRes = await query(
      `SELECT teacher_name FROM club_advisors WHERE club_id=$1 AND term=$2 AND year=$3`,
      [c.club_id, term, year]
    );
    const memRes = await query(
      `SELECT student_id, student_name, class_name FROM club_members WHERE club_id=$1 AND term=$2 AND year=$3 ORDER BY class_name, student_id`,
      [c.club_id, term, year]
    );
    clubs.push({
      clubName: c.club_name,
      capacity: c.capacity,
      advisors: advRes.rows.map(r => ({ teacherName: r.teacher_name })),
      members: memRes.rows.map(r => ({ studentId: r.student_id, studentName: r.student_name, className: r.class_name })),
    });
  }
  return { term, year, clubs };
}

module.exports = {
  getTeacherRiskDashboard,
  getTeacherAtRiskDashboard,
  getStudentDashboardBundle,
  getExecutiveDashboardBundle,
  getClubMembers,
  getClubMembersForTeacher,
  getClubAttendanceSummary,
  deleteClub,
  registerToClub,
  unregisterFromClub,
  getAllLeaves,
  saveSchoolInfo,
  savePrintConfigData,
  getPrintConfigData,
  getCurriculumData,
  getCurriculumBySubject,
  importCurriculumCSV,
  getCurriculumCount,
  addCurriculumItem,
  updateCurriculumItem,
  deleteCurriculumItem,
  setupCalendarDatabase,
  setupClubDatabase,
  saveStudentRemarkDirectly,
  getTeacherListForDropdown,
  getMyClub,
  getMyClubs,
  getAvailableSubstitutes,
  updateTaskStatus,
  sendTaskToNotion,
  adminAddMember,
  adminRemoveMember,
  promoteStudentsToNextYear,
  exportClubsForTerm,
};
