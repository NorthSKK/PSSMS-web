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

function compareStudents(a, b) {
  const cls = String(a.department || '').localeCompare(String(b.department || ''), 'th', { numeric: true });
  if (cls) return cls;
  const an = a.student_no == null ? Infinity : Number(a.student_no);
  const bn = b.student_no == null ? Infinity : Number(b.student_no);
  if (an !== bn) return an < bn ? -1 : 1;
  return String(a.username).localeCompare(String(b.username), 'th', { numeric: true });
}

function studentArray(r) {
  return [r.username, '', r.full_name, r.role, r.department || '', r.email || '',
    r.year || '', r.status || 'ปกติ', r.student_no == null ? null : Number(r.student_no)];
}

module.exports = { studentNo, classKey, compareStudents, studentArray };
