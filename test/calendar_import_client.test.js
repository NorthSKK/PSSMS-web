const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CalendarImport = require('../public/calendarImport');

function preview(csv) {
  const elements = {};
  function element() {
    return { children: [], classList: { add() {}, remove() {} }, style: {},
      appendChild(child) { this.children.push(child); }, innerHTML: '', textContent: '' };
  }
  let payload;
  const context = { CalendarImport, window: {}, document: {
    getElementById(id) { return elements[id] || (elements[id] = element()); }, createElement: element
  }, FileReader: class {
    readAsText() { this.onload({ target: { result: csv } }); }
  }, safeRun() { return { withSuccessHandler() { return { importCalendarCSV(rows) { payload = rows; } }; } }; } };
  vm.runInNewContext(fs.readFileSync('src/Scripts_Calendar.html', 'utf8').replace(/^<script>|<\/script>\s*$/g, ''), context);
  context.window.previewCalendarCSV({ files: [{}] });
  context.window.confirmCalendarImport();
  return { elements, rows: JSON.parse(JSON.stringify(payload)) };
}

test('calendar preview parses quoted CSV safely and sends merged inclusive dates', () => {
  const { elements, rows } = preview('\uFEFFวันที่,กิจกรรม,รายละเอียด,สี\r\n2026-10-02,"กิจกรรม, ทดสอบ","ผู้รับผิดชอบ ""ก""",#0d6efd\r\n2026-10-01,"กิจกรรม, ทดสอบ","ผู้รับผิดชอบ ""ก""",#0d6efd\r\n2026-10-03,<img src=x onerror=alert(1)>,,#dc3545');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].start, '2026-10-01');
  assert.equal(rows[0].end, '2026-10-02');
  assert.equal(rows[0].description, 'ผู้รับผิดชอบ "ก"');
  assert.equal(rows[1].description, '');
  assert.equal(elements.calImportCount.textContent, '3 แถว → 2 รายการ');
  const cells = elements.calPreviewBody.children;
  assert.equal(cells[0].children[0].textContent, '2026-10-01 ถึง 2026-10-02');
  assert.equal(cells[1].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(cells[1].children[1].innerHTML, '');
});

test('served page loads calendar helper before calendar script', () => {
  const page = fs.readFileSync('public/index.html', 'utf8');
  assert.ok(page.indexOf('/calendarImport.js') >= 0);
  assert.ok(page.indexOf('/calendarImport.js') < page.indexOf('/api/assets/script/Scripts_Calendar'));
});

test('preview groups only matching details and effective colors across consecutive days', () => {
  const { rows } = preview('date,title,description,color\n2026-10-03,ประชุม,"ฝ่าย ก\nฝ่าย ข",#ffc107\n2026-10-01,ประชุม,"ฝ่าย ก\nฝ่าย ข",\n2026-10-02,ประชุม,"ฝ่าย ก\nฝ่าย ข",#ffc107\n2026-10-05,ประชุม,"ฝ่าย ก\nฝ่าย ข",#ffc107\n2026-10-04,ประชุม,ฝ่าย ค,#ffc107\n2026-10-04,ประชุม,"ฝ่าย ก\nฝ่าย ข",#dc3545\n2026-10-04,อบรม,"ฝ่าย ก\nฝ่าย ข",#ffc107');
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { title: 'ประชุม', start: '2026-10-01', end: '2026-10-03', description: 'ฝ่าย ก\nฝ่าย ข', color: '#ffc107' });
  assert.equal(rows[4].start, '2026-10-05');
  assert.equal(rows[4].end, '2026-10-05');
});
