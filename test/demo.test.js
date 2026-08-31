'use strict';
/**
 * เดโมสาธารณะ และด่านกันสคริปต์ล้างฐานข้อมูลผิดเครื่อง
 *
 * เทสต์สำคัญที่สุดในไฟล์นี้คือ "DB ที่ไม่ได้ทำเครื่องหมายต้องล้างไม่ได้"
 * ถ้าด่านนี้พัง ความผิดพลาดครั้งเดียวตอนตั้งค่า = ข้อมูลครูและนักเรียนจริงหายทั้งโรงเรียน
 * ไม่มี undo ไม่มีคำอธิบายที่ยอมรับได้
 */
const { test, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const instance = require('../lib/instance');
const cache = require('../lib/cache');

const ROOT = path.join(__dirname, '..');

/** รันสคริปต์แล้วคืนผลแบบไม่ throw — เราสนใจ exit code กับข้อความ */
function run(script, args = [], env = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, script), ...args],
      { cwd: ROOT, env: { ...process.env, ...env }, timeout: 60000 },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
}

afterEach(async () => { await instance.unmarkDemo(); cache.del('is_demo'); });
after(async () => { await instance.unmarkDemo(); await stop(); });

// ------------------------------------------------------- ด่านกันล้างผิดเครื่อง

test('DB ที่ไม่ใช่ localhost และไม่ได้ทำเครื่องหมาย — seed ต้องปฏิเสธ', async () => {
  const fake = 'postgres://u:p@db.some-school.railway.app:5432/railway';
  for (const s of ['db/seed-dev.js', 'db/seed-demo.js']) {
    const r = await run(s, [], { DATABASE_URL: fake });
    assert.notEqual(r.code, 0, `${s} ต้อง exit ไม่เป็นศูนย์`);
    assert.match(r.stderr, /ปฏิเสธการรัน/);
    assert.match(r.stderr, /some-school\.railway\.app/, 'ต้องบอกด้วยว่ากำลังจะล้างเครื่องไหน');
  }
});

test('DATABASE_URL เสียหาย — ปฏิเสธ ไม่ใช่เดาว่าเป็น localhost', async () => {
  const r = await run('db/seed-dev.js', [], { DATABASE_URL: 'ไม่ใช่ url' });
  assert.notEqual(r.code, 0);
});

test('mark-demo ปฏิเสธถ้าไม่ยืนยัน', async () => {
  const r = await run('scripts/mark-demo.js');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--yes/);
  assert.equal(await instance.isDemoDatabase(), false, 'ห้ามติดเครื่องหมายเมื่อยังไม่ยืนยัน');
});

test('เครื่องหมายเดโมติดและถอนได้', async () => {
  assert.equal(await instance.isDemoDatabase(), false);
  await instance.markDemo();
  assert.equal(await instance.isDemoDatabase(), true);
  await instance.unmarkDemo();
  assert.equal(await instance.isDemoDatabase(), false);
});

test('assertSafeToWipe ผ่านเพราะเป็น localhost', async () => {
  assert.equal(await instance.assertSafeToWipe('test'), 'localhost');
});

// ------------------------------------------------------- แถบเดโม

test('ไม่ใช่เดโม — ไม่ขึ้นแถบเดโม', async () => {
  cache.del('is_demo');
  const st = await ok('getLicenseStatus', [], 'teacher1');
  assert.notEqual(st.state, 'demo');
});

test('เป็นเดโม — ทุกคนเห็นแถบบอกว่าข้อมูลจะถูกล้าง', async () => {
  await instance.markDemo();
  cache.del('is_demo');
  for (const who of ['admin', 'teacher1', 'student']) {
    const st = await ok('getLicenseStatus', [], who);
    assert.equal(st.state, 'demo', `${who} ต้องเห็นว่านี่คือเดโม`);
    assert.match(st.text, /ล้าง/);
  }
});

// ------------------------------------------------------- ตัวตั้งเวลา

test('bangkokNow คืนวันและชั่วโมงตามเวลาไทย', () => {
  const { bangkokNow } = require('../lib/demoReset');
  const { day, hour } = bangkokNow();
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(hour) && hour >= 0 && hour <= 23);

  // เทียบกับเวลา UTC ตรง ๆ — ไทยเร็วกว่า 7 ชั่วโมงเสมอ ไม่มี DST
  const expect = new Date(Date.now() + 7 * 3600000).getUTCHours();
  assert.equal(hour, expect);
});

// ------------------------------------------------------- bootstrap ครั้งแรก

test('bootstrap ไม่ทำอะไรถ้าไม่ได้ตั้ง DEMO_BOOTSTRAP', async () => {
  delete process.env.DEMO_BOOTSTRAP;
  await require('../lib/demoBootstrap').run();
  assert.equal(await instance.isDemoDatabase(), false);
});

test('bootstrap ปฏิเสธถ้าฐานข้อมูลมีผู้ใช้อยู่แล้ว', async () => {
  // DB ของเทสต์ seed มาแล้ว จึงมีผู้ใช้ — เป็นตัวแทนของเครื่องโรงเรียนจริง
  const { rows } = await require('../lib/db').query(`SELECT COUNT(*)::int AS n FROM users`);
  assert.ok(rows[0].n > 0, 'เทสต์นี้ต้องรันบน DB ที่มีข้อมูล');

  process.env.DEMO_BOOTSTRAP = '1';
  try {
    await require('../lib/demoBootstrap').run();
    assert.equal(await instance.isDemoDatabase(), false,
      'env ถูกตั้งผิดเครื่องต้องไม่ทำให้ DB ที่มีคนใช้อยู่กลายเป็นเดโม');
  } finally {
    delete process.env.DEMO_BOOTSTRAP;
  }
});

// ------------------------------------------------- บัญชีทดลองบทบาทบนหน้าล็อกอิน

test('ไม่ใช่เดโม — ต้องไม่บอกบัญชีใด ๆ ออกไป', async () => {
  cache.del('is_demo');
  const list = await ok('getDemoAccounts');
  assert.deepEqual(list, [], 'เครื่องโรงเรียนจริงห้ามประกาศบัญชีให้คนนอก');
});

test('เป็นเดโม — เรียกได้โดยไม่ต้องล็อกอิน และได้บทบาทให้เลือก', async () => {
  await instance.markDemo();
  cache.del('is_demo');
  // ไม่ส่ง token — หน้าล็อกอินยังไม่มี session จะเรียกไม่ได้ถ้าไม่ได้อยู่ใน PUBLIC_FNS
  const list = await ok('getDemoAccounts');
  assert.ok(list.length >= 2, 'ต้องมีอย่างน้อยครูกับผู้ดูแลให้เลือก');
  for (const a of list) {
    assert.ok(a.username && a.label && a.password, 'ทุกรายการต้องกดแล้วล็อกอินได้จริง');
  }
  assert.ok(list.some(a => a.username === 'teacher2'), 'ครูผู้สอนคือบทบาทหลักที่ต้องมี');
});

test('ห้ามอ่านรหัสผ่านจริงจากตาราง users ออกไป', async () => {
  // ถ้าเครื่องของโรงเรียนถูกทำเครื่องหมายเป็นเดโมโดยพลาด ปลายทางนี้เรียกได้โดยไม่ต้องล็อกอิน
  // สิ่งที่หลุดต้องเป็นค่าคงที่ในโค้ด ไม่ใช่รหัสผ่านของครูจริง
  const { rows } = await query(`SELECT password FROM users WHERE username='teacher2'`);
  const original = rows[0].password;
  await query(`UPDATE users SET password='ความลับของครูจริง' WHERE username='teacher2'`);
  try {
    await instance.markDemo();
    cache.del('is_demo');
    const list = await ok('getDemoAccounts');
    const t2 = list.find(a => a.username === 'teacher2');
    assert.ok(t2, 'teacher2 ต้องยังอยู่ในลิสต์');
    assert.notEqual(t2.password, 'ความลับของครูจริง', 'รหัสผ่านจาก DB ห้ามหลุดออกไปเด็ดขาด');
    assert.equal(t2.password, '1234');
  } finally {
    await query(`UPDATE users SET password=$1 WHERE username='teacher2'`, [original]);
  }
});

test('บัญชีที่ไม่มีอยู่จริงต้องไม่ถูกเสนอ', async () => {
  await instance.markDemo();
  cache.del('is_demo');
  const list = await ok('getDemoAccounts');
  const { rows } = await query(
    `SELECT username FROM users WHERE username = ANY($1)`, [list.map(a => a.username)]
  );
  assert.equal(rows.length, list.length, 'ทุกบัญชีที่เสนอต้องมีอยู่ใน users จริง');
});
