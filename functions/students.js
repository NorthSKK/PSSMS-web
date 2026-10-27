const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { compareStudents, studentArray, assignStudentNumbers } = require('../lib/studentRoster');

function normalizeClass(str) {
  return String(str || '').replace(/[^a-zA-Z0-9ก-๙]/g, '').toLowerCase();
}

async function getStudentsByClass([className, year]) {
  const norm = normalizeClass(className);
  const cacheKey = `students_${norm}_${year || 'active'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const config = year ? { year } : await require('./getSystemConfig')();
  const y = String(year || config.year || '').trim();
  const activeYear = String((await require('./getSystemConfig')()).year || '').trim();
  const isHistorical = y && activeYear && y !== activeYear;

  // 1. users table — current registration
  const { rows } = await query(
    `SELECT username, password, full_name, role, department, email, year, status, student_no
     FROM users WHERE UPPER(role)='STUDENT' AND year=$1 AND status='ปกติ'
     ORDER BY username`,
    [y]
  );
  let matched = rows.filter(r => normalizeClass(r.department) === norm);

  // 2a. historical fallback — user_history snapshot from promote events
  if (isHistorical) {
    const { rows: histRows } = await query(
      `SELECT DISTINCT ON (username)
              username,
              old_data->>'password'   AS password,
              old_data->>'full_name'  AS full_name,
              old_data->>'role'       AS role,
              old_data->>'department' AS department,
              old_data->>'email'      AS email,
              old_data->>'year'       AS year,
              old_data->>'status'     AS status,
              (old_data->>'student_no')::integer AS student_no
       FROM user_history
       WHERE action IN ('promote','student_roster')
         AND old_data->>'year'=$1
         AND old_data->>'department'=$2
       ORDER BY username, timestamp DESC, id DESC`,
      [y, className]
    );
    const registered = new Set(matched.map(r => r.username));
    matched.push(...histRows.filter(r => normalizeClass(r.department) === norm && !registered.has(r.username)));
  }

  // 2b. fallback — DISTINCT attendance(student_id, student_name, class) snapshot
  if (matched.length === 0 && isHistorical) {
    const { rows: attRows } = await query(
      `SELECT DISTINCT a.student_id, a.student_name, a.class,
              u.password, u.email
       FROM attendance a
       LEFT JOIN users u ON u.username = a.student_id
       WHERE a.year=$1 AND a.class=$2
       ORDER BY a.student_id`,
      [y, className]
    );
    matched = attRows.map(r => ({
      username: r.student_id,
      password: r.password || '',
      full_name: r.student_name || '',
      role: 'Student',
      department: r.class || className,
      email: r.email || '',
      year: y,
      status: 'ปกติ',
    }));
  }

  // 3. last-resort fallback: ignore year filter (current term, no exact match)
  if (matched.length === 0 && !isHistorical) {
    const { rows: anyYear } = await query(
      `SELECT username, password, full_name, role, department, email, year, status
       FROM users WHERE UPPER(role)='STUDENT' AND status='ปกติ'
       ORDER BY username`
    );
    matched = anyYear.filter(r => normalizeClass(r.department) === norm);
  }

  const result = assignStudentNumbers(matched).sort(compareStudents).map(studentArray);
  cache.set(cacheKey, result, 300);
  return result;
}

async function getStudentsByClub([clubId, year]) {
  const { rows } = await query(
    `SELECT u.username, u.full_name, u.role,
            u.department, u.email, u.year, u.status,
            cm.class_name, cm.year AS roster_year
     FROM club_members cm
     JOIN users u ON u.username = cm.student_id
     WHERE cm.club_id = $1 AND ($2::text IS NULL OR cm.year=$2)
     ORDER BY u.username`,
    [clubId, year || null]
  );
  // เลขที่ของชุมนุมยังเป็นเลขที่ในห้องเรียนของปีที่ลงทะเบียน ไม่ใช่ลำดับในชุมนุม.
  const rosters = new Map();
  for (const r of rows) {
    const className = r.class_name || r.department || '';
    const key = JSON.stringify([className, r.roster_year]);
    if (!rosters.has(key)) rosters.set(key, await getStudentsByClass([className, r.roster_year]));
    const record = rosters.get(key).find(s => s[0] === r.username);
    r.department = className;
    r.year = r.roster_year;
    r.student_no = record ? record[8] : null;
  }
  return rows.sort(compareStudents).map(studentArray);
}

module.exports = { getStudentsByClass, getStudentsByClub };
