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

async function makeDoc(subject = 'ทดสอบสารบรรณ', requester = 'ครูสมหญิง ตั้งใจสอน') {
  const { rows } = await query(
    `INSERT INTO sarabun(doc_type, doc_number, subject, requester, target_date, status, year)
     VALUES('บันทึกข้อความ','ศธ 999/2569',$1,$2,'2026-08-28','รอดำเนินการ','2569')
     RETURNING id`, [subject, requester]
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
