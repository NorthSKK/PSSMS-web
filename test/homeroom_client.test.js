'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/Scripts_Admin.html'), 'utf8');
const saveFunction = source.slice(source.indexOf('function ttoSaveAllHomeroom()'), source.indexOf('\nfunction ttoCheckDuplicates()'));
const escapeFunction = source.split('\n').find(line => line.startsWith('function _ttoEsc('));

function row(level, room, teachers = ['teacher1', 'teacher2']) {
  const fields = {
    '.hr-level': { value: level }, '.hr-room': { value: room },
    '.hr-teacher-1': { value: teachers[0] || '' }, '.hr-teacher-2': { value: teachers[1] || '' },
    '.hr-advisory-loc': { value: '' }, '.hr-buddhist-loc': { value: '' },
  };
  return { fields, querySelector: selector => fields[selector] || null };
}

function setup(rows) {
  const calls = [], alerts = [];
  const button = { disabled: false, innerHTML: 'บันทึก' };
  const tbody = { querySelectorAll: () => rows };
  let success, failure, reloads = 0;
  const chain = {
    withSuccessHandler(fn) { success = fn; return this; },
    withFailureHandler(fn) { failure = fn; return this; },
    setAllHomeroomTeachers(...args) { calls.push(JSON.parse(JSON.stringify(args))); },
  };
  const context = {
    document: { getElementById: id => id === 'ttoHomeroomBody' ? tbody : button },
    window: { _hrActiveTerm: '2', _hrActiveYear: '2569' },
    google: { script: { run: chain } }, showAlert: message => alerts.push(message),
    ttoLoadHomeroom: () => reloads++, _staffHomeroomMap: {},
  };
  vm.createContext(context);
  vm.runInContext(escapeFunction + '\n' + saveFunction, context);
  return { calls, alerts, button, save: () => context.ttoSaveAllHomeroom(),
    success: res => success(res), failure: err => failure(err), reloads: () => reloads };
}

test('ส่งห้องเรียนที่ต่างกันครบ 6 ห้อง และโหลดใหม่เมื่อบันทึกสำเร็จเท่านั้น', () => {
  const ui = setup(Array.from({ length: 6 }, (_, i) => row('ม.' + (i + 1), '1')));
  ui.save();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0][0].length, 6);
  assert.equal(new Set(ui.calls[0][0].map(a => a.level + '/' + a.room)).size, 6);
  assert.deepEqual(ui.calls[0].slice(1), ['2', '2569']);
  assert.equal(ui.reloads(), 0);
  assert.equal(ui.button.disabled, true);
  ui.success({ status: 'success', message: 'บันทึก 6 ห้องเรียนสำเร็จ' });
  assert.equal(ui.reloads(), 1);
  assert.equal(ui.button.disabled, false);
});

test('เลือกครูครบ 6 แถวแต่ห้องเรียนซ้ำต้องแจ้งก่อนส่ง ไม่ปล่อยให้เหลือ 3 ห้อง', () => {
  const ui = setup(Array.from({ length: 6 }, (_, i) => row('ม.' + (i % 3 + 1), '1')));
  ui.save();
  assert.equal(ui.calls.length, 0);
  assert.match(ui.alerts[0], /ซ้ำ/);
  assert.match(ui.alerts[0], /ม.1\/1/);
  assert.equal(ui.button.disabled, false);
});

test('แถวหลังกรอกห้องเรียนไม่ครบต้องไม่ส่งเฉพาะแถวแรกไปบันทึก', () => {
  const rows = [row('ม.1', '1'), row('ม.2', '')];
  const ui = setup(rows);
  ui.save();
  assert.equal(ui.calls.length, 0);
  assert.match(ui.alerts[0], /2/);
  assert.equal(rows[1].fields['.hr-level'].value, 'ม.2');
});

test('ห้องเรียนที่ไม่เลือกครูต้องไม่ส่งไปลบข้อมูลเดิม', () => {
  const ui = setup([row('ม.1', '1', [])]);
  ui.save();
  assert.equal(ui.calls.length, 0);
  assert.match(ui.alerts[0], /ครูที่ปรึกษา/);
});

test('เซิร์ฟเวอร์ปฏิเสธหรือเชื่อมต่อไม่ได้ต้องเก็บรายการที่แก้ไว้ให้แก้ต่อ', () => {
  for (const fails of [false, true]) {
    const rows = [row('ม.1', '1')];
    const ui = setup(rows);
    ui.save();
    if (fails) ui.failure(new Error('บันทึกไม่สำเร็จ'));
    else ui.success({ status: 'error', message: 'บันทึกไม่สำเร็จ' });
    assert.equal(ui.reloads(), 0);
    assert.equal(ui.button.disabled, false);
    assert.equal(rows[0].fields['.hr-teacher-1'].value, 'teacher1');
  }
});
