'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');

test('เมนูพัฒนาวิชาชีพใช้ feature flag สด และหน้าล่าสุดต้องถอยกลับเมื่อโรงเรียนปิด', () => {
  const core = src('Scripts_Core.html');

  assert.match(core, /function _loadAppSystemConfig\(/,
    'ต้องอ่าน config จาก server ก่อน render เมนู ไม่ใช้ค่าค้างจาก localStorage');
  assert.match(core, /_loadAppSystemConfig\([\s\S]{0,900}getSystemConfig\(\)/);
  assert.match(core, /professionalDevelopmentEnabled && !isManagement/,
    'เมนูครูต้องขึ้นเฉพาะโรงเรียนที่เปิด feature');
  assert.match(core, /function _resolveInitialAppPage\(/);
  assert.match(core, /lastPage === 'Page_Professional_Development'[\s\S]{0,180}!professionalDevelopmentEnabled/,
    'หน้าล่าสุดของ feature ที่ปิดต้องไม่ถูกเปิดจาก cache');
  assert.match(core, /function _guardFeaturePage\(/,
    'การเรียก loadPage ตรงต้องมี client guard และถอยกลับหน้า dashboard');
  assert.match(core, /_setupIdlePrefetch\(role, professionalDevelopmentEnabled\)/,
    'โรงเรียนที่ปิดต้องไม่ prefetch หน้าที่เรียกไม่ได้');
});

test('หน้าพัฒนาวิชาชีพมีสถานะโหลด ผิดพลาด ลองใหม่ และจำนวนผลลัพธ์', () => {
  const page = src('Page_Professional_Development.html');
  const script = src('Scripts_Professional_Development.html');
  assert.match(page, /id="pdResultSummary"/);
  assert.match(script, /pd-loading-card/);
  assert.match(script, /โหลดข้อมูลไม่สำเร็จ/);
  assert.match(script, /onclick="_pdLoad\(\)"/);
  assert.match(script, /pdResultSummary/);
});

test('ฟอร์มกันบันทึกซ้ำ ตรวจเวลา และบันทึกต่อด้วยคิวอัปโหลด', () => {
  const page = src('Page_Professional_Development.html');
  const script = src('Scripts_Professional_Development.html');
  assert.match(page, /id="pdSaveProgress"/);
  assert.match(page, /เวลาประเทศไทย/);
  assert.match(script, /PD_STATE\.saving/);
  assert.match(script, /วันและเวลาสิ้นสุดต้องไม่ก่อนวันเริ่ม/);
  assert.match(script, /_pdUploadQueue/);
  assert.match(script, /แนบไฟล์บางรายการไม่สำเร็จ/);
  assert.match(script, /hours\.checkValidity\(\)/);
  assert.match(script, /expenses\.checkValidity\(\)/);
  assert.match(script, /เก็บเฉพาะไฟล์เหล่านี้ไว้แล้ว/);
});

test('คิวแนบหลายไฟล์ทำต่อเมื่อบางไฟล์พลาด และเก็บไฟล์พร้อมสาเหตุไว้ลองซ้ำ', async () => {
  const script = src('Scripts_Professional_Development.html');
  const uploaded = [];
  const context = {
    document: { getElementById: () => null },
    Promise,
  };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdProgress = () => {};
  context._pdUploadOne = (_id, file) => {
    uploaded.push(file.name);
    return file.name === 'เสีย.pdf'
      ? Promise.reject(new Error('ชนิดไฟล์ไม่ตรงกับเนื้อหา'))
      : Promise.resolve({ status: 'success' });
  };
  const files = [{ name: 'หนึ่ง.pdf' }, { name: 'เสีย.pdf' }, { name: 'สอง.pdf' }];
  const failed = await new Promise((resolve) => context._pdUploadQueue(7, files, resolve));

  assert.deepEqual(uploaded, ['หนึ่ง.pdf', 'เสีย.pdf', 'สอง.pdf']);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].file, files[1]);
  assert.equal(failed[0].name, 'เสีย.pdf');
  assert.equal(failed[0].reason, 'ชนิดไฟล์ไม่ตรงกับเนื้อหา');
});

test('ฟอร์มแสดงไฟล์ที่เลือก ใช้สถานะอัปโหลดจาก backend และบันทึกร่างพร้อมแนบไฟล์ได้', () => {
  const page = src('Page_Professional_Development.html');
  const script = src('Scripts_Professional_Development.html');

  assert.match(page, /id="pdSelectedFiles"/);
  assert.match(page, /id="pdFileHelp"/);
  assert.match(page, /id="pdDraftSaveBtn"/);
  assert.match(page, />บันทึกร่าง</);
  assert.match(script, /getProfessionalDevelopmentOptions/);
  assert.match(script, /function _pdRenderSelectedFiles/);
  assert.match(script, /เลือกแล้ว '\+files\.length\+' ไฟล์/);
  assert.match(script, /pendingFiles=failed\.map/);
  assert.match(script, /x\.name\+' — '\+x\.reason/);
  assert.match(script, /_pdSave\('ร่าง'\)/);
});

test('คำนวณชั่วโมงจากเวลาโรงเรียนแบบไม่ผูก timezone และยังแก้เวลาพักได้', () => {
  const page = src('Page_Professional_Development.html');
  const script = src('Scripts_Professional_Development.html');
  assert.match(page, /id="pdHoursHelp"/);
  assert.match(page, /step="0\.01"/);
  assert.match(page, /หักเวลาพัก/);
  assert.match(script, /function _pdWallTimeMinutes/);
  assert.match(script, /Date\.UTC/);
  assert.match(script, /function _pdRecalculateHours/);
  assert.match(script, /\.toFixed\(2\)/);
  assert.match(script, /pdStartsAt'\,'pdEndsAt/);
  assert.match(script, /onchange=_pdRecalculateHours/);

  const elements = {
    pdStartsAt: { value: '2026-09-14T08:30' },
    pdEndsAt: { value: '2026-09-14T16:00' },
    pdHours: { value: '' },
    pdHoursHelp: { textContent: '' },
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  assert.equal(context._pdRecalculateHours(), true);
  assert.equal(elements.pdHours.value, '7.5');
  assert.match(elements.pdHoursHelp.textContent, /หักเวลาพัก/);
  assert.equal(context._pdWallTimeMinutes('2026-09-15T01:15') - context._pdWallTimeMinutes('2026-09-14T23:45'), 90);
  elements.pdEndsAt.value = '2026-09-14T09:50';
  context._pdRecalculateHours();
  assert.equal(elements.pdHours.value, '1.33');
});

test('เปิดข้อมูลเดิมไม่เขียนทับชั่วโมง และร่าง AI คำนวณเมื่อไม่มีชั่วโมงมาให้', () => {
  const script = src('Scripts_Professional_Development.html');
  assert.match(script, /pdHours'\,'hours/);
  assert.match(script, /_pdSetHoursHint\(false\)/);
  assert.match(script, /hasDraftHours/);
  assert.match(script, /if\(!hasDraftHours&&timeChanged\)\{[^}]*_pdRecalculateHours\(\)/);
});

test('ผลค้นหาว่างมีทางล้างตัวกรองและ fallback ยืนยันก่อนลบ', () => {
  const script = src('Scripts_Professional_Development.html');
  assert.match(script, /function _pdClearFilters/);
  assert.match(script, /ล้างตัวกรอง/);
  assert.match(script, /else if\(confirm\('ย้ายกิจกรรมนี้ไปถังขยะ/);
});

test('ร่าง AI แสดงรายช่อง เลือกเติมช่องว่างหรือเขียนทับ และย้อนกลับได้', () => {
  const script = src('Scripts_Professional_Development.html');
  assert.match(script, /pdApplyDraft\(\\?'empty\\?'\)/);
  assert.match(script, /pdApplyDraft\(\\?'overwrite\\?'\)/);
  assert.match(script, /pdUndoDraft/);
  assert.match(script, /PD_STATE\.draftUndo/);
});

test('การ์ดกิจกรรมมีชื่อ accessible และสรุปจำนวนผู้ร่วมกับไฟล์แนบ', () => {
  const script = src('Scripts_Professional_Development.html');
  assert.match(script, /aria-label="ส่งออก/);
  assert.match(script, /aria-label="แก้ไข/);
  assert.match(script, /aria-label="ย้าย/);
  assert.match(script, /participantCount/);
  assert.match(script, /attachmentCount/);
});
