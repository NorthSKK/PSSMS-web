const { query } = require('../lib/db');
const cache = require('../lib/cache');

function invalidateUsers() {
  cache.del('all_users');
}

function pickName(u) {
  return String(u.fullname || u.fullName || u.full_name || '').trim();
}
function pickDept(u) {
  return String(u.department || u.dept || '').trim();
}

async function addUser([form]) {
  const u = form || {};
  const sysConfig = await require('./getSystemConfig')();
  await query(
    `INSERT INTO users(username, password, full_name, role, department, email, year, status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (username) DO UPDATE SET
       password=$2, full_name=$3, role=$4, department=$5, email=$6, year=$7, status=$8`,
    [
      String(u.username || '').trim(),
      String(u.password || '').trim(),
      pickName(u),
      String(u.role || 'Teacher'),
      pickDept(u),
      String(u.email || '').trim(),
      String(u.year || sysConfig.year || '').trim(),
      String(u.status || 'ปกติ'),
    ]
  );
  invalidateUsers();
  return { status: 'success', message: 'เพิ่มผู้ใช้งานสำเร็จ' };
}

async function editUser([form]) {
  const u = form || {};
  const username = String(u.username || '').trim();
  if (!username) return { status: 'fail', message: 'ไม่พบ username' };

  const { rowCount } = await query(
    `UPDATE users SET password=$1, full_name=$2, role=$3, department=$4, email=$5, status=$6
     WHERE username=$7`,
    [
      String(u.password || '').trim(),
      pickName(u),
      String(u.role || 'Teacher'),
      pickDept(u),
      String(u.email || '').trim(),
      String(u.status || 'ปกติ'),
      username,
    ]
  );
  invalidateUsers();
  if (rowCount === 0) return { status: 'fail', message: 'ไม่พบผู้ใช้' };
  return { status: 'success', message: 'แก้ไขสำเร็จ' };
}

async function deleteUser([username]) {
  await query(`DELETE FROM users WHERE username=$1`, [String(username).trim()]);
  invalidateUsers();
  return { status: 'success', message: 'ลบสำเร็จ' };
}

async function importStudentCSV([rows, year]) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: 'success', message: 'นำเข้า 0 รายการ', imported: 0 };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.username) continue;
      await client.query(
        `INSERT INTO users(username, password, full_name, role, department, email, year, status)
         VALUES($1,$2,$3,'Student',$4,$5,$6,$7)
         ON CONFLICT (username) DO UPDATE SET
           full_name=$3, department=$4, email=$5, year=$6, status=$7`,
        [
          String(r.username).trim(),
          String(r.password || r.username).trim(),
          String(r.fullName || r.full_name || '').trim(),
          String(r.department || r.className || '').trim(),
          String(r.email || '').trim(),
          String(r.year || year || '').trim(),
          String(r.status || 'ปกติ'),
        ]
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
  invalidateUsers();
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ`, imported: count };
}

async function importTeacherCSV([rows]) {
  if (!Array.isArray(rows) || rows.length === 0) return { status: 'success', message: 'นำเข้า 0 รายการ', imported: 0 };
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      if (!r.username) continue;
      await client.query(
        `INSERT INTO users(username, password, full_name, role, department, email, status)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (username) DO UPDATE SET
           full_name=$3, role=$4, department=$5, email=$6, status=$7`,
        [
          String(r.username).trim(),
          String(r.password || r.username).trim(),
          String(r.fullName || r.full_name || '').trim(),
          String(r.role || 'Teacher'),
          String(r.department || r.dept || '').trim(),
          String(r.email || '').trim(),
          String(r.status || 'ปกติ'),
        ]
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
  invalidateUsers();
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ`, imported: count };
}

async function getStudentSummaryStats([year]) {
  const { rows } = await query(
    `SELECT department, COUNT(*) as cnt
     FROM users WHERE UPPER(role)='STUDENT' AND year=$1 AND status='ปกติ'
     GROUP BY department ORDER BY department`,
    [year]
  );
  const byClass = Object.fromEntries(rows.map(r => [r.department, parseInt(r.cnt)]));
  const total = rows.reduce((s, r) => s + parseInt(r.cnt), 0);
  return { total, byClass };
}

module.exports = {
  addUser,
  editUser,
  deleteUser,
  importStudentCSV,
  importTeacherCSV,
  getStudentSummaryStats,
};
