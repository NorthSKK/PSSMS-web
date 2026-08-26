'use strict';
/**
 * สื่อการสอนเฟส 2 — อัปโหลด PDF ลงที่เก็บไฟล์ (Railway Volume)
 *
 * จุดที่ต้องล็อกไว้:
 *   1. ด่านตรวจก่อนไฟล์ลงดิสก์ — สิทธิ์, ไฟล์ปลอม, metadata ไม่ครบ
 *   2. ไฟล์ไม่ได้เปิดสาธารณะ — ต้องมีตั๋ว และตั๋วข้ามการ์ดไม่ได้
 *      (ต่างจากตอนที่เคยใช้ลิงก์ Google Drive ซึ่งใครมีลิงก์ก็เปิดได้)
 *   3. ล้มแล้วต้อง "ดัง" ไม่ใช่รายงานว่าสำเร็จ (บั๊กเดิมของ uploadSarabunFile)
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ok, denied, stop, TOKENS, baseURL, token } = require('./helpers/api');
const { looksLikePdf, decodeFilename } = require('../routes/media');
const store = require('../lib/fileStore');

after(stop);

const PDF_CARD = 'ใบความรู้หน่วยที่ 2 (PDF)';
const STUDENT_M2 = token({ id: '02001', role: 'Student' });
const STUDENT_M6 = token({ id: '01901', role: 'Student' });

async function cardByTitle(title, as = 'admin') {
  const cards = await ok('getMediaCards', [], as);
  const found = cards.find(c => c.title === title);
  assert.ok(found, `ไม่พบการ์ด "${title}" — seed-dev เปลี่ยนไปหรือเปล่า`);
  return found;
}

function request(pathname, { method = 'GET', token: tok, headers = {}, body } = {}) {
  return baseURL().then(base => new Promise((resolve, reject) => {
    const req = http.request(`${base}${pathname}`, {
      method,
      headers: {
        ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        ...(body ? { 'Content-Length': body.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let parsed = null;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch { /* ไม่ใช่ JSON ก็ได้ */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(body);
  }));
}

// ยิง multipart ตรงไป REST endpoint — shim google.script.run ส่ง binary ไม่ได้
function uploadRaw({ token: tok, filename = 'test.pdf', content = '%PDF-1.4 fake', payload = {} }) {
  const boundary = '----pssmstest' + Date.now() + Math.random().toString(16).slice(2);
  // utf8 ไม่ใช่ latin1 — ชื่อไฟล์กับ payload เป็นภาษาไทย latin1 จะทำ header เพี้ยนจน multer ปฏิเสธ
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n`, 'utf8'),
    Buffer.from(JSON.stringify(payload), 'utf8'),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`, 'utf8'),
    Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  return request('/api/media/upload', {
    method: 'POST', token: tok, body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
}

test('magic bytes: ยอมเฉพาะไฟล์ที่ขึ้นต้นด้วย %PDF-', () => {
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7\nstuff')), true);
  assert.equal(looksLikePdf(Buffer.from('<html>ไม่ใช่ pdf</html>')), false);
  assert.equal(looksLikePdf(Buffer.from('PK\x03\x04zipfile')), false);
  assert.equal(looksLikePdf(Buffer.from('')), false);
  assert.equal(looksLikePdf(null), false);
});

test('ชื่อไฟล์ภาษาไทยจาก multipart ต้องไม่เพี้ยน', () => {
  // busboy ถอดเป็น latin1 — ถ้าไม่แปลงกลับ ครูจะเห็นชื่อไฟล์เป็น mojibake บนการ์ด
  const mangled = Buffer.from('ใบงาน.pdf', 'utf8').toString('latin1');
  assert.equal(decodeFilename(mangled), 'ใบงาน.pdf');
  assert.equal(decodeFilename('worksheet.pdf'), 'worksheet.pdf', 'ชื่อ ASCII ต้องไม่ถูกแตะ');
  assert.equal(decodeFilename(''), '');
});

test('ชื่อไฟล์บนดิสก์ต้องเป็น hex ล้วน — กัน path traversal', () => {
  assert.throws(() => store.safePath('../../etc/passwd'), /ชื่อไฟล์ไม่ถูกต้อง/);
  assert.throws(() => store.safePath('a'.repeat(32) + '.exe'), /ชื่อไฟล์ไม่ถูกต้อง/);
  assert.doesNotThrow(() => store.safePath('a'.repeat(32) + '.pdf'));
});

test('อัปโหลดโดยไม่มี token → 401', async () => {
  const res = await uploadRaw({ token: null });
  assert.equal(res.status, 401);
});

test('นักเรียนอัปโหลดไม่ได้ → 403', async () => {
  const res = await uploadRaw({ token: TOKENS.student });
  assert.equal(res.status, 403);
});

test('ไฟล์ที่ไม่ใช่ PDF จริงถูกปฏิเสธ แม้ MIME จะบอกว่าเป็น PDF', async () => {
  const res = await uploadRaw({
    token: TOKENS.teacher1, content: '<html>ปลอม</html>', payload: { title: 'ปลอม' },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.__error, /ไม่ใช่ PDF จริง/);
});

test('metadata ไม่ครบ → ปฏิเสธ และต้องไม่มีไฟล์กำพร้าค้างไว้', async () => {
  const before = await ok('getMediaStorageStatus', [], 'admin');
  const res = await uploadRaw({ token: TOKENS.teacher1, payload: { title: '   ' } });
  assert.equal(res.status, 400);
  assert.match(res.body.__error, /ชื่อสื่อ/);

  const after_ = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(after_.files, before.files, 'ตรวจ metadata ต้องเกิดก่อนเขียนไฟล์ลงดิสก์');
});

test('อัปโหลดสำเร็จ → ได้การ์ด PDF ที่เปิดไฟล์ได้จริง', async () => {
  const res = await uploadRaw({
    token: TOKENS.teacher1,
    filename: 'ใบงาน.pdf',
    content: '%PDF-1.4\nเนื้อหาทดสอบ\n%%EOF',
    payload: { title: 'อัปโหลดจากเทส', group: 'คณิตศาสตร์', visibleLevels: ['ม.6'] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cardId = res.body.__result.id;
  assert.equal(res.body.__result.url, `/api/media/file/${cardId}`);

  const card = await cardByTitle('อัปโหลดจากเทส');
  assert.equal(card.cardType, 'pdf');
  assert.equal(card.fileName, 'ใบงาน.pdf');
  assert.ok(card.meta.startsWith('PDF ·'), 'ไม่ใส่ป้ายกำกับ → เติมขนาดไฟล์ให้อัตโนมัติ');

  const ticket = await ok('getMediaFileTicket', [cardId], 'teacher1');
  const file = await request(ticket.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.match(file.headers['cache-control'], /private/, 'ห้าม proxy/CDN เก็บไฟล์ไปแจกต่อ');
  assert.ok(file.raw.toString('utf8').includes('เนื้อหาทดสอบ'));

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

test('เปิดไฟล์โดยไม่มีตั๋ว หรือตั๋วของการ์ดอื่น → ไม่ผ่าน', async () => {
  const card = await cardByTitle(PDF_CARD);

  const noTicket = await request(`/api/media/file/${card.id}`);
  assert.equal(noTicket.status, 401, 'ไฟล์ต้องไม่เปิดสาธารณะ');

  const junk = await request(`/api/media/file/${card.id}?t=ไม่ใช่ตั๋ว`);
  assert.equal(junk.status, 401);

  // ตั๋วของการ์ดอื่นต้องใช้ข้ามใบไม่ได้
  const other = await uploadRaw({
    token: TOKENS.teacher1, payload: { title: 'การ์ดอื่น', visibleLevels: ['ม.6'] },
  });
  const otherId = other.body.__result.id;
  const otherTicket = await ok('getMediaFileTicket', [otherId], 'teacher1');
  const t = new URL('http://x' + otherTicket.url).searchParams.get('t');
  const crossed = await request(`/api/media/file/${card.id}?t=${encodeURIComponent(t)}`);
  assert.equal(crossed.status, 403);

  await ok('deleteMediaCard', [otherId], 'teacher1');
});

test('นักเรียนที่ไม่ได้อยู่ในระดับชั้นของการ์ด ขอตั๋วไม่ได้', async () => {
  const card = await cardByTitle(PDF_CARD); // เปิดให้ ม.2
  await denied('getMediaFileTicket', [card.id], STUDENT_M6);

  const allowed = await ok('getMediaFileTicket', [card.id], STUDENT_M2);
  assert.match(allowed.url, /^\/api\/media\/file\/\d+\?t=/);
});

test('สถานะที่เก็บไฟล์เป็นของ Admin', async () => {
  await denied('getMediaStorageStatus', [], 'teacher1');
  const st = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(st.connected, true);
  assert.ok(st.files >= 1);
});

test('การ์ด PDF ส่ง fileName/fileSize ให้ client', async () => {
  const card = await cardByTitle(PDF_CARD);
  assert.equal(card.cardType, 'pdf');
  assert.equal(card.fileName, 'ใบความรู้หน่วย2.pdf');
  assert.ok(card.fileSize > 0);
});

test('แก้การ์ด PDF เปลี่ยน url ไม่ได้ — ต้องชี้ไฟล์เดิมเสมอ', async () => {
  const before = await cardByTitle(PDF_CARD, 'teacher2');
  await ok('saveMediaCard', [{
    id: before.id, title: before.title, url: 'https://evil.example.com/แอบเปลี่ยน',
    icon: before.icon, color: before.color, group: before.group,
    visibleLevels: before.visibleLevels,
  }], 'teacher2');

  const after_ = await cardByTitle(PDF_CARD, 'teacher2');
  assert.equal(after_.url, before.url);
});

test('ลบการ์ด PDF → ไฟล์เข้าถังขยะ กู้คืนแล้วเปิดได้เหมือนเดิม', async () => {
  const card = await cardByTitle(PDF_CARD, 'teacher2');

  const del = await ok('deleteMediaCard', [card.id], 'teacher2');
  assert.equal(del.status, 'success');
  assert.match(del.message, /กู้คืนได้จากถังขยะ/);
  assert.ok(!(await ok('getMediaCards', [], 'admin')).some(c => c.id === card.id));
  await denied('getMediaFileTicket', [card.id], 'teacher2');

  const restored = await ok('restoreMediaCard', [card.id], 'admin');
  assert.equal(restored.message, 'กู้คืนการ์ดแล้ว', 'ไฟล์ยังอยู่ในถังขยะ ต้องกู้ได้สะอาด');

  const ticket = await ok('getMediaFileTicket', [card.id], 'teacher2');
  const file = await request(ticket.url);
  assert.equal(file.status, 200);
});
