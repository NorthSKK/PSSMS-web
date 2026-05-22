const { query } = require('../lib/db');
const cache = require('../lib/cache');

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
    `SELECT username, password, full_name, role, department, email, year, status
     FROM users WHERE UPPER(role)='STUDENT' AND year=$1 AND status='ปกติ'
     ORDER BY username`,
    [y]
  );
  let matched = rows.filter(r => normalizeClass(r.department) === norm);

  // 2a. historical fallback — user_history snapshot from promote events
  if (matched.length === 0 && isHistorical) {
    const { rows: histRows } = await query(
      `SELECT DISTINCT ON (username)
              username,
              old_data->>'password'   AS password,
              old_data->>'full_name'  AS full_name,
              old_data->>'role'       AS role,
              old_data->>'department' AS department,
              old_data->>'email'      AS email,
              old_data->>'year'       AS year,
              old_data->>'status'     AS status
       FROM user_history
       WHERE action='promote'
         AND old_data->>'year'=$1
         AND old_data->>'department'=$2
       ORDER BY username, timestamp DESC`,
      [y, className]
    );
    matched = histRows.filter(r => normalizeClass(r.department) === norm);
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

  const result = matched.map(r => [
    r.username, '', r.full_name, r.role,
    r.department || '', r.email || '', r.year || '', r.status || 'ปกติ',
  ]);
  cache.set(cacheKey, result, 300);
  return result;
}

async function getStudentsByClub([clubId]) {
  const { rows } = await query(
    `SELECT u.username, u.full_name, u.role,
            u.department, u.email, u.year, u.status,
            cm.class_name
     FROM club_members cm
     JOIN users u ON u.username = cm.student_id
     WHERE cm.club_id = $1
     ORDER BY u.username`,
    [clubId]
  );
  return rows.map(r => [
    r.username, '', r.full_name, r.role,
    r.department || r.class_name || '', r.email || '', r.year || '', r.status || 'ปกติ',
  ]);
}

module.exports = { getStudentsByClass, getStudentsByClub };
