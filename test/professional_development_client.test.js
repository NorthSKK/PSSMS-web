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
  assert.match(script, /รอแนบหลังบันทึก '\+files\.length\+' ไฟล์/);
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
  assert.match(script, /if\(!hasDraftHours&&appliedTimes\.startsAt&&appliedTimes\.endsAt\)\{[^}]*_pdRecalculateHours\(\)/);
});

test('คำเตือนวันที่ปีปนกันจาก AI แสดงเด่นในกรอบร่างก่อนนำไปใช้', () => {
  const script = src('Scripts_Professional_Development.html');
  const box = { innerHTML: '' };
  const context = {
    document: {
      getElementById: (id) => id === 'pdScanDraft' ? box : null,
      createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }),
    },
  };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context.PD_STATE.draft = { startsAt: '2025-09-15T08:30', endsAt: null };
  context.PD_STATE.scanWarnings = ['วันเวลาสิ้นสุดก่อนวันเวลาเริ่ม ระบบจึงเว้นไว้'];
  context._pdRenderDraft();

  assert.match(box.innerHTML, /alert-warning/);
  assert.match(box.innerHTML, /วันเวลาสิ้นสุดก่อนวันเวลาเริ่ม/);
  assert.match(box.innerHTML, /ตรวจสอบวันและเวลา/);
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

test('ร่าง AI ที่แก้ปี พ.ศ. แล้วไม่ล้างเวลาที่ผู้ใช้กรอกเมื่อปลายทางไม่ปลอดภัย และไม่คำนวณชั่วโมงข้ามปี', () => {
  const script = src('Scripts_Professional_Development.html');
  const elements = {
    pdTitle: { value: '' }, pdType: { value: 'อบรม' },
    pdStartsAt: { value: '2026-09-15T08:30' },
    pdEndsAt: { value: '2026-09-15T16:00' },
    pdLocation: { value: '' }, pdOrganizer: { value: '' }, pdObjective: { value: '' }, pdDetails: { value: '' },
    pdHours: { value: '6' }, pdExpenses: { value: '' }, pdStatus: { value: 'ร่าง' },
    pdHoursHelp: { textContent: '' },
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdRenderDraft = () => {};
  context._pdToast = () => {};
  context.PD_STATE.draft = { startsAt: '2025-09-15T08:30', endsAt: null, hours: null };
  context.PD_STATE.scanWarnings = ['วันเวลาสิ้นสุดที่ AI อ่านได้ไม่ถูกต้อง กรุณาตรวจและกรอกใหม่'];

  context.pdApplyDraft('overwrite');

  assert.equal(elements.pdStartsAt.value, '2025-09-15T08:30');
  assert.equal(elements.pdEndsAt.value, '2026-09-15T16:00', 'ค่าว่างจาก AI ต้องไม่ล้างค่าที่ผู้ใช้กรอก');
  assert.equal(elements.pdHours.value, '6', 'ห้ามคำนวณชั่วโมงจากวันที่คนละชุดจนได้ค่ามหาศาล');
});

test('ถ้าผล AI เก่าหรือ proxy ส่งปี พ.ศ. ดิบ หน้าเว็บไม่ใส่ปีนั้นใน datetime-local', () => {
  const script = src('Scripts_Professional_Development.html');
  const elements = {
    pdStartsAt: { value: '2026-09-15T08:30' }, pdEndsAt: { value: '' },
    pdHours: { value: '6' }, pdHoursHelp: { textContent: '' },
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdDraftMap = () => ({ startsAt: ['pdStartsAt', 'วันเวลาเริ่ม'], endsAt: ['pdEndsAt', 'วันเวลาสิ้นสุด'] });
  context._pdRenderDraft = () => {};
  context._pdToast = () => {};
  context.PD_STATE.draft = { startsAt: '2568-09-15T08:30', endsAt: '2025-09-15T16:00' };
  context.pdApplyDraft('overwrite');
  assert.equal(elements.pdStartsAt.value, '2026-09-15T08:30');
  assert.equal(elements.pdEndsAt.value, '2025-09-15T16:00');
  assert.equal(elements.pdHours.value, '6');
});

test('บันทึกฟอร์มปีปนกันไม่ได้และบอกให้ตรวจปี ค.ศ. กับเวลาสิ้นสุดอย่างชัดเจน', () => {
  const script = src('Scripts_Professional_Development.html');
  const input = (value) => {
    const flags = new Set();
    return { value, classList: { add: (v) => flags.add(v), remove: (v) => flags.delete(v), contains: (v) => flags.has(v) }, checkValidity: () => true, focus: () => {} };
  };
  const elements = {
    pdTitle: input('อบรม'), pdStartsAt: input('2021-09-15T08:30'),
    pdEndsAt: input('2026-09-15T16:00'), pdHours: input('6'), pdExpenses: input(''),
    pdFormError: input(''),
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  assert.equal(context._pdValidate(), false);
  assert.match(elements.pdFormError.textContent, /ปี ค\.ศ\./);
  assert.match(elements.pdFormError.textContent, /สิ้นสุด/);
});

test('เวลาในฟอร์มคนละหลายปีไม่แทนชั่วโมงที่ผู้ใช้กรอกด้วยค่าสูงผิดปกติ', () => {
  const script = src('Scripts_Professional_Development.html');
  const elements = {
    pdStartsAt: { value: '2021-09-15T08:30' }, pdEndsAt: { value: '2026-09-15T16:00' },
    pdHours: { value: '6' }, pdHoursHelp: { textContent: '' },
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  assert.equal(context._pdRecalculateHours(), false);
  assert.equal(elements.pdHours.value, '6');
});

test('การ์ดกิจกรรมมีชื่อ accessible และสรุปจำนวนผู้ร่วมกับไฟล์แนบ', () => {
  const script = src('Scripts_Professional_Development.html');
  assert.match(script, /aria-label="ส่งออก/);
  assert.match(script, /aria-label="แก้ไข/);
  assert.match(script, /aria-label="ย้าย/);
  assert.match(script, /participantCount/);
  assert.match(script, /attachmentCount/);
});

test('หน้าโทรศัพท์ถ่ายรูปหรือเลือกไฟล์แล้วสแกนอัตโนมัติ ยังไม่บันทึกกิจกรรมทันที', async () => {
  const page = src('Page_Professional_Development.html');
  const script = src('Scripts_Professional_Development.html');
  assert.match(page, /id="pdScanCamera"[^>]*accept="image\/jpeg,image\/png,image\/webp"[^>]*capture="environment"/);
  assert.match(page, /id="pdScanFile"[^>]*application\/pdf,image\/jpeg,image\/png,image\/webp/);
  assert.match(page, /ถ่ายรูปเอกสาร/);
  assert.match(page, /ส่งให้ AI อ่านอัตโนมัติ/);
  assert.match(page, /รอแนบเป็นหลักฐานเมื่อบันทึก/);
  assert.match(script, /onchange=_pdPickedScanFile/);

  const classes = () => ({ add() {}, remove() {}, contains() { return false; } });
  const ids = ['pdTitle', 'pdType', 'pdStartsAt', 'pdEndsAt', 'pdLocation', 'pdOrganizer',
    'pdObjective', 'pdDetails', 'pdHours', 'pdExpenses', 'pdStatus', 'pdId',
    'pdScanStatus', 'pdScanBtn', 'pdScanCamera', 'pdScanFile', 'pdHoursHelp'];
  const elements = Object.fromEntries(ids.map((id) => [id, { value: '', innerHTML: '', classList: classes() }]));
  elements.pdType.value = 'อบรม'; elements.pdStatus.value = 'ร่าง';
  const image = { name: 'camera.jpg', type: 'image/jpeg', size: 2000, lastModified: 12 };
  const calls = [];
  const context = {
    document: {
      getElementById: (id) => elements[id],
      createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }),
    },
    localStorage: { getItem: () => 'test-jwt' },
    FormData: class { append(name, file) { calls.push([name, file]); } },
    fetch: (url) => {
      calls.push(url);
      return Promise.resolve({ json: () => Promise.resolve({ status: 'success',
        draft: { title: 'อบรมวิทย์', startsAt: '2025-09-15T08:30', endsAt: null,
          location: 'ห้องประชุม' }, warnings: ['โปรดตรวจเวลาสิ้นสุด'] }) });
    },
  };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdRenderDraft = () => {};
  context._pdRenderSelectedFiles = () => {};
  context._pdToast = () => {};
  context.PD_STATE.optionsLoaded = true;
  context.PD_STATE.options.uploadEnabled = true;
  elements.pdScanCamera.files = [image];
  context._pdPickedScanFile({ target: elements.pdScanCamera });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls[0][1], image);
  assert.equal(calls[1], '/api/media/professional-development/scan');
  assert.equal(elements.pdTitle.value, 'อบรมวิทย์');
  assert.equal(elements.pdStartsAt.value, '2025-09-15T08:30');
  assert.equal(elements.pdEndsAt.value, '', 'AI ส่งวันที่ไม่ปลอดภัยต้องไม่เติม');
  assert.equal(context.PD_STATE.pendingFiles.length, 1, 'ภาพรอแนบหลังผู้ใช้กดบันทึก');
  assert.equal(elements.pdId.value, '', 'การสแกนไม่กดบันทึกเอง');
  assert.match(elements.pdScanStatus.innerHTML, /เติมข้อมูล/);
  elements.pdTitle.value = 'ครูแก้ชื่อเอง';
  context.pdUndoDraft();
  assert.equal(elements.pdTitle.value, 'ครูแก้ชื่อเอง', 'ย้อนกลับต้องไม่ล้างข้อมูลที่ครูแก้หลังสแกน');
  assert.equal(elements.pdLocation.value, '', 'ย้อนกลับได้เฉพาะค่าที่ AI เติม');
});

test('สแกนเอกสารในกิจกรรมเดิมเติมเฉพาะช่องว่าง ไม่เขียนทับข้อมูลที่ครูแก้ระหว่างรอผล', () => {
  const script = src('Scripts_Professional_Development.html');
  const elements = {
    pdTitle: { value: 'ชื่อกิจกรรมเดิม' }, pdLocation: { value: 'ครูเพิ่งแก้สถานที่' },
    pdOrganizer: { value: '' }, pdHoursHelp: { textContent: '' },
  };
  const context = { document: { getElementById: (id) => elements[id] } };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdDraftMap = () => ({ title: ['pdTitle', 'ชื่อ'], location: ['pdLocation', 'สถานที่'], organizer: ['pdOrganizer', 'ผู้จัด'] });
  context._pdRenderDraft = () => {}; context._pdToast = () => {};
  context.PD_STATE.draft = { title: 'ชื่อ AI', location: 'สถานที่ AI', organizer: 'หน่วยงาน AI' };
  const count = context.pdApplyDraft('empty', true, { title: 'ชื่อกิจกรรมเดิม', location: '', organizer: '' });
  assert.equal(count, 1);
  assert.equal(elements.pdTitle.value, 'ชื่อกิจกรรมเดิม');
  assert.equal(elements.pdLocation.value, 'ครูเพิ่งแก้สถานที่');
  assert.equal(elements.pdOrganizer.value, 'หน่วยงาน AI');
});

test('ภาพที่ AI อ่านรายละเอียดไม่ได้ไม่เติมฟอร์มหรือแนบเป็นหลักฐานเอง และให้ลองใหม่', async () => {
  const script = src('Scripts_Professional_Development.html');
  const classes = () => ({ add() {}, remove() {}, contains() { return false; } });
  const elements = Object.fromEntries(['pdScanStatus','pdScanBtn','pdScanCamera','pdScanFile',
    'pdTitle','pdType','pdStartsAt','pdEndsAt','pdLocation','pdOrganizer','pdObjective',
    'pdDetails','pdHours','pdExpenses','pdStatus'].map((id) => [id,
    { value: '', innerHTML: '', classList: classes() }]));
  const context = {
    document: { getElementById: (id) => elements[id],
      createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }) },
    localStorage: { getItem: () => 'test-jwt' },
    FormData: class { append() {} },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'success', draft: { type: 'อบรม', status: 'ร่าง' }, warnings: [] }) }),
  };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  context._pdRenderDraft = () => {};
  context.PD_STATE.scanFile = { name: 'blur.jpg', type: 'image/jpeg', size: 1000 };
  context._pdScan();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(elements.pdScanStatus.innerHTML, /ลองถ่ายใหม่/);
  assert.equal(context.PD_STATE.pendingFiles.length, 0);
  assert.equal(context.PD_STATE.scanAppliedOnce, false);
});

test('ภาพสแกนเป็นหลักฐานรอแนบเฉพาะเมื่อเปิดอัปโหลดและมีที่ว่าง ลบจากคิวได้', () => {
  const script = src('Scripts_Professional_Development.html');
  const box = { innerHTML: '' };
  const context = {
    document: {
      getElementById: (id) => id === 'pdSelectedFiles' ? box : null,
      createElement: () => ({ textContent: '', get innerHTML() { return this.textContent; } }),
    },
  };
  vm.runInNewContext(script.replace(/^\s*<script>|<\/script>\s*$/g, ''), context);
  const image = { name: 'proof.png', type: 'image/png', size: 1234, lastModified: 4 };
  context.PD_STATE.scannedEvidence = image;
  context.PD_STATE.optionsLoaded = true;
  context.PD_STATE.options.uploadEnabled = false;
  context._pdMaybeQueueScanEvidence();
  assert.equal(context.PD_STATE.pendingFiles.length, 0);
  context.PD_STATE.options.uploadEnabled = true;
  context.PD_STATE.options.maxFilesPerActivity = 1;
  context.PD_STATE.attachments = [{ id: 9 }];
  context._pdMaybeQueueScanEvidence();
  assert.equal(context.PD_STATE.pendingFiles.length, 0);
  context.PD_STATE.attachments = [];
  context._pdMaybeQueueScanEvidence();
  context._pdMaybeQueueScanEvidence();
  assert.equal(context.PD_STATE.pendingFiles.length, 1, 'ภาพเดียวไม่เข้าคิวซ้ำ');
  assert.match(box.innerHTML, /proof\.png/);
  assert.match(box.innerHTML, /เอาออก/);
  context.pdRemovePendingFile(0);
  assert.equal(context.PD_STATE.pendingFiles.length, 0);
});
