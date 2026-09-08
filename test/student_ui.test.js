/**
 * หน้าผู้เรียนโหลดผ่าน innerHTML จึงต้องล็อกชื่อหน้า ตัวเริ่มหน้า และ script ไว้ด้วยกัน
 * มิฉะนั้นเมนูจะพาไปหน้าขาวหรือปุ่มรีเฟรชกลายเป็น ReferenceError หลัง deploy.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

test('เมนูนักเรียนมีเฉพาะหน้าข้อมูลของตน และโหลด script นักเรียน', () => {
  const core = src('Scripts_Core.html');
  const studentBlock = core.slice(core.indexOf("if (role === 'STUDENT')"), core.indexOf("  } else {", core.indexOf("if (role === 'STUDENT')")));
  for (const page of [
    'Page_Dashboard_Student', 'Page_Student_Academic', 'Page_Student_Timetable',
    'Page_Student_Clubs', 'Page_Teaching_Media', 'Page_Student_Savings', 'Page_Student_Calendar'
  ]) assert.match(studentBlock, new RegExp(`loadPage\\('${page}'\\)`), `เมนูนักเรียนต้องมี ${page}`);
  assert.doesNotMatch(studentBlock, /Page_Savings|Page_Calendar/, 'นักเรียนต้องไม่ถูกพาไปหน้าจัดการเงินออมหรือปฏิทินแก้ไขได้');
  assert.match(index, /\/api\/assets\/script\/Scripts_Student/, 'ต้องโหลด script สำหรับหน้าผู้เรียน');
});

test('หน้ารายละเอียดนักเรียนมีหน้าและตัวเริ่มหน้าครบ', () => {
  const core = src('Scripts_Core.html');
  const script = src('Scripts_Student.html');
  for (const [page, init] of [
    ['Page_Student_Academic', 'initStudentAcademicPage'],
    ['Page_Student_Timetable', 'initStudentTimetablePage'],
    ['Page_Student_Savings', 'initStudentSavingsPage'],
    ['Page_Student_Calendar', 'initStudentCalendarPage'],
  ]) {
    assert.ok(fs.existsSync(path.join(__dirname, '../src', `${page}.html.html`)), `${page} ต้องมีไฟล์`);
    assert.match(core, new RegExp(`${page}'\\)\\s*${init}\\(\\)`), `${page} ต้องเริ่ม ${init}`);
    assert.match(script, new RegExp(`function\\s+${init}\\s*\\(`), `${init} ต้องประกาศใน Scripts_Student`);
  }
});

test('แดชบอร์ดนักเรียนใช้ข้อมูลจริงจาก bundle และไม่ระบุว่าเป็นข้อมูลสะสม', () => {
  const core = src('Scripts_Core.html');
  const page = src('Page_Dashboard_Student.html.html');
  for (const field of ['profile', 'savings', 'club', 'upcomingEvents']) {
    assert.match(core, new RegExp(`bundle\\.${field}`), `ต้องอ่าน ${field} จาก dashboard bundle`);
  }
  assert.match(page, /การมาเรียนเทอมนี้/);
  assert.match(page, /เกรดเฉลี่ยเทอมนี้/);
  assert.doesNotMatch(page, /เกรดเฉลี่ยสะสม/);
});
