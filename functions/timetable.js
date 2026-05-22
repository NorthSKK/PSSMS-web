const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const cache = require('../lib/cache');

const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

async function _getTeacherClub(teacherId, term, year) {
  const { rows } = await query(
    `SELECT ca.club_id, c.club_name FROM club_advisors ca
     JOIN clubs c USING (club_id)
     WHERE ca.teacher_id=$1 AND ca.term=$2 AND ca.year=$3 LIMIT 1`,
    [teacherId, term, year]
  );
  return rows[0] ? { clubId: rows[0].club_id, clubName: rows[0].club_name } : null;
}

// Returns array [subjectCode, subjectName, classId, room, location, period, day] with optional extras
function _applyClubOverride(arr, club) {
  const isClub = String(arr[1] || '').indexOf('ชุมนุม') >= 0;
  if (!isClub) return arr;
  if (!club) {
    return ['ยังไม่ลงทะเบียน', 'ยังไม่ลงทะเบียนชุมนุม', arr[2], arr[3], arr[4], arr[5], arr[6], arr[7]];
  }
  return ['CLUB_' + club.clubId, club.clubName, 'ชุมนุม', arr[3], arr[4], arr[5], arr[6], arr[7]];
}

async function getTeacherTimetableByDate([teacherId, dateStr]) {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const targetDateOnly = targetDate.toISOString().slice(0, 10);
  const cacheKey = `tt_date_${teacherId}_${targetDateOnly}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const config = await getSystemConfig();
  const targetDay = DAYS[targetDate.getDay()];
  const { term, year } = config;

  const [ttRes, club] = await Promise.all([
    query(
      `SELECT subject_code, subject_name, level, room, location, teacher_id, day, period
       FROM timetable WHERE teacher_id=$1 AND day=$2 AND term=$3 AND year=$4 ORDER BY period::int`,
      [teacherId, targetDay, term, year]
    ),
    _getTeacherClub(teacherId, term, year),
  ]);

  const rows = ttRes.rows.map(r => {
    const classId = `${r.level}/${r.room}`;
    return _applyClubOverride(
      [r.subject_code, r.subject_name, classId, r.room, r.location || '', r.period, r.day],
      club
    );
  });

  try {
    const subRes = await query(
      `SELECT * FROM substitute_assignments
       WHERE sub_teacher_id=$1 AND date=$2 AND status='จัดแล้ว'`,
      [teacherId, targetDateOnly]
    );
    for (const r of subRes.rows) {
      rows.push([
        r.subject_code || '', r.subject_name || '', r.class || '',
        r.room || '', '', r.period || '', r.day_of_week || '',
        true, r.original_teacher_name || '', r.original_teacher_id || '',
      ]);
    }
  } catch {}

  cache.set(cacheKey, rows, 60);
  return rows;
}

async function getTeacherTimetable([teacherId]) {
  return getTeacherTimetableByDate([teacherId, null]);
}

async function getTeacherTimetableWithStatus([teacherId]) {
  const config = await getSystemConfig();
  const now = new Date();
  const today = DAYS[now.getDay()];
  const todayStr = now.toISOString().slice(0, 10);
  const { term, year } = config;

  const [ttRes, club] = await Promise.all([
    query(
      `SELECT t.subject_code, t.subject_name, t.level, t.room, t.location, t.period, t.day,
              (
                EXISTS(
                  SELECT 1 FROM attendance a
                  WHERE a.teacher_id=$1 AND a.date=$4
                    AND a.subject_code=t.subject_code
                    AND a.class=(t.level||'/'||t.room)
                    AND a.term=$2 AND a.year=$3
                ) OR EXISTS(
                  SELECT 1 FROM morning_activity ma
                  WHERE ma.teacher_id=$1 AND ma.date=$4
                    AND ma.class=(t.level||'/'||t.room)
                    AND UPPER(t.subject_code)='HR'
                ) OR (
                  t.subject_name LIKE '%ชุมนุม%' AND
                  EXISTS(
                    SELECT 1 FROM attendance a
                    WHERE a.teacher_id=$1 AND a.date=$4
                      AND a.subject_code LIKE 'CLUB_%'
                      AND a.term=$2 AND a.year=$3
                  )
                )
              ) AS has_record
       FROM timetable t
       WHERE t.teacher_id=$1 AND t.day=$5 AND t.term=$2 AND t.year=$3
       ORDER BY t.period::int`,
      [teacherId, term, year, todayStr, today]
    ),
    _getTeacherClub(teacherId, term, year),
  ]);

  return ttRes.rows.map(r => {
    const classId = `${r.level}/${r.room}`;
    const base = _applyClubOverride(
      [r.subject_code, r.subject_name, classId, r.room, r.location || '', r.period, r.day, r.has_record || false],
      club
    );
    return { ...base, hasRecord: r.has_record || false, date: todayStr };
  });
}

module.exports = { getTeacherTimetableByDate, getTeacherTimetable, getTeacherTimetableWithStatus };
