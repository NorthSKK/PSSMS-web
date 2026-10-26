'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { importSpec, prepareRows } = require('../lib/importSpec');
const { compareStudents } = require('../lib/studentRoster');
const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const core = read('Scripts_Core.html'), admin = read('Scripts_Admin.html'), score = read('Scripts_Score.html');
function fn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name);
}
function context(extra = {}) {
  const sandbox = { console, window: {}, ...extra };
  vm.createContext(sandbox);
  vm.runInContext(['parseStudentNo', 'studentNoLabel', 'compareStudentRows'].map(n => fn(core, n)).join('\n'), sandbox);
  return sandbox;
}
const roster = () => [
  ['00001', '', 'สิบ', 'Student', 'ม.1/1', '', '2569', 'ปกติ', 10],
  ['00999', '', 'สอง', 'Student', 'ม.1/1', '', '2569', 'ปกติ', 2],
  ['00002', '', 'หนึ่ง', 'Student', 'ม.1/1', '', '2569', 'ปกติ', 1],
];
const plain = value => JSON.parse(JSON.stringify(value));

test('เรียงเลขที่ที่ server กำหนด 1/2/10 ตรงกัน แม้รหัสเรียงกลับกัน', () => {
  const ctx = context(), rows = roster();
  assert.deepEqual(rows.sort(ctx.compareStudentRows).map(r => r[0]), ['00002', '00999', '00001']);
  const objects = roster().map(r => ({ username: r[0], department: r[4], student_no: r[8] }));
  assert.deepEqual(objects.sort(compareStudents).map(r => r.username), rows.map(r => r[0]));
  assert.equal(ctx.studentNoLabel(rows[2].slice(0, 8)), '—');
  assert.equal(ctx.parseStudentNo('02'), 2);
  for (const v of ['0', '-1', '1.5', '2147483648']) assert.throws(() => ctx.parseStudentNo(v));
});

function importer() {
  const ctx = context({ _importSpec: importSpec() });
  vm.runInContext(['_headerKey', '_gridToRows', '_normalizeDayClient', '_validateImportRows'].map(n => fn(admin, n)).join('\n'), ctx);
  return ctx;
}
test('ไฟล์ไม่มีหัวเลขที่คง absent แต่หัวเลขที่ช่องว่างเป็นการล้าง', () => {
  const ctx = importer();
  const missing = ctx._gridToRows([['รหัสนักเรียน', 'ชื่อ-สกุล', 'ระดับ', 'ห้อง'], ['01903', 'ก', 'ม.1', '1']], 'student').rows[0];
  const blank = ctx._gridToRows([['รหัสนักเรียน', 'ชื่อ-สกุล', 'ระดับ', 'ห้อง', 'เลขที่'], ['01903', 'ก', 'ม.1', '1', '']], 'student').rows[0];
  assert.equal(Object.hasOwn(missing, 'studentNo'), false);
  assert.equal(blank.studentNo, '');
});
test('ตัวตรวจนำเข้า normalize 02/2 ก่อนกันซ้ำและตรวจจำนวนเต็มขอบเขตตรง server', () => {
  for (const numbers of [['02', '2'], ['2147483647', ''], ['2147483648', '1'], ['1.5', '1'], ['', '']]) {
    const rows = numbers.map((studentNo, i) => ({ username: '0190' + i, fullname: 'ก', level: 'ม.1', room: '1', studentNo }));
    const ctx = importer(), clientRows = rows.map((r, i) => ({ ...r, __excelRow: i + 2 }));
    const client = ctx._validateImportRows(clientRows, 'student'), server = prepareRows('student', rows);
    assert.equal(client.errors.length, server.errors.length, numbers.join(','));
    assert.deepEqual(clientRows.map(r => r.studentNo), server.rows.map(r => r.studentNo));
  }
});

function userForm(mode, role = 'Student') {
  const ids = { mode, inputUser: '01903', inputPass: '1234', inputName: 'ก', inputRole: role, inputDept: 'ม.1/1', inputEmail: '-', inputStatus: 'ปกติ', inputStudentNo: '02' };
  const elements = Object.fromEntries(Object.entries(ids).map(([id, value]) => [id, { value, classList: { toggle() {}, add() {}, remove() {} } }]));
  const calls = [], alerts = [];
  const chain = { withSuccessHandler() { return this; }, withFailureHandler(fn) { this.failure = fn; return this; }, addUser(form) { calls.push(['add', plain(form)]); }, editUser(form) { calls.push(['edit', plain(form)]); } };
  const ctx = context({ document: { getElementById: id => elements[id] || null }, google: { script: { run: chain } }, showAlert: m => alerts.push(m), showLoader() {} });
  vm.runInContext(fn(admin, 'saveUser'), ctx);
  return { ctx, elements, calls, alerts, chain };
}
test('เพิ่ม/แก้ทะเบียนส่งเลขที่จริง ล้างได้ แต่ staff ไม่ส่งเลขที่', () => {
  for (const mode of ['add', 'edit']) {
    const state = userForm(mode); state.ctx.saveUser();
    assert.equal(state.calls[0][0], mode);
    assert.equal(state.calls[0][1].studentNo, 2);
    assert.equal(state.calls[0][1].username, '01903');
    state.elements.inputStudentNo.value = ''; state.ctx.saveUser();
    assert.equal(state.calls[1][1].studentNo, null);
    state.elements.inputStudentNo.value = '0'; state.ctx.saveUser();
    assert.equal(state.calls.length, 2);
  }
  const staff = userForm('edit', 'Teacher'); staff.ctx.saveUser();
  assert.equal(Object.hasOwn(staff.calls[0][1], 'studentNo'), false);
  const rejected = userForm('edit'); rejected.ctx.saveUser();
  rejected.chain.failure(new Error('เลขที่ซ้ำ'));
  assert.equal(rejected.alerts[0], '❌ เลขที่ซ้ำ');
  assert.equal(rejected.elements.inputStudentNo.value, '02');
});

test('ทะเบียนแสดงเลขที่จริงและเปิดแก้ไขค่าจากช่องที่ 8 โดย staff ซ่อนช่องเลขที่', () => {
  const state = userForm('edit');
  const toggles = [];
  Object.assign(state.elements, {
    modalTitle: {}, userModal: {},
    studentNoFieldContainer: { classList: { toggle: (...args) => toggles.push(args) } },
    userForm: { reset() { state.elements.inputStudentNo.value = ''; } },
    studentAccordion: { innerHTML: '', querySelectorAll: () => [] },
  });
  state.ctx.allUsers = roster(); state.ctx._expandedGroups = new Set();
  state.ctx.bootstrap = { Modal: class { show() {} } };
  vm.runInContext(['toggleStatusField', 'openModal', 'escapeHtmlSafe', 'escapeAttr', 'jsArgAttr', '_studentStatusBadge', 'renderStudentAccordion'].map(n => fn(admin, n)).join('\n'), state.ctx);
  state.ctx.openModal('edit', '00001');
  assert.equal(state.elements.inputStudentNo.value, 10);
  assert.equal(state.elements.inputStudentNo.disabled, false);
  state.elements.inputRole.value = 'Teacher'; state.ctx.toggleStatusField();
  assert.deepEqual(toggles.at(-1), ['d-none', true]);
  assert.equal(state.elements.inputStudentNo.disabled, true);
  state.ctx.renderStudentAccordion(roster());
  assertGrid(state.elements.studentAccordion.innerHTML);
});

function grids() {
  const elements = {};
  const element = id => elements[id] ||= { innerHTML: '', innerText: '', value: '', style: {} };
  element('scoreClassSelect').value = JSON.stringify(['ว1', 'วิทย์', 'ม.1/1']);
  const ctx = context({ document: { getElementById: element, querySelector: () => null, querySelectorAll: () => [] },
    currentScoreStudents: roster(), currentScoreConfig: { indicators: [], ratio: '50:20:30' }, currentAttStats: {}, currentAutoMs: {},
    isHeaderEditMode: false, isQualVisible: false, sgsColumnStates: {}, setTimeout() {}, calcEvalRow() {}, fitGridHeight() {}, reCalcAllRows() {},
    normID: id => String(id).replace(/^0+/, '') || '0' });
  vm.runInContext(['renderAllInOneTable', 'renderEvalTable', 'renderSGSGrid'].map(n => fn(score, n)).join('\n'), ctx);
  return { ctx, element };
}
function assertGrid(html) {
  assert.ok(html.indexOf('หนึ่ง') < html.indexOf('สอง'));
  assert.ok(html.indexOf('สอง') < html.indexOf('สิบ'));
  assert.match(html, />2<\/td>/); assert.match(html, />10<\/td>/); assert.match(html, />1<\/td>/);
}
test('ตารางคะแนน/ประเมิน/ส่งออก SGS ทุกโหมดใช้เลขที่เดียวกันและไม่เปลี่ยนรหัส', () => {
  const { ctx, element } = grids();
  ctx.renderAllInOneTable(ctx.currentScoreStudents, ctx.currentScoreConfig, { '999_midterm': '17' }, {});
  assertGrid(element('scoreTableBody').innerHTML);
  assert.match(element('scoreTableBody').innerHTML, /midterm-std-999[^>]+value="17"/);
  ctx.renderEvalTable(roster(), {}); assertGrid(element('evalTableBody').innerHTML);
  for (const mode of ['normal', 'qual', 'magic']) { ctx.renderSGSGrid(mode); assertGrid(element('sgsPreviewBody').innerHTML); }
});

test('payload ปพ.5 ใช้เลขที่จริง เรียงตรงตาราง และคะแนนยังผูกกับรหัสดิบ', () => {
  const { ctx, element } = grids();
  let payload, handler;
  const chain = {
    withSuccessHandler(fn) { handler = fn; return this; }, withFailureHandler() { return this; },
    getPrintConfigData() { handler({ sys: {}, hr: [] }); }, generatePP5Template(value) { payload = value; },
  };
  ctx.google = { script: { run: chain } }; ctx.getSessionUser = () => ({ currentTerm: '1', currentYear: '2569' });
  ctx.showToast = () => {}; ctx.currentAttDetails = {}; ctx.currentAttSessions = [];
  ctx.document.querySelector = selector => selector.includes('midterm-std-999') ? { value: '17' } : null;
  const start = score.indexOf('window.preparePrintPorPor5 = function(event)');
  const end = score.indexOf('// 🌟 ฟังก์ชันสำหรับปิดแผ่นใส', start);
  vm.runInContext(score.slice(start, end), ctx);
  ctx.window.preparePrintPorPor5();
  assert.deepEqual(plain(payload.students.map(s => [s.no, s.id, s.mid])), [['1', '00002', ''], ['2', '00999', '17'], ['10', '00001', '']]);
});
