'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

function scores() {
  const writes = [];
  const query = async (sql, args) => { writes.push({ sql, args }); return { rows: [], rowCount: 1 }; };
  const ctx = { module: { exports: {} }, require(name) {
    if (name === '../lib/db') return { query, pool: { connect: async () => ({ query, release() {} }) } };
    if (name === '../lib/permissions') return { resolveTeacherId: () => 'teacher1', verifyTeacherOwnsSubject: async () => {} };
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync('functions/scores.js', 'utf8'), ctx);
  return { save: payload => ctx.module.exports.saveAllInOneWithConfig([{
    subjectCode: 'OWN', className: 'ม.1/1', term: '2', year: '2569', ...payload,
  }], { id: 'teacher1' }), writes };
}

test('score ratios preserve numeric zero', async () => {
  const s = scores(); await s.save({ newConfig: { formative: 100, midterm: 0, final: 0 } });
  assert.equal(s.writes.find(w => w.sql.includes('INSERT INTO subject_config')).args[5], '100:0:0');
});
for (const [field, value] of [['subjectCode', 'OTHER'], ['term', '1'], ['year', '2568']]) {
  test('assessment '+field+' cannot escape the authorized context or partially save', async () => {
    const s = scores();
    await assert.rejects(s.save({ newConfig: { formative: 70 }, qualRecords: [{ studentId: '01903', [field]: value }] }), /วิชา|ภาคเรียน|ปีการศึกษา/);
    assert.equal(s.writes.length, 0);
  });
}
test('competency zero is saved and omitted competency preserves a previous value', async () => {
  const s = scores();
  await s.save({ qualRecords: [{ studentId: '01903', comp: 0 }, { studentId: '01904' }] });
  const writes = s.writes.filter(w => w.sql.includes('INSERT INTO qualitative_assess'));
  assert.equal(writes[0].args[16], 0);
  assert.equal(writes[1].args[16], null);
  assert.match(writes[1].sql, /comp=COALESCE\(\$17,\s*qualitative_assess\.comp\)/);
  assert.match(writes[1].sql, /COALESCE\(\$17,\s*3\)/);
});
test('legacy rows without context are accepted, while invalid competency blocks all writes', async () => {
  const valid = scores();
  await valid.save({ qualRecords: [{ studentId: '01903', subjectCode: 'OWN', term: 2, year: 2569, comp: '2' }] });
  assert.equal(valid.writes.find(w => w.sql.includes('INSERT INTO qualitative_assess')).args[16], 2);
  const invalid = scores();
  await assert.rejects(invalid.save({ newConfig: { formative: 100 }, qualRecords: [{ studentId: '01903', comp: 4 }] }), /สมรรถนะ/);
  assert.equal(invalid.writes.length, 0);
});

function attendance(rows, failSync = false) {
  const calls = [], checks = [], errors = [];
  const ctx = { module: { exports: {} }, console: { error: (...args) => errors.push(args) }, require(name) {
    if (name === '../lib/db') return { query: async (sql, args) => { calls.push({ sql, args }); return { rows, rowCount: rows.length }; } };
    if (name === '../lib/permissions') return { verifySessionOwner: async () => checks.push('session'), verifyAttendanceBatchOwner: async () => checks.push('batch') };
    if (name === './autoMs') return { syncAutoMs: async target => { calls.push({ sync: target }); if (failSync) throw Error('summary unavailable'); } };
    if (['../lib/sessionCalendar', '../lib/schoolDate', './attendanceReport'].includes(name)) return {};
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync('functions/attendance.js', 'utf8'), ctx);
  return { api: ctx.module.exports, calls, checks, errors };
}
const row = (subject_code = 'ว1', cls = 'ม.1/1') => ({ subject_code, class: cls, term: '2', year: '2569' });
test('editing attendance history rechecks every affected course once', async () => {
  const a = attendance([row(), row(), row('ท1', 'ม.2/1')]);
  const result = await a.api.updateAttendanceBatch([[{ rowIdx: 1, status: 'มา' }, { rowIdx: 2, status: 'ขาด' }, { rowIdx: 3, status: 'มา' }]], {});
  assert.equal(result.updated, 3);
  assert.equal(a.checks[0], 'batch');
  assert.match(a.calls[0].sql, /RETURNING/);
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls.filter(c => c.sync).map(c => c.sync))), [
    { subjectCode: 'ว1', className: 'ม.1/1', term: '2', year: '2569' },
    { subjectCode: 'ท1', className: 'ม.2/1', term: '2', year: '2569' },
  ]);
});
test('single status edit syncs its database context and summary failure does not undo attendance', async () => {
  const a = attendance([row()], true);
  const result = await a.api.updateAttendanceStatus(['session', '01903', 'มา'], {});
  assert.equal(result.status, 'success'); assert.equal(result.updated, 1);
  assert.equal(a.checks[0], 'session'); assert.equal(a.calls.filter(c => c.sync).length, 1);
  assert.equal(a.errors.length, 1);
});
test('missing attendance rows never trigger summary updates or report an invented update count', async () => {
  const a = attendance([]);
  await assert.rejects(a.api.updateAttendanceStatus(['session', '01903', 'มา'], {}), /ไม่พบรายการ/);
  const result = await a.api.updateAttendanceBatch([[{ rowIdx: 1, status: 'มา' }]], {});
  assert.equal(result.updated, 0);
  assert.equal(a.calls.filter(c => c.sync).length, 0);
});
