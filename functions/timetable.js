const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const cache = require('../lib/cache');
const { schoolDateStr, schoolDayIndex } = require('../lib/schoolDate');

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

// วันตามเวลาโรงเรียน — ทั้งสตริงวันที่และเลขวันในสัปดาห์ต้องมาจาก TZ เดียวกัน
// ห้ามใช้ getFullYear()/getDay() ตรง ๆ: บน Railway process รันเป็น UTC (ดู lib/schoolDate.js)
const _localDateStr = schoolDateStr;

// Slots this teacher covers for someone else on the given date, shaped like a timetable row.
// 'ยืนยันแล้ว' must be included — the slot stays theirs after they confirm it.
async function _substituteRows(teacherId, dateStr, term, year) {
  const { rows } = await query(
    `SELECT s.subject_code, s.subject_name, s.class, s.room, s.period, s.day_of_week,
            EXISTS(
              SELECT 1 FROM attendance a
              WHERE a.teacher_id=$1 AND a.date=$2
                AND a.subject_code=s.subject_code AND a.class=s.class
                AND a.term=$3 AND a.year=$4
            ) AS has_record,
            s.original_teacher_name
     FROM substitute_assignments s
     WHERE s.sub_teacher_id=$1 AND s.date=$2 AND s.status IN ('จัดแล้ว', 'ยืนยันแล้ว')
     ORDER BY s.period::int`,
    [teacherId, dateStr, String(term), String(year)]
  );
  return rows.map(r => [
    r.subject_code || '', r.subject_name || '', r.class || '', r.room || '', '',
    r.period || '', r.day_of_week || '', r.has_record || false,
    true, r.original_teacher_name || '',
  ]);
}

async function getTeacherTimetableByDate([teacherId, dateStr]) {
  const targetDate = dateStr ? new Date(dateStr) : new Date();
  const targetDateOnly = _localDateStr(targetDate);
  const cacheKey = `tt_date_${teacherId}_${targetDateOnly}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const config = await getSystemConfig();
  const targetDay = DAYS[schoolDayIndex(targetDateOnly)];
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

  rows.push(...await _substituteRows(teacherId, targetDateOnly, term, year));

  cache.set(cacheKey, rows, 60);
  return rows;
}

async function getTeacherTimetable([teacherId]) {
  return getTeacherTimetableByDate([teacherId, null]);
}

async function getTeacherTimetableWithStatus([teacherId]) {
  const now = new Date();
  const todayStr = _localDateStr(now);
  const cacheKey = `tt_status_${teacherId}_${todayStr}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const config = await getSystemConfig();
  const today = DAYS[schoolDayIndex(todayStr)];
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

  const result = ttRes.rows.map(r => {
    const classId = `${r.level}/${r.room}`;
    const base = _applyClubOverride(
      [r.subject_code, r.subject_name, classId, r.room, r.location || '', r.period, r.day, r.has_record || false],
      club
    );
    return { ...base, hasRecord: r.has_record || false, date: todayStr };
  });

  for (const row of await _substituteRows(teacherId, todayStr, term, year)) {
    result.push({
      ...row,
      hasRecord: row[7],
      date: todayStr,
      isSubstitute: true,
      originalTeacherName: row[9],
    });
  }
  result.sort((a, b) => Number(a[5]) - Number(b[5]));

  cache.set(cacheKey, result, 60);
  return result;
}

// Slots this teacher covers over the next `days` days, for the dashboard strip.
async function getMySubstituteSlots([teacherId, days]) {
  const span = Number(days) || 7;
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + span);
  const { rows } = await query(
    `SELECT date, period, subject_code, subject_name, class, room,
            original_teacher_name, status
     FROM substitute_assignments
     WHERE sub_teacher_id=$1 AND date BETWEEN $2 AND $3
       AND status IN ('จัดแล้ว', 'ยืนยันแล้ว')
     ORDER BY date, period::int`,
    [teacherId, _localDateStr(from), _localDateStr(to)]
  );
  return rows.map(r => ({
    date: _localDateStr(new Date(r.date)),
    period: r.period,
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    className: r.class,
    room: r.room,
    originalTeacherName: r.original_teacher_name,
    status: r.status,
  }));
}

module.exports = {
  getTeacherTimetableByDate,
  getTeacherTimetable,
  getTeacherTimetableWithStatus,
  getMySubstituteSlots,
};
