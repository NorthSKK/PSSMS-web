const { query } = require('../lib/db');
const { isGradedSubject } = require('./autoMs');
const { getTeacherAtRiskDashboard } = require('./attendanceReport');

// ============================================================
// getTeacherRiskWatch — mid-term early warning for the "นักเรียนกลุ่มเสี่ยง" card.
//
// grade_summary only holds grades that are decided (completeness gate), so
// mid-term the card is empty by design. This computes live — never writes —
// three watch signals per student × subject, for students with no decided
// grade in that subject yet:
//
//   missing       blank score in a component someone in the same class
//                 already has a score for  → heading for ร
//   scorePct      earned ÷ max over the components this student has scores
//                 in, < LOW_SCORE_PERCENT  → heading for 0
//   attendancePct attendance ≤ 85% (formula from attendanceReport.js, not
//                 re-derived here)          → heading for มส
//
// ⚠️ score_database has no class column, so "someone in the class has a score"
// must be computed over the class roster, never over the whole subject code —
// two classes of the same subject can have different configs.
// ============================================================

const LOW_SCORE_PERCENT = 50;      // calculateGrade: < 50 → 0
const ATTENDANCE_WATCH_PERCENT = 85;

const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9ก-๙]/g, '');
const normID = (id) => String(id || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '') || '0';
const hasScore = (v) => v !== undefined && v !== null && String(v).trim() !== '';

function parseRatio(ratio) {
  const [f, m, x] = String(ratio || '').split(':').map(Number);
  return { formative: f || 0, midterm: m || 0, final: x || 0 };
}

function parseIndicators(json) {
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// Components of one subject×class: [{ key, label, max, ids:[indicator_id…] }]
// midterm_re overrides midterm, so either one counts as "has a midterm score".
function componentsOf(config) {
  const ratio = parseRatio(config.score_ratio);
  const out = parseIndicators(config.indicators_json).map((ind, i) => ({
    key: `formative_${i}`,
    label: String(ind.name || ind.code || `ชิ้นงานที่ ${i + 1}`).trim(),
    max: Number(ind.score) || 0,
    ids: [`formative_${i}`],
  }));
  if (ratio.midterm > 0) out.push({ key: 'midterm', label: 'สอบกลางภาค', max: ratio.midterm, ids: ['midterm_re', 'midterm'] });
  if (ratio.final > 0) out.push({ key: 'final', label: 'สอบปลายภาค', max: ratio.final, ids: ['final'] });
  return out;
}

function scoreOf(scores, comp) {
  for (const id of comp.ids) if (hasScore(scores[id])) return scores[id];
  return undefined;
}

/**
 * Pure: evaluate one class. Exported for tests.
 * roster: [{ id, name }] · scoresByStudent: { normID: { indicator_id: score } }
 */
function evaluateClass(components, roster, scoresByStudent) {
  const entered = components.filter(c =>
    roster.some(s => hasScore(scoreOf(scoresByStudent[normID(s.id)] || {}, c))));

  return roster.map(s => {
    const scores = scoresByStudent[normID(s.id)] || {};
    const missing = [];
    let earned = 0, max = 0;
    for (const c of entered) {
      const v = scoreOf(scores, c);
      if (!hasScore(v)) { missing.push(c.label); continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || c.max <= 0) continue;
      earned += n; max += c.max;
    }
    const scorePct = max > 0 ? Math.round((earned / max) * 10000) / 100 : null;
    return { id: s.id, name: s.name, missing, scorePct };
  });
}

async function getTeacherRiskWatch([teacherId, term, year]) {
  const tid = String(teacherId || '').trim();

  const [ttRes, attendance] = await Promise.all([
    query(
      `SELECT DISTINCT subject_code, subject_name, level, room
       FROM timetable WHERE teacher_id=$1 AND term=$2 AND year=$3`,
      [tid, term, year]
    ),
    getTeacherAtRiskDashboard([tid, term, year]),
  ]);

  const pairs = ttRes.rows
    .filter(r => isGradedSubject(r.subject_code))
    .map(r => ({
      subjectCode: r.subject_code,
      subjectName: r.subject_name || '',
      className: `${String(r.level).trim()}/${String(r.room).trim()}`,
    }));
  if (!pairs.length) return { status: 'success', summary: { zero: 0, r: 0, ms: 0 }, items: [] };

  const codes = [...new Set(pairs.map(p => p.subjectCode))];
  const [cfgRes, scoreRes, decidedRes, rosterRes] = await Promise.all([
    query(
      `SELECT subject_code, class_name, score_ratio, indicators_json
       FROM subject_config WHERE subject_code = ANY($1) AND term=$2 AND year=$3`,
      [codes, term, year]
    ),
    query(
      `SELECT student_id, subject_code, indicator_id, score
       FROM score_database WHERE subject_code = ANY($1) AND term=$2 AND year=$3`,
      [codes, term, year]
    ),
    // Any grade_summary row = the grade is decided (by the teacher or by autoMs)
    // and the card already shows it — no forecast on top.
    query(
      `SELECT student_id, subject_code FROM grade_summary
       WHERE subject_code = ANY($1) AND term=$2 AND year=$3`,
      [codes, term, year]
    ),
    query(
      `SELECT username, full_name, department FROM users
       WHERE UPPER(role)='STUDENT' AND status='ปกติ'`
    ),
  ]);

  const configOf = new Map(cfgRes.rows.map(c => [`${c.subject_code}|${normalize(c.class_name)}`, c]));
  const decided = new Set(decidedRes.rows.map(r => `${normID(r.student_id)}|${r.subject_code}`));

  // { subject_code: { normID: { indicator_id: score } } }
  const scores = {};
  for (const r of scoreRes.rows) {
    const bySubj = scores[r.subject_code] || (scores[r.subject_code] = {});
    const bySid = bySubj[normID(r.student_id)] || (bySubj[normID(r.student_id)] = {});
    bySid[r.indicator_id] = r.score;
  }
  // A remark ร/มส set by the teacher is a decision too.
  for (const code in scores) {
    for (const k in scores[code]) {
      const rm = String(scores[code][k].remark || '').trim();
      if (rm && rm !== '-') decided.add(`${k}|${code}`);
    }
  }

  const rosterOf = {};
  for (const u of rosterRes.rows) {
    const k = normalize(u.department);
    (rosterOf[k] || (rosterOf[k] = [])).push({ id: u.username, name: u.full_name || u.username });
  }

  const items = new Map();   // `${normID}|${subjectCode}` → item
  const itemFor = (p, s) => {
    const key = `${normID(s.id)}|${p.subjectCode}`;
    if (!items.has(key)) {
      items.set(key, {
        studentId: s.id, stdName: s.name,
        className: p.className, subjectCode: p.subjectCode, subjectName: p.subjectName,
        missing: [], scorePct: null, attendancePct: null,
      });
    }
    return items.get(key);
  };

  for (const p of pairs) {
    const cfg = configOf.get(`${p.subjectCode}|${normalize(p.className)}`);
    const roster = rosterOf[normalize(p.className)] || [];
    if (!cfg || !roster.length) continue;
    for (const r of evaluateClass(componentsOf(cfg), roster, scores[p.subjectCode] || {})) {
      if (decided.has(`${normID(r.id)}|${p.subjectCode}`)) continue;
      const low = r.scorePct !== null && r.scorePct < LOW_SCORE_PERCENT;
      if (!r.missing.length && !low) continue;
      const it = itemFor(p, r);
      it.missing = r.missing;
      if (low) it.scorePct = r.scorePct;
    }
  }

  const pairOf = new Map(pairs.map(p => [`${normalize(p.subjectCode)}|${normalize(p.className)}`, p]));
  for (const a of [...attendance.critical, ...attendance.ms, ...attendance.risk]) {
    const p = pairOf.get(`${normalize(a.subjectCode)}|${normalize(a.className)}`);
    if (!p || decided.has(`${normID(a.id)}|${p.subjectCode}`)) continue;
    const pct = Number(a.percent);
    if (!(pct <= ATTENDANCE_WATCH_PERCENT)) continue;
    itemFor(p, { id: a.id, name: a.name }).attendancePct = pct;
  }

  const list = [...items.values()].sort((a, b) =>
    a.className.localeCompare(b.className) ||
    a.subjectCode.localeCompare(b.subjectCode) ||
    String(a.studentId).localeCompare(String(b.studentId)));

  return {
    status: 'success',
    summary: {
      zero: list.filter(i => i.scorePct !== null).length,
      r: list.filter(i => i.missing.length > 0).length,
      ms: list.filter(i => i.attendancePct !== null).length,
    },
    items: list,
  };
}

module.exports = {
  getTeacherRiskWatch,
  evaluateClass,
  componentsOf,
  LOW_SCORE_PERCENT,
  ATTENDANCE_WATCH_PERCENT,
};
