'use strict';
/**
 * สื่อการสอนเฟส 2 — อัปโหลด PDF ขึ้น Google Drive
 *
 * เทสต์ชุดนี้ไม่ยิง Google จริง (ไม่มี GOOGLE_OAUTH_* ตอนรันเทส) จึงครอบ 2 อย่าง:
 *   1. ด่านตรวจก่อนถึง Drive — สิทธิ์, ไฟล์ปลอม, การ์ดที่ไม่มีการเชื่อมต่อ
 *   2. พฤติกรรมตอนต่อ Drive ไม่ได้ ต้อง "ดัง" ไม่ใช่รายงานว่าสำเร็จ
 *      (บั๊กเดิมของ uploadSarabunFile คือขึ้น "สำเร็จ!" ทั้งที่ไฟล์หายไปเฉย ๆ)
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ok, denied, stop, TOKENS, baseURL } = require('./helpers/api');
const { looksLikePdf } = require('../routes/media');

after(stop);

const PDF_CARD = 'ใบความรู้หน่วยที่ 2 (PDF)';

async function cardByTitle(title, as = 'admin') {
  const cards = await ok('getMediaCards', [], as);
  const found = cards.find(c => c.title === title);
  assert.ok(found, `ไม่พบการ์ด "${title}" — seed-dev เปลี่ยนไปหรือเปล่า`);
  return found;
}

// ยิง multipart ตรงไป REST endpoint — shim google.script.run ส่ง binary ไม่ได้
async function uploadRaw({ token, filename = 'test.pdf', content = '%PDF-1.4 fake', payload = {} }) {
  const base = await baseURL();
  const boundary = '----pssmstest' + Date.now();
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ];
  const body = Buffer.from(parts.join(''), 'latin1');

  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  });
}

test('magic bytes: ยอมเฉพาะไฟล์ที่ขึ้นต้นด้วย %PDF-', () => {
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7\nstuff')), true);
  assert.equal(looksLikePdf(Buffer.from('<html>ไม่ใช่ pdf</html>')), false);
  assert.equal(looksLikePdf(Buffer.from('PK\x03\x04zipfile')), false);
  assert.equal(looksLikePdf(Buffer.from('')), false);
  assert.equal(looksLikePdf(null), false);
});

test('อัปโหลดโดยไม่มี token → 401', async () => {
  const res = await uploadRaw({ token: null });
  assert.equal(res.status, 401);
});

test('นักเรียนอัปโหลดไม่ได้ → 403', async () => {
  const res = await uploadRaw({ token: TOKENS.student });
  assert.equal(res.status, 403);
});

test('ยังไม่เชื่อม Drive → 503 พร้อมข้อความที่ครูอ่านรู้เรื่อง ไม่ใช่ success เงียบ ๆ', async () => {
  assert.ok(!process.env.GOOGLE_OAUTH_REFRESH_TOKEN, 'เทสต์นี้ต้องรันตอนยังไม่ตั้ง GOOGLE_OAUTH_*');
  const res = await uploadRaw({ token: TOKENS.teacher1, payload: { title: 'ทดสอบ' } });
  assert.equal(res.status, 503);
  assert.match(res.body.__error, /ยังไม่ได้เชื่อมต่อ Google Drive/);
  assert.match(res.body.__error, /ลิงก์ยังใช้ได้/, 'ต้องบอกว่าการ์ดแบบลิงก์ยังใช้ได้');
});

test('getMediaCardOptions บอก client ว่าอัปโหลดได้หรือยัง', async () => {
  const opts = await ok('getMediaCardOptions', [], 'teacher1');
  assert.equal(opts.uploadEnabled, false, 'ยังไม่เชื่อม Drive → ฟอร์มต้องปิดตัวเลือกอัปโหลด');
  assert.equal(opts.maxUploadMB, 25);
});

test('สถานะ Drive เป็นของ Admin และรายงานว่ายังไม่เชื่อมต่อ', async () => {
  await denied('getMediaStorageStatus', [], 'teacher1');
  const st = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(st.connected, false);
  assert.ok(st.reason, 'ต้องบอกเหตุผลให้ Admin เห็น');
});

test('การ์ด PDF ส่ง fileName/fileSize ให้ client', async () => {
  const card = await cardByTitle(PDF_CARD);
  assert.equal(card.cardType, 'pdf');
  assert.equal(card.fileName, 'ใบความรู้หน่วย2.pdf');
  assert.equal(card.fileSize, 1258291);
});

test('แก้การ์ด PDF เปลี่ยน url ไม่ได้ — ไฟล์ต้องยังเป็นไฟล์เดิมบน Drive', async () => {
  const before = await cardByTitle(PDF_CARD, 'teacher2');
  await ok('saveMediaCard', [{
    id: before.id, title: before.title, url: 'https://evil.example.com/แอบเปลี่ยน',
    icon: before.icon, color: before.color, group: before.group,
    visibleLevels: before.visibleLevels,
  }], 'teacher2');

  const after_ = await cardByTitle(PDF_CARD, 'teacher2');
  assert.equal(after_.url, before.url, 'url ของการ์ด PDF ต้องไม่ถูกทับจากฟอร์ม');
});

test('แก้ metadata ของการ์ด PDF ได้ตามปกติ', async () => {
  const card = await cardByTitle(PDF_CARD, 'teacher2');
  await ok('saveMediaCard', [{
    id: card.id, title: card.title, desc: 'คำอธิบายใหม่',
    icon: card.icon, color: card.color, group: card.group,
    visibleLevels: ['ม.2', 'ม.3'],
  }], 'teacher2');

  const updated = await cardByTitle(PDF_CARD, 'teacher2');
  assert.equal(updated.desc, 'คำอธิบายใหม่');
  assert.deepEqual(updated.visibleLevels, ['ม.2', 'ม.3']);
});

test('ลบการ์ด PDF ตอนต่อ Drive ไม่ได้ → การ์ดหายแต่ต้องบอกว่าไฟล์ยังไม่ถูกลบ', async () => {
  const card = await cardByTitle(PDF_CARD, 'teacher2');
  const res = await ok('deleteMediaCard', [card.id], 'teacher2');

  assert.equal(res.status, 'success');
  assert.match(res.message, /ลบไฟล์บน Google Drive ไม่สำเร็จ/,
    'ห้ามรายงานว่าลบสะอาดทั้งที่ไฟล์ยังกินโควตาอยู่');

  const cards = await ok('getMediaCards', [], 'admin');
  assert.ok(!cards.some(c => c.id === card.id), 'การ์ดต้องหายจากหน้ารวม');

  const restored = await ok('restoreMediaCard', [card.id], 'admin');
  assert.match(restored.message, /ไฟล์บน Google Drive กู้ไม่ได้/,
    'กู้คืนตอนต่อ Drive ไม่ได้ ต้องเตือนว่าลิงก์จะเสีย');
});
