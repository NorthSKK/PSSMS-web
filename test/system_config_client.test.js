'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
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
const config = () => ({ term: '2', year: '2569', termStart: '2026-10-26', termEnd: '2027-04-01',
  termHistory: { '1_2569': { start: '2026-05-18', end: '2026-10-09' },
    '2_2569': { start: '2026-10-26', end: '2027-04-01' } } });

function settings() {
  const elements = Object.fromEntries(['inputTerm', 'inputYear', 'inputStartDate', 'inputEndDate',
    'currentTermDisplay', 'currentRangeDisplay'].map(id => [id, {
    value: '', innerText: '', addEventListener() {}, removeEventListener() {},
  }]));
  let callback;
  const chain = { withSuccessHandler(fn) { callback = fn; return this; }, getSystemConfig() {} };
  const pending = [];
  const ctx = { document: { getElementById: id => elements[id] || null }, systemConfigHistory: {},
    safeRun: () => chain, loadLicenseInfo() {}, showLoader() {}, showToast() {},
    formatThaiDate: s => s, setTimeout: fn => pending.push(fn),
    applyThaiDatePickers() {
      for (const id of ['inputStartDate', 'inputEndDate']) {
        const el = elements[id];
        if (el._flatpickr) continue;
        const altInput = { value: el.value };
        el._flatpickr = { altInput, setDate(value, trigger) {
          assert.equal(trigger, false, 'โปรแกรมไม่ควรยิง onChange ระหว่างโหลดค่า');
          el.value = value || ''; altInput.value = value || '';
        } };
      }
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fn(read('Scripts_Core.html'), 'setDateValue') + '\n' +
    ['formatDateForInput', 'loadCurrentConfig', 'handleTermYearChange'].map(n => fn(read('Scripts_Admin.html'), n)).join('\n'), ctx);
  return { ctx, elements, respond: value => callback(value), flush: () => pending.splice(0).forEach(fn => fn()) };
}
function dates(state, start, end) {
  for (const [id, expected] of [['inputStartDate', start], ['inputEndDate', end]]) {
    assert.equal(state.elements[id].value, expected, id + ' ค่าที่ส่งบันทึก');
    assert.equal(state.elements[id]._flatpickr.altInput.value, expected, id + ' ช่องที่ครูเห็น');
  }
}

for (const pickerFirst of [true, false]) {
  test('เปิดตั้งค่าแล้ววันที่แสดงตรงค่าบันทึก แม้ picker ' + (pickerFirst ? 'พร้อมก่อน API' : 'พร้อมหลัง API'), () => {
    const s = settings(); s.ctx.loadCurrentConfig();
    if (pickerFirst) s.ctx.applyThaiDatePickers();
    s.respond(config()); s.flush(); dates(s, '2026-10-26', '2027-04-01');
  });
}
test('โหลดซ้ำหลังบันทึกอัปเดตทั้งวันที่จริงกับช่องแสดง และล้างค่าที่ไม่มีแล้ว', () => {
  const s = settings(); s.ctx.applyThaiDatePickers(); s.ctx.loadCurrentConfig(); s.respond(config());
  s.ctx.loadCurrentConfig(); s.respond({ ...config(), termStart: '2026-11-02', termEnd: '2027-03-31' });
  dates(s, '2026-11-02', '2027-03-31');
  s.ctx.loadCurrentConfig(); s.respond({ ...config(), termStart: '', termEnd: '' }); dates(s, '', '');
});
test('สลับเทอมเดิมกู้วันที่จากประวัติ เทอมใหม่ล้างทั้งสองช่อง และกลับเทอมเดิมได้', () => {
  const s = settings(); s.ctx.applyThaiDatePickers(); s.ctx.loadCurrentConfig(); s.respond(config());
  s.elements.inputTerm.value = '1'; s.ctx.handleTermYearChange(); dates(s, '2026-05-18', '2026-10-09');
  s.elements.inputYear.value = '2570'; s.ctx.handleTermYearChange(); dates(s, '', '');
  s.elements.inputYear.value = '2569'; s.elements.inputTerm.value = '2'; s.ctx.handleTermYearChange();
  dates(s, '2026-10-26', '2027-04-01');
});
