const { query } = require('../lib/db');
const cache = require('../lib/cache');
const { assertRows, prepareRows, assertNoErrors } = require('../lib/importSpec');
const { studentNo, classKey, assignStudentNumbers } = require('../lib/studentRoster');

function invalidateUsers() {
  cache.delPrefix('all_users');
  cache.delPrefix('students_');
}

function pickName(u) {
  return String(u.fullname || u.fullName || u.full_name || '').trim();
}
function pickDept(u) {
  return String(u.department || u.dept || '').trim();
}

// ทั้ง single edit และ import ใช้ transaction เดียวกัน: ตรวจสภาพสุดท้ายก่อนเขียน
// แล้วปลดเลขที่ของสมาชิกใน batch ชั่วคราวเพื่อให้สลับเลขที่/ย้ายห้องกันได้.
async function writeRegistrations(forms, { importing = false, editing = false } = {}) {
  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    const ids = forms.map(u => u.username);
    const { rows } = await client.query('SELECT * FROM users WHERE username = ANY($1)', [ids]);
    const old = new Map(rows.map(r => [r.username, r]));
    if (editing && !old.has(ids[0])) {
      await client.query('ROLLBACK');
      return false;
    }
    const planned = forms.map(u => {
      const prev = old.get(u.username);
      if (importing && prev && String(prev.role).toUpperCase() !== 'STUDENT') {
        throw new Error(`รหัสนักเรียน ${u.username} ซ้ำกับบัญชีบุคลากร กรุณาตรวจรหัสนักเรียน`);
      }
      const next = { ...u, year: u.year === undefined ? String(prev?.year || '') : u.year };
      const isStudent = String(next.role).toUpperCase() === 'STUDENT';
      const sameRoster = prev && String(prev.role).toUpperCase() === 'STUDENT'
        && classKey(prev.department) === classKey(next.department) && String(prev.year || '').trim() === next.year;
      next.student_no = isStudent
        ? (Object.prototype.hasOwnProperty.call(u, 'studentNo') ? studentNo(u.studentNo) : sameRoster ? prev.student_no : null)
        : null;
      if (next.student_no != null && (!next.department || !next.year)) throw new Error('กรุณาระบุห้องเรียนและปีการศึกษาก่อนกำหนดเลขที่');
      if (importing && prev) next.password = prev.password;
      return next;
    });
    const { rows: others } = await client.query(
      `SELECT username, department, year, student_no FROM users
       WHERE UPPER(role)='STUDENT' AND NOT (username = ANY($1))`, [ids]);
    const students = planned.filter(r => String(r.role).toUpperCase() === 'STUDENT');
    const occupied = new Map();
    for (const r of [...others, ...students]) {
      if (r.student_no == null) continue;
      const key = JSON.stringify([String(r.year || '').trim(), classKey(r.department), r.student_no]);
      if (occupied.has(key)) throw new Error(`เลขที่ ${r.student_no} ซ้ำในห้องเรียน ${r.department} ปี ${r.year} (${occupied.get(key)} และ ${r.username})`);
      occupied.set(key, r.username);
    }
    const missingOthers = others.filter(r => r.student_no == null);
    assignStudentNumbers([...others, ...students]);
    for (const next of planned) {
      const prev = old.get(next.username);
      if (prev && String(prev.role).toUpperCase() === 'STUDENT'
          && (prev.year !== next.year || prev.department !== next.department || String(next.role).toUpperCase() !== 'STUDENT')) {
        await client.query(
          `INSERT INTO user_history(username, action, changed_by, old_data, new_data)
           VALUES($1,'student_roster','system',$2::jsonb,$3::jsonb)`,
          [prev.username, JSON.stringify(prev), JSON.stringify(next)]);
      }
    }
    await client.query('UPDATE users SET student_no=NULL WHERE username = ANY($1)', [ids]);
    for (const r of missingOthers) {
      if (r.student_no != null) await client.query('UPDATE users SET student_no=$1 WHERE username=$2', [r.student_no, r.username]);
    }
    for (const r of planned) {
      await client.query(
        `INSERT INTO users(username,password,full_name,role,department,email,year,status,student_no)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(username) DO UPDATE SET password=$2,full_name=$3,role=$4,
           department=$5,email=$6,year=$7,status=$8,student_no=$9`,
        [r.username,r.password,r.full_name,r.role,r.department,r.email,r.year,r.status,r.student_no]);
    }
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505' && e.constraint === 'users_student_no_unique') throw new Error('เลขที่ซ้ำในห้องเรียนและปีการศึกษาเดียวกัน');
    throw e;
  } finally {
    client.release();
  }
}

function registrationForm(u, year) {
  return {
    username: String(u.username || '').trim(), password: String(u.password || '').trim(),
    full_name: pickName(u), role: String(u.role || 'Teacher'), department: pickDept(u),
    email: String(u.email || '').trim(), year, status: String(u.status || 'ปกติ'),
    ...(Object.prototype.hasOwnProperty.call(u, 'studentNo') ? { studentNo: u.studentNo } : {}),
  };
}

async function addUser([form]) {
  const u = form || {};
  const sysConfig = await require('./getSystemConfig')();
  await writeRegistrations([registrationForm(u, String(u.year || sysConfig.year || '').trim())]);
  invalidateUsers();
  return { status: 'success', message: 'เพิ่มผู้ใช้งานสำเร็จ' };
}

async function editUser([form]) {
  const u = form || {};
  const username = String(u.username || '').trim();
  if (!username) return { status: 'fail', message: 'ไม่พบ username' };

  const found = await writeRegistrations([registrationForm(u,
    Object.prototype.hasOwnProperty.call(u, 'year') ? String(u.year || '').trim() : undefined)], { editing: true });
  invalidateUsers();
  if (!found) return { status: 'fail', message: 'ไม่พบผู้ใช้' };
  return { status: 'success', message: 'แก้ไขสำเร็จ' };
}

async function deleteUser([username]) {
  await query(`DELETE FROM users WHERE username=$1`, [String(username).trim()]);
  invalidateUsers();
  return { status: 'success', message: 'ลบสำเร็จ' };
}

// ปีการศึกษามาจากค่า active ในระบบเท่านั้น ไม่ใช่คอลัมน์ในไฟล์ — พิมพ์ปีผิดในช่อง
// Excel ช่องเดียวคือนักเรียนทั้งรุ่นไปโผล่ผิดปี โดยที่หน้าจอไม่มีอะไรบอก
async function importStudentCSV([rows]) {
  assertRows(rows);
  const prepared = prepareRows('student', rows);
  assertNoErrors(prepared.errors);

  const { year } = await require('./getSystemConfig')();
  await writeRegistrations(prepared.rows.map(r => ({
    username: r.username, password: r.username, full_name: r.fullName, role: 'Student',
    department: `${r.level}/${r.room}`, email: r.email, year: String(year || ''), status: 'ปกติ',
    ...(Object.prototype.hasOwnProperty.call(r, 'studentNo') ? { studentNo: r.studentNo } : {}),
  })), { importing: true });
  const count = prepared.rows.length;
  invalidateUsers();
  return { status: 'success', message: `นำเข้าสำเร็จ ${count} รายการ`, imported: count };
}

async function importTeacherCSV([rows]) {
  assertRows(rows);
  const prepared = prepareRows('teacher', rows);
  assertNoErrors(prepared.errors);

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const r of prepared.rows) {
      await client.query(
        `INSERT INTO users(username, password, full_name, role, department, email, status)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (username) DO UPDATE SET
           full_name=$3, role=$4, department=$5, email=$6, status=$7`,
        [
          r.username,
          r.username,   // รหัสผ่านเริ่มต้น = ชื่อผู้ใช้
          r.fullName,
          r.role || 'Teacher',
          r.department,
          r.email,
          'ปกติ',
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
