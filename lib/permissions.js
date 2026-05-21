'use strict';

function role(user) {
  return String(user?.role || '').trim().toUpperCase();
}

function adminOnly(user) {
  if (role(user) !== 'ADMIN') throw new Error('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ');
}

function teacherOrAdmin(user) {
  const r = role(user);
  if (r !== 'ADMIN' && r !== 'TEACHER') throw new Error('สงวนสิทธิ์เฉพาะครูหรือผู้ดูแลระบบ');
}

module.exports = { adminOnly, teacherOrAdmin };
