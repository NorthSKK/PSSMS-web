/**
 * กติกาฝั่งหน้าเว็บที่ไม่มีอะไรจับตอน build — ทั้งหมดนี้เคยหลุดจริงและเจอตอนกดใช้งานเอง
 *
 * ไฟล์ `src/*.html` ถูกเสิร์ฟดิบ ไม่มี module system ไม่มี linter ไม่มี type check
 * เทสชุดนี้จึงอ่านไฟล์ตรง ๆ แล้วล็อกกติกาที่พังแล้วเงียบไว้
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const scriptFiles = () => fs.readdirSync(SRC).filter((f) => f.startsWith('Scripts_') && f.endsWith('.html'));
const allScripts = () => scriptFiles().map(read).join('\n');

// ── setupPageContent เรียกฟังก์ชันที่ไม่มีอยู่จริง = เปิดหน้านั้นแล้ว throw ────
//
// เคยหลุด: `if(pageName === 'Page_Grade_Summary') initGradeSummaryPage();`
// ทั้งที่ไม่มีใครเขียน `initGradeSummaryPage` ไว้เลย เปิดหน้าแล้วได้ ReferenceError
// หน้าเปล่า และโค้ดที่เหลือใน setupPageContent ไม่ถูกรันต่อ
test('ทุกตัวเริ่มหน้าใน setupPageContent ต้องมีฟังก์ชันอยู่จริง', () => {
  const core = read('Scripts_Core.html');
  const body = core.slice(core.indexOf('function setupPageContent'));
  const scripts = allScripts();
  const called = [...body.matchAll(/pageName === '([A-Za-z_]+)'\)\s*\{?\s*([A-Za-z_$][\w$]*)\(/g)];
  assert.ok(called.length > 10, 'ต้องเจอรายการตัวเริ่มหน้า');
  for (const [, page, fn] of called) {
    // `if` มาจากบรรทัดที่ห่อด้วย `if (typeof initX === 'function')` — ตัวนั้นกันตัวเองอยู่แล้ว
    if (fn === 'loadPage' || fn === 'if') continue;
    assert.ok(
      new RegExp(`function\\s+${fn}\\s*\\(|window\\.${fn}\\s*=|${fn}\\s*=\\s*function`).test(scripts),
      `${page} เรียก ${fn}() แต่ไม่มีใครประกาศไว้ใน Scripts_*.html`
    );
  }
});

// ── ทุกหน้าที่ setupPageContent อ้างถึง ต้องมีไฟล์อยู่จริง ────────────────────
test('ทุกหน้าที่ setupPageContent อ้างถึง ต้องมีไฟล์ใน src/', () => {
  const core = read('Scripts_Core.html');
  const body = core.slice(core.indexOf('function setupPageContent'));
  const pages = new Set([...body.matchAll(/pageName === '([A-Za-z_]+)'/g)].map((m) => m[1]));
  for (const p of pages) {
    const exists = fs.existsSync(path.join(SRC, `${p}.html`)) || fs.existsSync(path.join(SRC, `${p}.html.html`));
    assert.ok(exists, `setupPageContent อ้างถึง ${p} แต่ไม่มีไฟล์หน้านั้น`);
  }
});

// ── เมนูต้องไม่พาไปหน้าที่ไม่มีอยู่ ──────────────────────────────────────────
test('ทุกหน้าในเมนูต้องมีไฟล์อยู่จริง', () => {
  const core = read('Scripts_Core.html');
  const pages = new Set([...core.matchAll(/loadPage\('([A-Za-z_]+)'\)/g)].map((m) => m[1]));
  for (const p of pages) {
    const exists = fs.existsSync(path.join(SRC, `${p}.html`)) || fs.existsSync(path.join(SRC, `${p}.html.html`));
    assert.ok(exists, `เมนู/โค้ดพาไป ${p} แต่ไม่มีไฟล์หน้านั้น`);
  }
});

// ── ผู้บริหารต้องเห็นเมนูจัดการโรงเรียนครบและแดชบอร์ดพาไปหน้าที่ตรงข้อมูล ─────
test('Executive ใช้เมนูบริหาร 4 ฝ่ายและลิงก์แดชบอร์ดได้เทียบเท่า Admin', () => {
  const core = read('Scripts_Core.html');
  const executivePage = read('Page_Dashboard_Executive.html.html');

  assert.match(core, /const isManagement = role === 'ADMIN' \|\| role === 'EXECUTIVE'/,
    'เมนูต้องจัด Admin และ Executive เป็นฝ่ายบริหารกลุ่มเดียวกัน');
  for (const page of [
    'Page_Admin_Settings', 'Page_Score_Entry', 'Page_Academic_Report',
    'Page_Admin_Timetable', 'Page_Admin_Curriculum', 'Page_Admin_Clubs',
    'Page_Teaching_Media', 'Page_Student_Watch', 'Page_Teacher_Progress',
    'Page_Budget', 'Page_Personnel', 'Page_Admin_Users', 'Page_Leave_Request',
    'Page_Leave_Admin', 'Page_Substitute_Admin', 'Page_General',
    'Page_Project_Documents', 'Page_Savings', 'Page_Calendar'
  ]) {
    assert.match(core, new RegExp(`loadPage\\('${page}'\\)`), `เมนูฝ่ายบริหารต้องมี ${page}`);
  }
  assert.match(core, /EXECUTIVE:\s*\[[^\]]*Page_Admin_Settings[\s\S]*Page_Calendar/,
    'หน้า Executive ที่เข้าถึงได้ต้องถูก prefetch เมื่อเครื่องว่าง');
  assert.match(executivePage, /onclick="loadPage\('Page_Personnel'\)"[\s\S]*?ดูข้อมูลบุคลากร/,
    'KPI บุคลากรต้องพาไปหน้าบุคลากร');
  assert.match(executivePage, /onclick="loadPage\('Page_Student_Watch'\)"[\s\S]*?ดูการติดตามเวลาเรียน/,
    'KPI เวลาเรียนต้องพาไปหน้าติดตามนักเรียน');
});

// ── ช่องคะแนนต้องผูก oninput ไม่ใช่ onkeyup ─────────────────────────────────
//
// keyup ไม่ยิงเมื่อวางค่าด้วยเมาส์ กด stepper ของ input[type=number] undo หรือ autofill
// ค่าขึ้นในช่องแต่ไม่คำนวณใหม่และ autosave ไม่ทำงาน → ครูออกจากหน้าไปแล้วคะแนนหาย
test('ช่องกรอกคะแนนต้องใช้ oninput ไม่ใช่ onkeyup', () => {
  const score = read('Scripts_Score.html');
  assert.ok(!/onkeyup=/.test(score), 'Scripts_Score.html ต้องไม่เหลือ onkeyup');
  assert.ok(/oninput="calcRow\(/.test(score), 'ช่องคะแนนต้องเรียก calcRow ผ่าน oninput');
  assert.ok(/oninput="calcEvalRow\(/.test(score), 'ช่องประเมินต้องเรียก calcEvalRow ผ่าน oninput');
});

// ── error จากเซิร์ฟเวอร์ห้ามถูกยิงซ้ำแบบ "สัญญาณขัดข้อง" ─────────────────────
//
// เจอตอน ผอ. เปิดหน้าสารบรรณ: error สิทธิ์ถูกยิงซ้ำ 3 รอบพร้อมขึ้น
// "สัญญาณขัดข้อง กำลังส่งข้อมูลใหม่..." ทั้งที่เซิร์ฟเวอร์ตอบชัดแล้วว่าไม่ให้ทำ
// อันตรายกว่านั้นคือถ้าเป็น write function ที่ล้มไปแล้ว จะถูกยิงซ้ำอีกสองครั้ง
test('gas-shim ติดธง serverError และ safeRun ต้องไม่ยิงซ้ำเมื่อเจอธงนั้น', () => {
  const shim = fs.readFileSync(path.join(__dirname, '../public/gas-shim.js'), 'utf8');
  assert.match(shim, /serverError\s*=\s*true/, 'gas-shim ต้องติดธงให้ error ที่มาจากเซิร์ฟเวอร์');

  const core = read('Scripts_Core.html');
  assert.match(core, /retriesLeft > 0 && !\(err && err\.serverError\)/,
    'safeRun ต้องยิงซ้ำเฉพาะตอนเชื่อมต่อไม่ได้');
});

// ── ห้ามใช้ native alert/confirm ในโค้ดที่รันระหว่างใช้งาน ──────────────────
//
// native dialog บล็อก JS ทั้งหน้าจนกว่าคนจะกดปิด (ทำให้หน้าค้างจริงตอนไล่เทส)
// ที่ยกเว้นได้คือหน้าจอล็อกอิน/ออกจากระบบ ซึ่งยังไม่มี Swal/showToast ให้ใช้
test('safeRun ต้องแจ้ง error ด้วย showToast ไม่ใช่ alert()', () => {
  const core = read('Scripts_Core.html');
  const block = core.slice(core.indexOf('const attemptCall'), core.indexOf('attemptCall(maxRetries)'))
    .replace(/\/\/[^\n]*/g, '');       // ตัดคอมเมนต์ก่อน — คอมเมนต์ที่อธิบายกติกานี้เองก็มีคำว่า alert(
  assert.ok(!/[^.\w]alert\(/.test(block), 'ตัวจัดการ error ของ safeRun ต้องไม่เรียก alert()');
  assert.match(block, /showToast\(/);
});

// ── หน้าล่าสุดต้องผูกกับเจ้าของ ──────────────────────────────────────────────
//
// เครื่องที่โรงเรียนใช้ร่วมกัน: ครูปิดเบราว์เซอร์โดยไม่กดออกจากระบบ นักเรียนล็อกอินต่อ
// แล้วถูกพาไปหน้างานสารบรรณของครู เจอ error สิทธิ์เต็มหน้าจอ
test('กลับไปหน้าล่าสุดเฉพาะเมื่อเป็นคนเดิม', () => {
  const core = read('Scripts_Core.html');
  assert.match(core, /pssms_last_page_user/, 'ต้องจดว่าหน้าล่าสุดเป็นของใคร');
  assert.match(core, /lastPageUser === meId/, 'ต้องเทียบเจ้าของก่อนพากลับไปหน้าเดิม');
  // logout ต้องล้างทั้งคู่ ไม่งั้นคีย์ผู้ใช้ค้างไว้ชี้คนเก่า
  const logout = core.slice(core.indexOf('function logout'), core.indexOf('function logout') + 600);
  assert.match(logout, /removeItem\('pssms_last_page'\)/);
  assert.match(logout, /removeItem\('pssms_last_page_user'\)/);
});

// ── ป้ายบอกห้องบนหน้าเช็คชื่อต้องไม่ค้างที่ "กำลังดึง..." ────────────────────
test('หน้าเช็คชื่อต้องเขียนทับป้าย "กำลังดึงรายชื่อ" เมื่อได้รายชื่อแล้ว', () => {
  const academic = read('Scripts_Academic.html');
  const fn = academic.slice(academic.indexOf('const fetchHistoryAndRender'), academic.indexOf('let cached = null;'));
  assert.match(fn, /dispClass/, 'ต้องอัปเดต #dispClass หลังได้รายชื่อ');
});

// ── cache HTML รายหน้าต้องผูกกับรหัสรุ่น ────────────────────────────────
//
// เคยหลุด: `sessionStorage.getItem('pssms_pg_' + name)` คีย์ไม่มีรุ่นอยู่ในนั้น
// ไฟล์ JS เสิร์ฟแบบ no-store คือใหม่ทุกครั้ง แต่ HTML รายหน้าค้างได้ 30 นาที
// deploy ที่แก้ id ในหน้าจึงทำให้ครูที่เปิดแท็บค้างได้ JS ใหม่คู่กับ HTML เก่า
// แล้ว getElementById คืน null → TypeError → ปุ่มกดแล้วไม่มีอะไรเกิดขึ้น เงียบสนิท
test('cache HTML รายหน้าต้องผสม __PSSMS_BUILD ในคีย์', () => {
  const core = read('Scripts_Core.html');

  assert.ok(/function _pgKey\(/.test(core), 'ต้องมี _pgKey ที่เดียวสำหรับประกอบคีย์');
  assert.ok(/_pgKey[\s\S]{0,200}__PSSMS_BUILD/.test(core),
    '_pgKey ต้องเอา window.__PSSMS_BUILD มาผสม (routes/assets.js เป็นคนใส่ค่ามาให้)');

  // ห้ามมีที่ไหนต่อคีย์เองแบบไม่ผ่าน _pgKey
  const raw = [...core.matchAll(/sessionStorage\.(?:getItem|setItem|removeItem)\(([^)]*)/g)]
    .map(m => m[1].trim())
    .filter(arg => arg.includes('pssms_pg_'));
  assert.deepEqual(raw, [],
    'ต่อคีย์ pssms_pg_ เองแปลว่ามีทางที่ข้ามรหัสรุ่นไปได้ — ใช้ _pgKey(name) เสมอ');
});

// ── ตัวกวาด cache ของรุ่นเก่า ────────────────────────────────────────
// ไม่กวาด = sessionStorage บวมขึ้นทุก deploy จนเขียนไม่ลงแล้ว cache หยุดทำงานเงียบ ๆ
test('ต้องกวาด cache ของรุ่นก่อนทิ้ง', () => {
  const core = read('Scripts_Core.html');
  assert.ok(/_pgCachePurgeOld/.test(core), 'ต้องมีตัวกวาดคีย์ของรุ่นเก่า');
  assert.ok(/sessionStorage\.key\(/.test(core), 'ตัวกวาดต้องไล่คีย์ที่มีอยู่จริง');
});

// ── ตัวอ่าน PDF ต้องมีทางถอยเสมอ ───────────────────────────────────
//
// pdf.js เป็นทางหลักเพราะ iOS Safari เรนเดอร์ PDF ใน <iframe> ได้แค่หน้าแรกและเลื่อนไม่ได้
// แต่ pdf.js เองก็ล้มได้ (bucket ยังไม่ตั้ง CORS / โหลด CDN ไม่ผ่าน) — ล้มแล้วต้องเห็นอะไรสักอย่าง
// ไม่ใช่จอว่างเปล่าที่ไม่มีใครรู้ว่าเกิดอะไรขึ้น
test('ตัวอ่าน PDF ต้องมี fallback และปุ่มเปิดแท็บใหม่', () => {
  const js = read('Scripts_General.html');
  const page = read('Page_Teaching_Media.html');

  assert.ok(/_mediaRenderPdf\(/.test(js), 'ต้องมีตัวเรนเดอร์ pdf.js');
  assert.ok(/_mediaRenderPdf\([\s\S]{0,400}?\.catch\(/.test(js),
    'เรียก _mediaRenderPdf แล้วต้องมี .catch — ล้มเงียบคือจอว่าง');
  assert.ok(/_mediaPdfFallback\(/.test(js), 'ต้องมี fallback เป็น iframe');
  assert.ok(/id="mrOpenTab"/.test(page), 'ปุ่มเปิดแท็บใหม่คือทางหนีสุดท้าย ห้ามลบ');
  assert.ok(/mrOpenTab'\)\.href = /.test(js), 'ปุ่มแท็บใหม่ต้องถูกตั้ง href ทุกครั้งที่เปิดไฟล์');
});

// ── งานวาดต้องถูกยกเลิกเมื่อสลับไฟล์หรือปิดหน้าต่าง ──────────────────
// ไม่ยกเลิก = canvas ของไฟล์เก่ายังวาดต่อเบื้องหลัง กิน CPU และแย่งจอไฟล์ใหม่
test('ตัวอ่านต้องยกเลิกงานวาดค้างเมื่อสลับไฟล์และตอนปิด', () => {
  const js = read('Scripts_General.html');
  assert.ok(/_mediaRenderToken\(/.test(js), 'ต้องมี token กันงานวาดของไฟล์เก่า');
  assert.ok(/alive:\s*function/.test(js), 'token ต้องบอกได้ว่ายังควรวาดอยู่ไหม');
  // ทั้งตอนสลับไฟล์ และตอน hidden.bs.modal ต้องเรียก cleanups
  const cleanupCalls = js.match(/cleanups\.forEach\(/g) || [];
  assert.ok(cleanupCalls.length >= 2,
    `ต้องล้าง cleanups ทั้งตอนสลับไฟล์และตอนปิด modal (เจอ ${cleanupCalls.length} จุด)`);
});

// ── pdf.js ต้องโหลดแบบ lazy ────────────────────────────────────────
// คนที่เข้ามาดูการ์ดแบบลิงก์อย่างเดียวไม่ควรต้องโหลด lib ~1MB ทิ้ง
test('pdf.js ต้องไม่ถูกโหลดตอนเข้าหน้า', () => {
  const js = read('Scripts_General.html');
  const index = fs.readFileSync(path.join(SRC, '../public/index.html'), 'utf8');
  assert.ok(!/pdf(js)?[.-]?min\.js/.test(index), 'index.html ต้องไม่โหลด pdf.js ล่วงหน้า');
  assert.ok(/_loadPdfJs\(/.test(js), 'ต้องโหลดผ่าน _loadPdfJs ตอนใช้จริง');
  assert.ok(/GlobalWorkerOptions\.workerSrc/.test(js),
    'ไม่ตั้ง workerSrc แล้ว pdf.js จะวาดไม่ออกบน build ที่แยก worker');
});
