/**
 * ลงทะเบียนชุมนุมของนักเรียน — บั๊กสองตัวที่ทำให้ฟีเจอร์นี้ใช้ไม่ได้ทั้งฟีเจอร์
 *
 * 1. หน้าเว็บส่ง `registerToClub(user.id, clubId, 'self')` แต่ backend รับ 7 ตัว
 *    (`[studentId, studentName, className, clubId, term, year, registeredBy]`)
 *    → `clubId` เป็น undefined ทุกครั้ง นักเรียนเจอ "ไม่พบชุมนุม" เสมอ
 * 2. `unregisterFromClub(user.id, clubId, 'self')` → backend อ่านเป็น
 *    `[studentId, term, year]` → DELETE ไม่ตรงแถวไหน แต่คืน "ยกเลิกสำเร็จ"
 *    นักเรียนเชื่อว่าออกจากชุมนุมแล้ว ทั้งที่ยังอยู่
 *
 * ⚠️ โค้ดทั้งหน้าเคยอยู่ใน `<script>` ใน `Page_Student_Clubs.html` ซึ่งไม่เคยทำงาน
 * (หน้าโหลดด้วย innerHTML) — เทสท้ายไฟล์ล็อกไว้ว่าห้ามมี `<script>` ในไฟล์หน้าอีก
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ok, denied, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { TERM, YEAR } = require('./helpers/fixtures');

after(stop);

const CLUB = 'CLUBTESTREG';
const STUDENT = '01901';        // seed: เด็กหญิงกานดา ทดสอบ ม.6/1
const OTHER = '01902';

async function withClub(capacity, fn) {
  await query(`DELETE FROM club_members WHERE club_id=$1`, [CLUB]);
  await query(`DELETE FROM clubs WHERE club_id=$1`, [CLUB]);
  await query(
    `INSERT INTO clubs(club_id,club_name,description,capacity,term,year,status)
     VALUES($1,'ชุมนุมทดสอบ','',$2,$3,$4,'open')`, [CLUB, capacity, TERM, YEAR]
  );
  try { await fn(); } finally {
    await query(`DELETE FROM club_members WHERE club_id=$1`, [CLUB]);
    await query(`DELETE FROM clubs WHERE club_id=$1`, [CLUB]);
  }
}

const memberRow = async (sid) => (await query(
  `SELECT * FROM club_members WHERE student_id=$1 AND term=$2 AND year=$3`, [sid, TERM, YEAR]
)).rows[0];

test('นักเรียนลงทะเบียนชุมนุมได้จริง — args ตรงกับที่หน้าเว็บส่ง (studentId, clubId)', async () => {
  await withClub(10, async () => {
    const res = await ok('registerToClub', [STUDENT, CLUB], 'student');
    assert.strictEqual(res.status, 'success');
    const row = await memberRow(STUDENT);
    assert.ok(row, 'ต้องมีแถวใน club_members');
    assert.strictEqual(row.club_id, CLUB);
  });
});

// ชื่อ/ห้อง/เทอม/ปี ต้องมาจาก DB + ค่า active ไม่ใช่จาก client
test('ชื่อ-ห้อง-เทอม-ปี เติมจากฝั่ง server ไม่ใช่ค่าที่หน้าเว็บส่งมา', async () => {
  await withClub(10, async () => {
    await ok('registerToClub', [STUDENT, CLUB], 'student');
    const row = await memberRow(STUDENT);
    const { rows } = await query(`SELECT full_name, department FROM users WHERE username=$1`, [STUDENT]);
    assert.strictEqual(row.student_name, rows[0].full_name);
    assert.strictEqual(row.class_name, rows[0].department);
    assert.strictEqual(row.term, TERM);
    assert.strictEqual(row.year, YEAR);
  });
});

test('นักเรียนลงทะเบียนแทนคนอื่นไม่ได้ — ตัวตนมาจาก JWT ไม่ใช่ payload', async () => {
  await withClub(10, async () => {
    await ok('registerToClub', [OTHER, CLUB], 'student');   // JWT เป็น 01901
    assert.ok(await memberRow(STUDENT), 'ต้องลงให้เจ้าของ token');
    assert.ok(!(await memberRow(OTHER)), 'ต้องไม่ไปลงให้รหัสที่ส่งมาใน payload');
  });
});

test('ไม่ระบุชุมนุมต้องบอกให้รู้ ไม่ใช่ "ไม่พบชุมนุม" ลอย ๆ', async () => {
  const err = await denied('registerToClub', [STUDENT, ''], 'student');
  assert.match(err, /ไม่ได้ระบุชุมนุม/);
});

test('ยกเลิกแล้วต้องหายจริง', async () => {
  await withClub(10, async () => {
    await ok('registerToClub', [STUDENT, CLUB], 'student');
    const res = await ok('unregisterFromClub', [STUDENT], 'student');
    assert.strictEqual(res.status, 'success');
    assert.ok(!(await memberRow(STUDENT)), 'แถวต้องถูกลบจริง');
  });
});

// เดิมคืน success เสมอแม้ DELETE ไม่โดนแถวไหน — เป็นเหตุผลที่บั๊ก args ไม่มีใครเห็น
test('ยกเลิกทั้งที่ยังไม่ได้ลง ต้องเป็น error ไม่ใช่ success ปลอม', async () => {
  const err = await denied('unregisterFromClub', [STUDENT], 'student');
  assert.match(err, /ยังไม่ได้ลงทะเบียน/);
});

test('ชุมนุมเต็มแล้วลงไม่ได้', async () => {
  await withClub(1, async () => {
    await query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,'คนอื่น','ม.6/1',$3,$4,'test')`, [CLUB, OTHER, TERM, YEAR]
    );
    const err = await denied('registerToClub', [STUDENT, CLUB], 'student');
    assert.match(err, /เต็มแล้ว/);
  });
});

// ── สรุปการเช็คชื่อชุมนุม (แท็บของครูที่ปรึกษาชุมนุม) ─────────────────────────

/**
 * เดิมพังสองชั้น: หน้าเว็บส่ง 5 args (มี user.id นำหน้า) แต่ backend รับ 3 → ค่าเลื่อนหมด
 * และ backend คืนอาร์เรย์ ขณะที่หน้าเว็บอ่าน `summary.sessions` / `summary.members` / `m.pct`
 * ผลคือแท็บเช็คชื่อกับสถิติขึ้น "ยังไม่มีข้อมูลการเช็คชื่อ" ตลอด แม้เช็คชื่อไปแล้วจริง
 */
test('สรุปการเช็คชื่อชุมนุม: คืน {sessions, members} พร้อม pct ต่อคน', async () => {
  const CODE = `CLUB_${CLUB}`;
  await withClub(10, async () => {
    for (const [sid, name] of [[STUDENT, 'กานดา'], [OTHER, 'ขจร']]) {
      await query(
        `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
         VALUES($1,$2,$3,'ม.6/1',$4,$5,'test')`, [CLUB, sid, name, TERM, YEAR]
      );
    }
    // 2 คาบ — คนแรกมาครบ คนที่สองมาคาบเดียว
    const plan = [['2026-08-05', 'มา', 'มา'], ['2026-08-12', 'มา', 'ขาด']];
    for (const [d, s1, s2] of plan) {
      for (const [sid, st] of [[STUDENT, s1], [OTHER, s2]]) {
        await query(
          `INSERT INTO attendance(timestamp,date,term,year,subject_code,subject_name,class,period,
                                  student_id,student_name,status,teacher_id,session_id)
           VALUES(NOW(),$1,$2,$3,$4,'ชุมนุม','ม.6/1','8',$5,'x',$6,'teacher1',$7)`,
          [d, TERM, YEAR, CODE, sid, st, `${d}|${sid}`]
        );
      }
    }
    try {
      const res = await ok('getClubAttendanceSummary', [CLUB, TERM, YEAR], 'teacher1');
      assert.deepStrictEqual(res.sessions, ['2026-08-05', '2026-08-12']);
      const byId = Object.fromEntries(res.members.map((m) => [m.studentId, m]));
      assert.strictEqual(byId[STUDENT].pct, 100);
      assert.strictEqual(byId[OTHER].pct, 50);
      assert.strictEqual(byId[STUDENT].className, 'ม.6/1');
    } finally {
      await query(`DELETE FROM attendance WHERE subject_code=$1`, [CODE]);
    }
  });
});

test('สรุปการเช็คชื่อชุมนุม: ยังไม่เคยเช็ค → sessions ว่าง และ pct เป็น null ไม่ใช่ 0', async () => {
  await withClub(10, async () => {
    await query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,'กานดา','ม.6/1',$3,$4,'test')`, [CLUB, STUDENT, TERM, YEAR]
    );
    const res = await ok('getClubAttendanceSummary', [CLUB, TERM, YEAR], 'teacher1');
    assert.deepStrictEqual(res.sessions, []);
    assert.strictEqual(res.members.length, 1, 'สมาชิกที่ยังไม่เคยมาต้องยังอยู่ในรายการ');
    assert.strictEqual(res.members[0].pct, null);
  });
});

test('สรุปการเช็คชื่อชุมนุมเป็นของครู — นักเรียนเรียกไม่ได้', async () => {
  const err = await denied('getClubAttendanceSummary', [CLUB, TERM, YEAR], 'student');
  assert.match(err, /ครู.*ผู้ดูแล/);
});

// ── กันบั๊ก "โค้ดอยู่ในไฟล์หน้าแล้วไม่ทำงาน" กลับมา ──────────────────────────

test('ไฟล์ Page_*.html ต้องไม่มี <script> — หน้าโหลดด้วย innerHTML สคริปต์ไม่ถูกรัน', () => {
  const srcDir = path.join(__dirname, '../src');
  // ตัดคอมเมนต์ HTML ออกก่อน — คอมเมนต์ที่อธิบายกติกานี้เองก็มีคำว่า script อยู่
  const offenders = fs.readdirSync(srcDir)
    .filter((f) => f.startsWith('Page_') && f.endsWith('.html'))
    .filter((f) => /<script[\s>]/i.test(
      fs.readFileSync(path.join(srcDir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    ));
  assert.deepStrictEqual(offenders, [],
    'โค้ดของหน้าต้องอยู่ใน Scripts_*.html แล้วเรียกตัวเริ่มหน้าจาก setupPageContent');
});

test('ทุกฟังก์ชันที่หน้าลงทะเบียนชุมนุมเรียก ต้องมีอยู่จริงใน Scripts_*.html', () => {
  const srcDir = path.join(__dirname, '../src');
  const page = fs.readFileSync(path.join(srcDir, 'Page_Student_Clubs.html'), 'utf8');
  const scripts = fs.readdirSync(srcDir)
    .filter((f) => f.startsWith('Scripts_') && f.endsWith('.html'))
    .map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
  const called = [...page.matchAll(/on(?:click|keyup|change|input)="([A-Za-z_$][\w$]*)\(/g)]
    .map((m) => m[1]);
  assert.ok(called.length, 'หน้านี้ต้องมีปุ่มที่เรียกฟังก์ชัน');
  for (const fn of new Set(called)) {
    assert.ok(new RegExp(`function\\s+${fn}\\s*\\(|window\\.${fn}\\s*=`).test(scripts),
      `${fn}() ถูกเรียกจากหน้าแต่ไม่มีใครประกาศไว้ใน Scripts_*.html`);
  }
});

test('setupPageContent ต้องมีตัวเริ่มหน้าของ Page_Student_Clubs', () => {
  const core = fs.readFileSync(path.join(__dirname, '../src/Scripts_Core.html'), 'utf8');
  assert.match(core, /Page_Student_Clubs'\s*\)\s*initStudentClubs\(\)/);
});
