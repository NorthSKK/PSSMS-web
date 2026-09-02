'use strict';
/**
 * งานสารบรรณ — สิทธิ์และไฟล์แนบ
 *
 * เดิม getSarabunHistory รับ userName/role มาจาก client แล้วเชื่อตรง ๆ
 * ใครที่ล็อกอินได้ (รวมนักเรียน) ส่ง role='TEACHER' ก็อ่านทะเบียนทั้งโรงเรียนได้
 * เทสต์ชุดนี้ล็อกไว้ว่าตัวตนต้องมาจาก JWT เท่านั้น
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ok, denied, stop, TOKENS, baseURL, token } = require('./helpers/api');
const { query } = require('../lib/db');
const storage = require('../lib/storage');

after(stop);

const STUDENT = token({ id: '02001', role: 'Student' });

// default requester = teacher1 — เทสแนบไฟล์ส่วนใหญ่อัปโหลดด้วย token teacher1
// และตอนนี้แนบได้เฉพาะเจ้าของ (ผู้รับผิดชอบ) หรือ Admin
// requesterId = null โดย default → เทสเดิมทั้งชุดวิ่งผ่าน "กติกาสำรองด้วยชื่อ" (แถวเก่า)
async function makeDoc(subject = 'ทดสอบสารบรรณ', requester = 'ครูสมชาย ใจดี', requesterId = null) {
  const { rows } = await query(
    `INSERT INTO sarabun(doc_type, doc_number, subject, requester, target_date, status, year, requester_id)
     VALUES('บันทึกข้อความ','ศธ 999/2569',$1,$2,'2026-08-28','รอดำเนินการ','2569',$3)
     RETURNING id`, [subject, requester, requesterId]
  );
  return rows[0].id;
}

function upload({ docId, token: tok, filename = 'doc.pdf', content = '%PDF-1.4 หนังสือ' }) {
  const boundary = '----sarabuntest' + Date.now() + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`, 'utf8'),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  return baseURL().then(base => new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/media/sarabun/${docId}`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.end(body);
  }));
}

test('นักเรียนอ่านทะเบียนสารบรรณไม่ได้ แม้จะยิง API ตรง', async () => {
  // เดิมฟังก์ชันนี้ไม่อยู่ใน allowlist ไหนเลย และเชื่อ role ที่ส่งมากับ args
  await denied('getSarabunHistory', [], STUDENT);
  await denied('getSarabunHistory', ['ครูสมหญิง ตั้งใจสอน', 'ADMIN'], STUDENT);
});

test('ส่ง role ปลอมมากับ args ไม่มีผล — ตัวตนมาจาก JWT', async () => {
  const id = await makeDoc('เอกสารของครูคนอื่น', 'ครูคนอื่น');
  // ครูเห็นทุกรายการอยู่แล้ว (ทะเบียนกลาง) — ที่ล็อกคือ args ถูกเมิน
  const asTeacher = await ok('getSarabunHistory', ['ไม่ใช่ชื่อจริง', 'ADMIN'], 'teacher1');
  assert.ok(asTeacher.some(r => r.id === id), 'ครูต้องเห็นทุกรายการ');
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

test('requester มาจาก JWT ครูตั้งชื่อคนอื่นไม่ได้', async () => {
  await query(`DELETE FROM sarabun WHERE doc_number='ศธ 998/2569'`); // กันแถวค้างจากรอบก่อน
  await ok('saveSarabun', [{
    docType: 'บันทึกข้อความ', docNumber: 'ศธ 998/2569', subject: 'ทดสอบเจ้าของ',
    requester: 'ผู้อำนวยการ', year: '2569',
  }], 'teacher2');

  const { rows } = await query(`SELECT requester FROM sarabun WHERE doc_number='ศธ 998/2569'`);
  assert.equal(rows[0].requester, 'ครูสมหญิง ตั้งใจสอน',
    'requester ต้องเป็นเจ้าของ token ไม่ใช่ค่าที่ส่งมา');
  await query(`DELETE FROM sarabun WHERE doc_number='ศธ 998/2569'`);
});

test('Admin ระบุ requester แทนคนอื่นได้ (ธุรการกรอกให้ครู)', async () => {
  await query(`DELETE FROM sarabun WHERE doc_number='ศธ 997/2569'`);
  await ok('saveSarabun', [{
    docType: 'บันทึกข้อความ', docNumber: 'ศธ 997/2569', subject: 'ธุรการกรอกให้',
    requester: 'ครูสมชาย ใจดี', year: '2569',
  }], 'admin');

  const { rows } = await query(`SELECT requester FROM sarabun WHERE doc_number='ศธ 997/2569'`);
  assert.equal(rows[0].requester, 'ครูสมชาย ใจดี');
  await query(`DELETE FROM sarabun WHERE doc_number='ศธ 997/2569'`);
});

test('นักเรียนแนบไฟล์ไม่ได้', async () => {
  const id = await makeDoc();
  const res = await upload({ docId: id, token: STUDENT });
  assert.equal(res.status, 403);
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

test('แนบไฟล์ได้ทั้ง PDF / JPEG / PNG / DOCX', async () => {
  const cases = [
    ['เอกสาร.pdf', Buffer.from('%PDF-1.4 x'), 'pdf'],
    ['รูปถ่าย.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'jpg'],
    ['สแกน.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]), 'png'],
    ['หนังสือ.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9]), 'docx'],
  ];
  for (const [filename, content, ext] of cases) {
    const id = await makeDoc('แนบ ' + ext);
    const res = await upload({ docId: id, token: TOKENS.teacher1, filename, content });
    assert.equal(res.status, 200, `${ext}: ${JSON.stringify(res.body)}`);

    const { rows } = await query(`SELECT file_key, file_name FROM sarabun WHERE id=$1`, [id]);
    assert.match(rows[0].file_key, new RegExp(`\\.${ext}$`), `key ต้องลงท้าย .${ext}`);
    assert.equal(rows[0].file_name, filename, 'ชื่อไฟล์ภาษาไทยต้องไม่เพี้ยน');

    await ok('deleteSarabun', [id], 'admin');
  }
});

test('ไฟล์ชนิดอื่นถูกปฏิเสธ แม้ตั้งนามสกุลหลอก', async () => {
  const id = await makeDoc();
  const res = await upload({
    docId: id, token: TOKENS.teacher1, filename: 'ไวรัส.pdf', content: 'MZ\x90\x00 executable',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.__error, /รองรับเฉพาะไฟล์/);
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

test('แนบทับ: ไฟล์เก่าถูกลบ ไฟล์ใหม่ใช้ได้', async () => {
  const id = await makeDoc();
  await upload({ docId: id, token: TOKENS.teacher1, filename: 'เก่า.pdf' });
  const first = (await query(`SELECT file_key FROM sarabun WHERE id=$1`, [id])).rows[0].file_key;

  await upload({ docId: id, token: TOKENS.teacher1, filename: 'ใหม่.pdf' });
  const second = (await query(`SELECT file_key, file_name FROM sarabun WHERE id=$1`, [id])).rows[0];

  assert.notEqual(second.file_key, first, 'ต้องได้ key ใหม่');
  assert.equal(second.file_name, 'ใหม่.pdf');
  assert.equal(storage.disk.statSync(first), null, 'ไฟล์เก่าต้องถูกลบ');
  assert.ok(storage.disk.statSync(second.file_key), 'ไฟล์ใหม่ต้องอยู่');

  await ok('deleteSarabun', [id], 'admin');
});

test('ตั๋วเปิดไฟล์แนบ: ครูเปิดได้ นักเรียนขอไม่ได้ ตั๋วข้ามชนิดไม่ได้', async () => {
  const id = await makeDoc();
  await upload({ docId: id, token: TOKENS.teacher1, filename: 'หนังสือราชการ.pdf' });

  await denied('getSarabunFileTicket', [id], STUDENT);

  const ticket = await ok('getSarabunFileTicket', [id], 'teacher2');
  assert.match(ticket.url, /^\/api\/media\/file\/sarabun\/\d+\?t=/);

  const base = await baseURL();
  const res = await new Promise((resolve, reject) => {
    http.get(`${base}${ticket.url}`, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers }));
    }).on('error', reject);
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');

  // ตั๋วของ sarabun ใช้กับ kind media ไม่ได้
  const t = new URL('http://x' + ticket.url).searchParams.get('t');
  const crossed = await new Promise((resolve, reject) => {
    http.get(`${base}/api/media/file/media/${id}?t=${encodeURIComponent(t)}`,
      r => resolve({ status: r.statusCode })).on('error', reject);
  });
  assert.equal(crossed.status, 403);

  await ok('deleteSarabun', [id], 'admin');
});

test('docx เสิร์ฟเป็น attachment ไม่ให้เบราว์เซอร์เรนเดอร์เอง', async () => {
  const id = await makeDoc();
  await upload({
    docId: id, token: TOKENS.teacher1, filename: 'บันทึก.docx',
    content: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
  });
  const ticket = await ok('getSarabunFileTicket', [id], 'teacher1');
  const base = await baseURL();
  const res = await new Promise((resolve, reject) => {
    http.get(`${base}${ticket.url}`, r => resolve({ status: r.statusCode, headers: r.headers }))
      .on('error', reject);
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-disposition'], /^attachment/);
  assert.match(res.headers['content-type'], /wordprocessingml/);

  await ok('deleteSarabun', [id], 'admin');
});

test('ลบทะเบียนแล้วไฟล์ต้องถูกลบด้วย', async () => {
  const id = await makeDoc();
  await upload({ docId: id, token: TOKENS.teacher1 });
  const key = (await query(`SELECT file_key FROM sarabun WHERE id=$1`, [id])).rows[0].file_key;

  await ok('deleteSarabun', [id], 'admin');

  assert.equal(storage.disk.statSync(key), null, 'ลบทะเบียนแล้วไฟล์ต้องไม่เหลือ');
  const left = await query(`SELECT id FROM sarabun WHERE id=$1`, [id]);
  assert.equal(left.rows.length, 0);
});

// ---------------------------------------------------------------------------
// เขียนได้เฉพาะผู้รับผิดชอบ (owner-or-admin) — ครูคนอื่นอ่านได้อย่างเดียว

test('แนบไฟล์: เจ้าของแนบได้ ครูคนอื่นโดนปฏิเสธ Admin แนบได้ทุกใบ', async () => {
  const id = await makeDoc('เอกสารของ teacher1', 'ครูสมชาย ใจดี');

  // ครูคนอื่น (teacher2) — ปฏิเสธก่อนเขียนไฟล์
  const rejected = await upload({ docId: id, token: TOKENS.teacher2 });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.__error, /แนบไฟล์ได้เฉพาะผู้รับผิดชอบ/);
  const noFile = await query(`SELECT file_key FROM sarabun WHERE id=$1`, [id]);
  assert.equal(noFile.rows[0].file_key, null, 'ต้องไม่มีไฟล์ถูกเขียนเมื่อโดนปฏิเสธ');

  // เจ้าของแนบได้
  const owned = await upload({ docId: id, token: TOKENS.teacher1 });
  assert.equal(owned.status, 200);

  // Admin แนบทับได้แม้ไม่ใช่เจ้าของ
  const asAdmin = await upload({ docId: id, token: TOKENS.admin, filename: 'admin.pdf' });
  assert.equal(asAdmin.status, 200);

  await ok('deleteSarabun', [id], 'admin');
});

test('แก้ไขทะเบียน: เจ้าของแก้ได้ ครูคนอื่นโดน __error Admin แก้ได้', async () => {
  const id = await makeDoc('แก้ไขทดสอบ', 'ครูสมชาย ใจดี');
  const payload = (extra) => [{
    id, docType: 'บันทึกข้อความ', docNumber: 'ศธ 999/2569',
    subject: 'แก้แล้ว', year: '2569', ...extra,
  }];

  const err = await denied('saveSarabun', payload({}), 'teacher2');
  assert.match(err, /แก้ไขได้เฉพาะผู้รับผิดชอบ/);

  await ok('saveSarabun', payload({}), 'teacher1');
  await ok('saveSarabun', payload({ requester: 'ครูสมชาย ใจดี' }), 'admin');
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

test('requester ว่าง (ข้อมูลเก่า) = Admin เท่านั้น', async () => {
  const id = await makeDoc('แถวนำเข้าไม่มีผู้รับผิดชอบ', '');

  const res = await upload({ docId: id, token: TOKENS.teacher1 });
  assert.equal(res.status, 400, 'ครูแนบแถว requester ว่างไม่ได้');

  await denied('saveSarabun', [{ id, docType: 'บันทึกข้อความ', subject: 'x', year: '2569' }], 'teacher1');
  await ok('saveSarabun',
    [{ id, docType: 'บันทึกข้อความ', subject: 'x', requester: '', year: '2569' }], 'admin');
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

test('getSarabunHistory ติดธง mine ตามเจ้าของ — Admin ได้ true ทุกแถว', async () => {
  const mineId  = await makeDoc('ของ teacher1', 'ครูสมชาย ใจดี');
  const otherId = await makeDoc('ของ teacher2', 'ครูสมหญิง ตั้งใจสอน');
  const blankId = await makeDoc('ไม่มีผู้รับผิดชอบ', '');

  const asT1 = await ok('getSarabunHistory', [], 'teacher1');
  assert.equal(asT1.find(r => r.id === mineId).mine,  true);
  assert.equal(asT1.find(r => r.id === otherId).mine, false);
  assert.equal(asT1.find(r => r.id === blankId).mine, false, 'requester ว่างต้องไม่เป็นของใคร');

  const asAdmin = await ok('getSarabunHistory', [], 'admin');
  for (const rid of [mineId, otherId, blankId]) {
    assert.equal(asAdmin.find(r => r.id === rid).mine, true, 'Admin เขียนได้ทุกแถว');
  }

  await query(`DELETE FROM sarabun WHERE id = ANY($1)`, [[mineId, otherId, blankId]]);
});

// ---------------------------------------------------------------------------
// เจ้าของผูกกับ username (requester_id) ไม่ใช่ชื่อที่แสดง
//
// บน production มี 34/153 แถวที่ requester เป็นชื่อย่อ (`ครูพิสิษฐ์`) หรือใส่สองคน
// ในช่องเดียว — เทียบด้วยชื่อแล้วครูเจ้าของแนบไฟล์เอกสารตัวเองไม่ได้

test('requester_id เป็นตัวตัดสิน: เจ้าของแนบ/แก้ได้ ครูคนอื่นไม่ได้ Admin ได้', async () => {
  const id = await makeDoc('ผูกด้วย username', 'ครูสมชาย ใจดี', 'teacher1');

  const rejected = await upload({ docId: id, token: TOKENS.teacher2 });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.__error, /แนบไฟล์ได้เฉพาะผู้รับผิดชอบ/);

  assert.equal((await upload({ docId: id, token: TOKENS.teacher1 })).status, 200);
  assert.equal((await upload({ docId: id, token: TOKENS.admin })).status, 200);

  const payload = [{ id, docType: 'บันทึกข้อความ', subject: 'แก้แล้ว', year: '2569' }];
  const err = await denied('saveSarabun', payload, 'teacher2');
  assert.match(err, /แก้ไขได้เฉพาะผู้รับผิดชอบ/);
  await ok('saveSarabun', payload, 'teacher1');

  await ok('deleteSarabun', [id], 'admin');
});

test('ชื่อในทะเบียนไม่ตรงกับใครเลย แต่ requester_id เป็นของครู — ครูยังเป็นเจ้าของ', async () => {
  // ครูเปลี่ยนชื่อ-สกุล หรือแถวเก่าเก็บชื่อย่อไว้ — ชื่อต้องไม่ถูกนำมาพิจารณาเลย
  const id = await makeDoc('ชื่อเก่าค้าง', 'ครูสมชาย', 'teacher1');

  assert.equal((await upload({ docId: id, token: TOKENS.teacher1 })).status, 200);
  await ok('saveSarabun',
    [{ id, docType: 'บันทึกข้อความ', subject: 'แก้ได้', year: '2569' }], 'teacher1');

  const mine = await ok('getSarabunHistory', [], 'teacher1');
  assert.equal(mine.find(r => r.id === id).mine, true);

  await ok('deleteSarabun', [id], 'admin');
});

test('แถวเก่า requester_id ว่าง — ชื่อตรงยังใช้ได้ ชื่อย่อที่ไม่ตรงใครเป็นของ Admin', async () => {
  const legacy = await makeDoc('แถวเก่าชื่อตรง', 'ครูสมชาย ใจดี', null);
  assert.equal((await upload({ docId: legacy, token: TOKENS.teacher1 })).status, 200,
    'ชื่อตรง users.full_name ต้องยังผ่านกติกาสำรอง');
  await ok('deleteSarabun', [legacy], 'admin');

  const short = await makeDoc('แถวเก่าชื่อย่อ', 'ครูพิสิษฐ์', null);
  const res = await upload({ docId: short, token: TOKENS.teacher1 });
  assert.equal(res.status, 400, 'ชื่อย่อไม่ตรงใคร = ครูแตะไม่ได้');
  await denied('saveSarabun',
    [{ id: short, docType: 'บันทึกข้อความ', subject: 'x', year: '2569' }], 'teacher1');

  const asT1 = await ok('getSarabunHistory', [], 'teacher1');
  assert.equal(asT1.find(r => r.id === short).mine, false);

  assert.equal((await upload({ docId: short, token: TOKENS.admin })).status, 200);
  await ok('deleteSarabun', [short], 'admin');
});

test('requestSarabunNumber ปั๊ม requester_id ให้ผู้ขอ', async () => {
  const res = await ok('requestSarabunNumber',
    [{ docType: 'ทดสอบเจ้าของ', subject: 'ขอเลข', year: '2569' }], 'teacher1');

  const { rows } = await query(
    `SELECT id, requester, requester_id FROM sarabun WHERE doc_type='ทดสอบเจ้าของ'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requester_id, 'teacher1');
  assert.equal(rows[0].requester, 'ครูสมชาย ใจดี');
  assert.match(res.docNumber, /^\d+\/2569$/);

  const mine = await ok('getSarabunHistory', [], 'teacher1');
  assert.equal(mine.find(r => r.id === rows[0].id).mine, true);

  await query(`DELETE FROM sarabun WHERE doc_type='ทดสอบเจ้าของ'`);
});

test('Admin ระบุชื่อเต็มที่มีใน users → แถวนั้นได้เจ้าของติดไปเลย', async () => {
  // นี่คือทางแก้แถวเก่า 34 แถวบน production: Admin แก้ทะเบียนแล้วเลือกชื่อเต็มให้ถูก
  const id = await makeDoc('รอ Admin ระบุเจ้าของ', 'ครูสมชาย', null);
  await ok('saveSarabun', [{
    id, docType: 'บันทึกข้อความ', subject: 'ระบุเจ้าของแล้ว',
    requester: 'ครูสมชาย ใจดี', year: '2569',
  }], 'admin');

  const { rows } = await query(`SELECT requester_id FROM sarabun WHERE id=$1`, [id]);
  assert.equal(rows[0].requester_id, 'teacher1');
  assert.equal((await upload({ docId: id, token: TOKENS.teacher1 })).status, 200,
    'ครูต้องแนบไฟล์เอกสารของตัวเองได้หลัง Admin ระบุเจ้าของ');

  await ok('deleteSarabun', [id], 'admin');
});

test('Admin พิมพ์ชื่ออิสระที่ไม่มีใน users → ไม่มีใครเป็นเจ้าของ', async () => {
  await query(`DELETE FROM sarabun WHERE doc_number='ศธ 996/2569'`);
  await ok('saveSarabun', [{
    docType: 'บันทึกข้อความ', docNumber: 'ศธ 996/2569', subject: 'ชื่ออิสระ',
    requester: 'ครูไม่มีในระบบ', year: '2569',
  }], 'admin');

  const { rows } = await query(
    `SELECT id, requester_id FROM sarabun WHERE doc_number='ศธ 996/2569'`);
  assert.equal(rows[0].requester_id, null);
  await query(`DELETE FROM sarabun WHERE id=$1`, [rows[0].id]);
});

test('ลบทะเบียนเป็นของ Admin ครูลบไม่ได้', async () => {
  const id = await makeDoc();
  await denied('deleteSarabun', [id], 'teacher1');
  await query(`DELETE FROM sarabun WHERE id=$1`, [id]);
});

// ---------------------------------------------------------------------------
// ขอเลขเป็นชุด (เกียรติบัตร)
//
// ฟอร์มมีช่อง "จำนวน (ฉบับ)" ให้เฉพาะทะเบียนเกียรติบัตร และปุ่มเขียนว่า "รันเลขชุด"
// แต่ server ไม่เคยอ่าน amount เลย — ครูขอ 25 ใบได้เลขเดียว อีก 24 ใบไม่มีเลขในทะเบียน
// แล้วไม่มีอะไรฟ้อง เพราะคำขอสำเร็จตามปกติ

const CERT = 'ทะเบียนเกียรติบัตร';

/** เลขล้วนของเกียรติบัตรในทะเบียน เรียงน้อยไปมาก */
async function certNumbers() {
  const rows = await ok('getSarabunHistory', [], 'teacher2');
  return rows
    .filter(r => r.docType === CERT)
    .map(r => parseInt(String(r.docNumber).split('/')[0], 10))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

const askCert = (amount) =>
  ok('requestSarabunNumber', [{ docType: CERT, subject: 'เกียรติบัตร', amount, year: '2569' }], 'teacher2');

test('ขอเลขชุด — ได้ครบตามจำนวนที่ขอ ไม่ใช่เลขเดียว', async () => {
  const before = await certNumbers();
  const res = await askCert(25);

  assert.equal(res.count, 25, 'ต้องออกเลขครบ 25');
  const after = await certNumbers();
  assert.equal(after.length - before.length, 25, 'ต้องมี 25 แถวใหม่ในทะเบียน — ครูต้องอ้างอิงได้ทุกใบ');

  const added = after.slice(before.length);
  assert.ok(added.every((n, i) => i === 0 || n === added[i - 1] + 1), 'เลขในชุดต้องต่อเนื่องไม่ขาด');
  assert.equal(new Set(after).size, after.length, 'ห้ามมีเลขซ้ำในทะเบียน');
  assert.match(res.firstNumber, /^\d+\/2569$/);
  assert.match(res.lastNumber, /^\d+\/2569$/);
});

test('ขอชุดถัดไปต้องต่อจากเลขเดิม ไม่ทับของเก่า', async () => {
  const first = await askCert(3);
  const second = await askCert(2);
  const n1 = parseInt(first.lastNumber, 10);
  const n2 = parseInt(second.firstNumber, 10);
  assert.equal(n2, n1 + 1, 'ชุดใหม่ต้องเริ่มถัดจากเลขสุดท้ายของชุดก่อน');
});

test('ขอทีละเลขยังคืนรูปแบบเดิม', async () => {
  const res = await askCert(1);
  assert.equal(res.count, 1);
  assert.equal(res.docNumber, res.firstNumber, 'ขอใบเดียวต้องไม่กลายเป็นช่วงเลข');
  assert.match(res.docNumber, /^\d+\/2569$/);
});

test('จำนวนที่ส่งมาเพี้ยนต้องไม่ทำให้ทะเบียนพัง', async () => {
  for (const bad of [0, -5, 'abc', null, undefined]) {
    const res = await askCert(bad);
    assert.equal(res.count, 1, `amount=${JSON.stringify(bad)} ต้องถือเป็น 1 ใบ`);
  }
  // เพดานกันคนพิมพ์เลขหลุด — ไม่งั้นสร้างเป็นหมื่นแถวในคำขอเดียว
  const huge = await askCert(9999);
  assert.equal(huge.count, 500, 'ต้องตัดที่เพดาน ไม่ใช่สร้างตามที่ขอ');
});
