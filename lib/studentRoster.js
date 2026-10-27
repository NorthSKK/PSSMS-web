'use strict';

// เลขที่เป็นข้อมูลทะเบียน ไม่ใช่ลำดับแถวหรือรหัสนักเรียน.
function studentNo(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const s = String(value).trim();
  if (!/^0*[1-9]\d*$/.test(s) || !Number.isSafeInteger(Number(s)) || Number(s) > 2147483647) {
    throw new Error('เลขที่ต้องเป็นจำนวนเต็มบวก หรือเว้นว่าง');
  }
  return Number(s);
}

function classKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9ก-๙]/g, '').toLowerCase();
}

// เลขที่เดิมของระบบ = ลำดับเมื่อเรียงรหัสแบบข้อความ ไม่ใช่เลขรหัสแบบตัวเลข.
function compareStudentIds(a, b) {
  return String(a.username).localeCompare(String(b.username));
}

// เติมเฉพาะค่าที่ยังไม่กำหนด โดยจองเลขที่ที่กำหนดแล้วไว้ก่อนเสมอ.
// ผู้เขียนทะเบียน persist ผลลัพธ์; รายชื่อเก่าที่ไม่มี snapshot ใช้เป็น fallback ของปีนั้น.
function assignStudentNumbers(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.year || !row.department) continue;
    const key = JSON.stringify([String(row.year).trim(), classKey(row.department)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const members of groups.values()) {
    const used = new Set(members.filter(r => r.student_no != null).map(r => Number(r.student_no)));
    let next = 1;
    for (const row of members.filter(r => r.student_no == null).sort(compareStudentIds)) {
      while (used.has(next)) next++;
      row.student_no = next;
      used.add(next++);
    }
  }
  return rows;
}

function compareStudents(a, b) {
  const cls = String(a.department || '').localeCompare(String(b.department || ''), 'th', { numeric: true });
  if (cls) return cls;
  const an = a.student_no == null ? Infinity : Number(a.student_no);
  const bn = b.student_no == null ? Infinity : Number(b.student_no);
  if (an !== bn) return an < bn ? -1 : 1;
  return compareStudentIds(a, b);
}

function studentArray(r) {
  return [r.username, '', r.full_name, r.role, r.department || '', r.email || '',
    r.year || '', r.status || 'ปกติ', r.student_no == null ? null : Number(r.student_no)];
}

module.exports = { studentNo, classKey, compareStudentIds, assignStudentNumbers, compareStudents, studentArray };
