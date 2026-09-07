'use strict';
/**
 * สื่อการสอน — การ์ดใบเดียวหลายไฟล์ (โหมดอ่านแบบ ebook)
 *
 * จุดที่ต้องล็อกไว้:
 *   1. ด่านตรวจก่อนไฟล์ลงดิสก์ — สิทธิ์, ไฟล์ปลอม, เพดานต่อการ์ด, โควตาโรงเรียน
 *   2. ไฟล์ไม่ได้เปิดสาธารณะ — ต้องมีตั๋ว และ **ตั๋วผูกกับไฟล์ใบเดียว ใช้ข้ามใบไม่ได้**
 *   3. ⚠️ สิทธิ์ย้ายจาก "ตรวจที่การ์ด" เป็น "ตรวจที่ไฟล์แล้ว join กลับหาการ์ด"
 *      ซึ่งเป็นจุดที่หลุดง่ายสุดตอน refactor — ทั้งเรื่องระดับชั้นและเรื่องการ์ดในถังขยะ
 *   4. ล้มแล้วต้อง "ดัง" ไม่ใช่รายงานว่าสำเร็จ (บั๊กเดิมของ uploadSarabunFile)
 *      และล้มแล้วต้องไม่เหลือไฟล์กำพร้าบนที่เก็บ
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fsp = require('fs').promises;
const { ok, denied, stop, TOKENS, baseURL, token } = require('./helpers/api');
const { decodeFilename } = require('../routes/media');
const mediaCards = require('../functions/mediaCards');
const types = require('../lib/storage/types');
const store = require('../lib/storage/disk');
const storage = require('../lib/storage');
const { query } = require('../lib/db');

after(stop);

// การ์ดจาก seed-dev.js — ดู db/seed-dev.js หัวข้อ mkFileCard
const FILE_CARD = 'ใบความรู้หน่วยที่ 2 (PDF)';        // 3 ไฟล์ · เปิดให้ ม.2 · teacher2
const STAFF_CARD = 'เฉลยใบงานหน่วยที่ 2 (PDF)';       // 1 ไฟล์ · ครูเท่านั้น · teacher2
const EMPTY_CARD = 'ชุดสื่อที่ยังไม่ได้อัปไฟล์';           // 0 ไฟล์ · เปิดให้ ม.2 · teacher2

const STUDENT_M2 = token({ id: '02001', role: 'Student' });
const STUDENT_M6 = token({ id: '01901', role: 'Student' });

const PDF = '%PDF-1.4\nเนื้อหาทดสอบ\n%%EOF';
// PNG ที่สั้นที่สุดที่ยังผ่าน magic bytes — พอสำหรับตรวจว่าการ์ดรับรูปได้จริง
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png'),
]);

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
function uploadRaw({ token: tok, cardId = 1, filename = 'test.pdf', content = PDF,
                     mime = 'application/pdf' } = {}) {
  const boundary = '----pssmstest' + Date.now() + Math.random().toString(16).slice(2);
  // utf8 ไม่ใช่ latin1 — ชื่อไฟล์ภาษาไทย latin1 จะทำ header เพี้ยนจน multer ปฏิเสธ
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
      `filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8'),
    Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  return request(`/api/media/upload/${cardId}`, {
    method: 'POST', token: tok, body,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
}

/** สร้างการ์ด files เปล่าไว้ให้เทสต์เล่น — คืน id */
async function newFileCard(title, as = 'teacher1', levels = ['ม.6']) {
  const res = await ok('saveMediaCard', [{
    title, cardType: 'files', group: 'คณิตศาสตร์', visibleLevels: levels,
  }], as);
  assert.equal(res.cardType, 'files');
  return res.id;
}

/** จำนวนไฟล์จริงบนดิสก์ — ใช้ยืนยันว่าไม่มีของกำพร้าค้างหลังเคสที่ต้องล้มเหลว */
async function diskCount() {
  const files = await fsp.readdir(store.ROOT).catch(() => []);
  return files.filter(f => types.isValidKey(f)).length;
}

const ticketId = (url) => new URL('http://x' + url).pathname.split('/').pop();
const ticketToken = (url) => new URL('http://x' + url).searchParams.get('t');

/** getMediaCardFiles คืน { files, url, fileId } — เทสต์ส่วนใหญ่สนใจแค่สารบัญ */
const filesOf = async (cardId, as, want) =>
  (await ok('getMediaCardFiles', want === undefined ? [cardId] : [cardId, want], as)).files;

test('ไฟล์พักถูกลบหลังอัปสำเร็จ ไฟล์ปลอม ไม่มีสิทธิ์ และที่เก็บล้มเหลว', async (t) => {
  const tempDir = require('path').join(require('os').tmpdir(), 'pssms-upload');
  const tempFiles = async () => (await fsp.readdir(tempDir).catch(e => {
    if (e.code === 'ENOENT') return [];
    throw e;
  })).sort();
  const before = await tempFiles();
  const assertClean = async () => {
    // HTTP response อาจมาถึงก่อน finally ของ route ลบไฟล์เสร็จ
    for (let i = 0; i < 100; i++) {
      if (JSON.stringify(await tempFiles()) === JSON.stringify(before)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(await tempFiles(), before, 'ต้องไม่เหลือไฟล์พักหลัง request จบ');
  };
  const cardId = await newFileCard('ตรวจไฟล์พัก');
  try {
    const uploaded = await uploadRaw({ token: TOKENS.teacher1, cardId });
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    await assertClean();
    const files = await filesOf(cardId, 'teacher1');
    const ticket = await ok('getMediaFileTicket', [files[0].id], 'teacher1');
    assert.deepEqual((await request(ticket.url)).raw, Buffer.from(PDF), 'ไฟล์ต้องครบทุกไบต์');
    for (const opts of [
      { token: TOKENS.teacher1, content: 'ไม่ใช่ PDF' },
      { token: TOKENS.teacher2 },
    ]) {
      assert.equal((await uploadRaw({ cardId, ...opts })).status, 400);
      await assertClean();
    }
    // ผูกกับค่าคงที่ ไม่ใช่เลข 25 ที่เคยเขียนไว้ตายตัว — ขยับเพดานแล้วเทสต์ต้องขยับตาม
    // ไม่ใช่ผ่านต่อไปเพราะไฟล์ที่ยิงยังใหญ่เกินเพดานเก่าอยู่ดี
    const oversized = Buffer.alloc(mediaCards.MAX_UPLOAD_MB * 1024 * 1024 + 1);
    oversized.write('%PDF-1.4');
    const tooBig = await uploadRaw({ token: TOKENS.teacher1, cardId, content: oversized });
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.body.__error, new RegExp(`${mediaCards.MAX_UPLOAD_MB} MB`));
    await assertClean();
    t.mock.method(storage, 'putStream', async ({ stream, size }) => {
      assert.equal(size, Buffer.byteLength(PDF));
      assert.equal(typeof stream.pipe, 'function', 'ต้องส่ง stream ไปที่เก็บ');
      throw new Error('ที่เก็บทดสอบล้มเหลว');
    });
    const failed = await uploadRaw({ token: TOKENS.teacher1, cardId });
    assert.equal(failed.status, 400);
    assert.match(failed.body.__error, /ที่เก็บทดสอบล้มเหลว/);
    await assertClean();
    assert.equal((await filesOf(cardId, 'teacher1')).length, 1, 'อัปไม่สำเร็จต้องไม่เพิ่มแถวไฟล์');
  } finally {
    await ok('deleteMediaCard', [cardId], 'teacher1');
  }
});

test('ตัดการเชื่อมต่อกลาง multipart ต้องลบไฟล์พักและไม่เพิ่มแถวไฟล์', { timeout: 5000 }, async () => {
  const tempDir = require('path').join(require('os').tmpdir(), 'pssms-upload');
  await fsp.mkdir(tempDir, { recursive: true });
  const before = (await fsp.readdir(tempDir)).sort();
  const cardId = await newFileCard('อัปโหลดขาดกลางทาง');
  const boundary = '----pssms-aborted-upload';
  const req = http.request(`${await baseURL()}/api/media/upload/${cardId}`, {
    method: 'POST', headers: {
      Authorization: `Bearer ${TOKENS.teacher1}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  req.on('error', () => {}); // ECONNRESET เป็นผลที่ตั้งใจจากการตัดสาย
  try {
    req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
    let started = false;
    for (let i = 0; i < 100; i++) {
      if ((await fsp.readdir(tempDir)).some(f => !before.includes(f))) { started = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(started, 'ต้องเริ่มพักไฟล์จริงก่อนตัดสาย');
    req.destroy();
    for (let i = 0; i < 100; i++) {
      if (JSON.stringify((await fsp.readdir(tempDir)).sort()) === JSON.stringify(before)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual((await fsp.readdir(tempDir)).sort(), before);
    assert.equal((await filesOf(cardId, 'teacher1')).length, 0);
  } finally {
    req.destroy();
    await ok('deleteMediaCard', [cardId], 'teacher1');
  }
});

// ---------------------------------------------------------------- ด่านตรวจขาเข้า

test('ชนิดไฟล์ตัดสินจาก magic bytes ไม่ใช่ MIME หรือนามสกุล', () => {
  assert.equal(types.detect(Buffer.from('%PDF-1.7 ...'), ['pdf']).ext, 'pdf');
  assert.equal(types.detect(Buffer.from('<html>ไม่ใช่ PDF</html>'), ['pdf']), null);
  assert.equal(types.detect(PNG, ['pdf', 'jpg', 'png']).ext, 'png');
  // docx เป็น zip จริง แต่การ์ดสื่อไม่รับ — เสิร์ฟเป็น attachment เปิดในหน้าเดิมไม่ได้
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  assert.equal(types.detect(zip, ['pdf', 'jpg', 'png']), null);
  assert.equal(types.detect(zip, types.EXTENSIONS).ext, 'docx');
});

test('ชื่อไฟล์ภาษาไทยจาก multipart ต้องไม่เพี้ยน', () => {
  const thai = 'ใบความรู้.pdf';
  const mojibake = Buffer.from(thai, 'utf8').toString('latin1');
  assert.equal(decodeFilename(mojibake), thai);
  assert.equal(decodeFilename('worksheet.pdf'), 'worksheet.pdf', 'ชื่อ ASCII ต้องไม่ถูกแตะ');
});

test('ชื่อไฟล์บนดิสก์ต้องเป็น hex ล้วน — กัน path traversal', () => {
  assert.throws(() => store.safePath('../../etc/passwd'), /ชื่อไฟล์ไม่ถูกต้อง/);
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

test('ไฟล์ที่ไม่ใช่ชนิดที่รับ ถูกปฏิเสธ แม้ MIME จะบอกว่าเป็น PDF', async () => {
  const cardId = await newFileCard('การ์ดตรวจไฟล์ปลอม');
  const before = await diskCount();

  const res = await uploadRaw({
    token: TOKENS.teacher1, cardId, content: '<html>ปลอม</html>',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.__error, /รองรับเฉพาะไฟล์ PDF/);
  assert.equal(await diskCount(), before, 'ตรวจชนิดต้องเกิดก่อนเขียนไฟล์ลงดิสก์');

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

test('แนบไฟล์เข้าการ์ดของครูคนอื่น หรือการ์ดแบบลิงก์ ไม่ได้', async () => {
  const before = await diskCount();

  const mine = await cardByTitle(FILE_CARD);          // เจ้าของคือ teacher2
  const cross = await uploadRaw({ token: TOKENS.teacher1, cardId: mine.id });
  assert.equal(cross.status, 400);
  assert.match(cross.body.__error, /เฉพาะการ์ดที่ตัวเองเพิ่ม/);

  const linkCard = await cardByTitle('ใบงานสุขศึกษา ม.2');  // card_type = link
  const wrongType = await uploadRaw({ token: TOKENS.teacher2, cardId: linkCard.id });
  assert.equal(wrongType.status, 400);
  assert.match(wrongType.body.__error, /แบบลิงก์/);

  assert.equal(await diskCount(), before, 'ตรวจสิทธิ์ต้องเกิดก่อนเขียนไฟล์ลงดิสก์');
});

// ---------------------------------------------------------------- หลายไฟล์ในการ์ดเดียว

test('อัปหลายไฟล์เข้าการ์ดเดียว แล้วเปิดได้ครบทุกใบ', async () => {
  const cardId = await newFileCard('ชุดสื่อจากเทส');

  const a = await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'บทที่1.pdf' });
  const b = await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'บทที่2.pdf' });
  const c = await uploadRaw({
    token: TOKENS.teacher1, cardId, filename: 'แผนภาพ.png', content: PNG, mime: 'image/png',
  });
  for (const r of [a, b, c]) assert.equal(r.status, 200, JSON.stringify(r.body));

  const files = await filesOf(cardId, 'teacher1');
  assert.equal(files.length, 3);
  assert.deepEqual(files.map(f => f.label), ['บทที่1.pdf', 'บทที่2.pdf', 'แผนภาพ.png'],
    'เรียงตามลำดับที่อัป และ label ว่างต้องตกกลับไปใช้ชื่อไฟล์');
  assert.deepEqual(files.map(f => f.ext), ['pdf', 'pdf', 'png'],
    'client ใช้ ext ตัดสินว่าจะเรนเดอร์ด้วย iframe หรือ img');

  for (const f of files) {
    const ticket = await ok('getMediaFileTicket', [f.id], 'teacher1');
    const got = await request(ticket.url);
    assert.equal(got.status, 200);
    assert.match(got.headers['cache-control'], /private/, 'ห้าม proxy/CDN เก็บไปแจกต่อ');
    const proxied = await request(ticket.proxyUrl);
    assert.equal(proxied.status, 200, 'ตัวอ่าน PDF ต้องอ่านผ่าน origin ของเว็บได้ แม้ S3 ไม่มี CORS');
  }

  const card = await cardByTitle('ชุดสื่อจากเทส', 'teacher1');
  assert.equal(card.fileCount, 3, 'หน้ารวมส่งจำนวนไฟล์');
  assert.ok(card.totalSize > 0, 'หน้ารวมส่งขนาดรวม');
  assert.equal(card.url, '', 'การ์ด files ไม่เก็บ url — ลิงก์ออกใหม่ทุกครั้งที่ขอ');
  assert.equal(Object.hasOwn(card, 'files'), false, 'หน้ารวมต้องไม่แบกสารบัญมาด้วย');

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

test('การ์ด files ที่ยังไม่มีไฟล์ — ครูเห็น นักเรียนไม่เห็น', async () => {
  const staff = await ok('getMediaCards', [], 'admin');
  assert.ok(staff.some(c => c.title === EMPTY_CARD), 'ครูต้องเห็นการ์ดที่ค้างไว้');

  const student = await ok('getMediaCards', [], STUDENT_M2);
  assert.ok(!student.some(c => c.title === EMPTY_CARD),
    'นักเรียนกดแล้วเจอความว่างเปล่า — ต้องกรองที่ SQL ไม่ใช่ซ่อนฝั่ง client');
  assert.ok(student.some(c => c.title === FILE_CARD), 'การ์ดที่มีไฟล์ต้องยังเห็นอยู่');
});

// ---------------------------------------------------------------- ตั๋วกับสิทธิ์

test('เปิดไฟล์โดยไม่มีตั๋ว หรือตั๋วของไฟล์อื่น → ไม่ผ่าน', async () => {
  const card = await cardByTitle(FILE_CARD);
  const files = await filesOf(card.id, 'admin');
  const [first, second] = files;

  const noTicket = await request(`/api/media/file/media/${first.id}`);
  assert.equal(noTicket.status, 401, 'ไฟล์ต้องไม่เปิดสาธารณะ');

  const junk = await request(`/api/media/file/media/${first.id}?t=ไม่ใช่ตั๋ว`);
  assert.equal(junk.status, 401);

  // ตั๋วของไฟล์อื่น — **ในการ์ดใบเดียวกันด้วย** ต้องใช้ข้ามใบไม่ได้
  const ticket = await ok('getMediaFileTicket', [second.id], 'admin');
  const crossed = await request(
    `/api/media/file/media/${first.id}?t=${encodeURIComponent(ticketToken(ticket.url))}`
  );
  assert.equal(crossed.status, 403, 'ตั๋วผูกกับไฟล์ใบเดียว ข้ามใบในการ์ดเดียวกันก็ไม่ได้');
  assert.equal(ticketId(ticket.url), String(second.id), 'ตั๋วต้องอ้าง media_files.id');
});

test('สารบัญต้องพกตั๋วของไฟล์ที่จะเปิดมาด้วยในรอบเดียว', async () => {
  const card = await cardByTitle(FILE_CARD);
  const files = await filesOf(card.id, 'admin');

  // ไม่บอกว่าจะเปิดไฟล์ไหน = ไฟล์แรกในสารบัญ
  const first = await ok('getMediaCardFiles', [card.id], 'admin');
  assert.equal(first.fileId, files[0].id);
  assert.ok(first.url, 'ไม่มีตั๋วมาด้วย = client ต้องยิงรอบสองก่อนไฟล์จะเริ่มโหลด');
  assert.equal((await request(first.url)).status, 200, 'ตั๋วที่แนบมาต้องใช้ได้จริง');

  // บอกไฟล์ที่ค้างอ่านไว้ = ได้ตั๋วของใบนั้น ไม่ใช่ใบแรก
  const resumed = await ok('getMediaCardFiles', [card.id, files[2].id], 'admin');
  assert.equal(resumed.fileId, files[2].id);
  assert.equal(ticketId(resumed.url), String(files[2].id));

  // ไฟล์ที่ไม่ได้อยู่ในการ์ดนี้ (หรือถูกลบไปแล้ว) ต้องตกกลับไปไฟล์แรก ไม่ใช่พังหรือออกตั๋วให้
  const bogus = await ok('getMediaCardFiles', [card.id, 999999], 'admin');
  assert.equal(bogus.fileId, files[0].id);
});

test('นักเรียนขอสารบัญได้ ต้องได้ตั๋วที่เปิดได้จริงมาด้วย', async () => {
  const card = await cardByTitle(FILE_CARD);          // เปิดให้ ม.2
  const res = await ok('getMediaCardFiles', [card.id], STUDENT_M2);
  assert.ok(res.files.length > 0);
  assert.equal((await request(res.url)).status, 200);
  // ตั๋วที่แนบมากับสารบัญต้องผ่านด่านสิทธิ์เดียวกับตอนขอทีละใบ ไม่ใช่ทางลัด
  await denied('getMediaCardFiles', [card.id], STUDENT_M6);
});

test('ตั๋วของไฟล์ในการ์ดที่นักเรียนไม่มีสิทธิ์เห็น → ไม่ผ่าน', async () => {
  const open = await cardByTitle(FILE_CARD);     // เปิดให้ ม.2
  const staffOnly = await cardByTitle(STAFF_CARD); // visible_levels ว่าง = ครูเท่านั้น

  const openFiles = await filesOf(open.id, 'admin');
  const secretFiles = await filesOf(staffOnly.id, 'admin');

  // ม.6 ขอไฟล์ของการ์ด ม.2 ไม่ได้ · ม.2 ขอได้
  await denied('getMediaFileTicket', [openFiles[0].id], STUDENT_M6);
  const allowed = await ok('getMediaFileTicket', [openFiles[0].id], STUDENT_M2);
  assert.match(allowed.url, /^\/api\/media\/file\/media\/\d+\?t=/);

  // การ์ด "ครูเท่านั้น" — ไม่มีนักเรียนคนไหนขอได้ ทั้งตัวไฟล์และสารบัญ
  await denied('getMediaFileTicket', [secretFiles[0].id], STUDENT_M2);
  await denied('getMediaFileTicket', [secretFiles[0].id], STUDENT_M6);
  await denied('getMediaCardFiles', [staffOnly.id], STUDENT_M2);
});

test('ตั๋วที่ออกไว้ก่อน ใช้ไม่ได้เมื่อการ์ดถูกย้ายลงถังขยะ', async () => {
  const cardId = await newFileCard('การ์ดที่จะโดนลบ');
  await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'ชั่วคราว.pdf' });
  const [file] = await filesOf(cardId, 'teacher1');

  const ticket = await ok('getMediaFileTicket', [file.id], 'teacher1');
  assert.equal((await request(ticket.url)).status, 200);

  await ok('deleteMediaCard', [cardId], 'teacher1');

  // ตั๋วเดิมยังไม่หมดอายุ (1 ชม.) แต่ต้องเปิดไม่ได้แล้ว — สิทธิ์อยู่ที่การ์ดแม่ ไม่ใช่ที่ตั๋ว
  assert.equal((await request(ticket.url)).status, 404);
  await denied('getMediaFileTicket', [file.id], 'teacher1');
  await denied('getMediaCardFiles', [cardId], 'teacher1');
});

// ---------------------------------------------------------------- จัดการไฟล์ในการ์ด

test('ลบไฟล์เดี่ยว — ไฟล์หายจริงทันที การ์ดกับไฟล์ใบอื่นยังอยู่', async () => {
  const cardId = await newFileCard('การ์ดลบทีละไฟล์');
  await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'เก็บไว้.pdf' });
  await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'จะลบ.pdf' });

  const before = await filesOf(cardId, 'teacher1');
  const target = before.find(f => f.label === 'จะลบ.pdf');
  const { rows } = await query(`SELECT file_key FROM media_files WHERE id=$1`, [target.id]);
  const key = rows[0].file_key;

  // ครูคนอื่นแตะไม่ได้ (สิทธิ์ตรวจที่การ์ดแม่)
  await denied('deleteMediaFile', [target.id], 'teacher2');

  await ok('deleteMediaFile', [target.id], 'teacher1');
  const after_ = await filesOf(cardId, 'teacher1');
  assert.deepEqual(after_.map(f => f.label), ['เก็บไว้.pdf']);
  assert.equal(store.statSync(key), null, 'ลบจริงทันที ไม่มีถังขยะระดับไฟล์');
  assert.ok(await cardByTitle('การ์ดลบทีละไฟล์', 'teacher1'), 'การ์ดต้องยังอยู่');

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

test('ตั้งชื่อในสารบัญได้ · ล้างชื่อแล้วกลับไปใช้ชื่อไฟล์เดิม', async () => {
  const cardId = await newFileCard('การ์ดตั้งชื่อ');
  await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'IMG_20260901.pdf' });
  const [file] = await filesOf(cardId, 'teacher1');
  assert.equal(file.label, 'IMG_20260901.pdf');

  await denied('renameMediaFile', [file.id, 'แอบแก้'], 'teacher2');

  await ok('renameMediaFile', [file.id, 'บทที่ 1 — บทนำ'], 'teacher1');
  assert.equal((await filesOf(cardId, 'teacher1'))[0].label, 'บทที่ 1 — บทนำ');

  await ok('renameMediaFile', [file.id, '  '], 'teacher1');
  assert.equal((await filesOf(cardId, 'teacher1'))[0].label, 'IMG_20260901.pdf');

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

test('เรียงลำดับใหม่ได้ · ส่ง id ไม่ครบหรือมีของแปลกปลอม → ปฏิเสธทั้งชุด', async () => {
  const cardId = await newFileCard('การ์ดเรียงลำดับ');
  for (const n of ['ก.pdf', 'ข.pdf', 'ค.pdf']) {
    await uploadRaw({ token: TOKENS.teacher1, cardId, filename: n });
  }
  const files = await filesOf(cardId, 'teacher1');
  const ids = files.map(f => f.id);

  await denied('reorderMediaFiles', [cardId, [ids[2], ids[0], ids[1]]], 'teacher2');
  // ไม่ครบ / ซ้ำ / มีของการ์ดอื่น — ทุกกรณีต้องไม่เขียนอะไรเลย
  await denied('reorderMediaFiles', [cardId, [ids[0], ids[1]]], 'teacher1');
  await denied('reorderMediaFiles', [cardId, [ids[0], ids[0], ids[1]]], 'teacher1');
  await denied('reorderMediaFiles', [cardId, [ids[0], ids[1], 999999]], 'teacher1');
  assert.deepEqual((await filesOf(cardId, 'teacher1')).map(f => f.id), ids,
    'คำขอที่ถูกปฏิเสธต้องไม่ทิ้งลำดับครึ่ง ๆ กลาง ๆ ไว้');

  await ok('reorderMediaFiles', [cardId, [ids[2], ids[0], ids[1]]], 'teacher1');
  assert.deepEqual((await filesOf(cardId, 'teacher1')).map(f => f.label),
    ['ค.pdf', 'ก.pdf', 'ข.pdf']);

  await ok('deleteMediaCard', [cardId], 'teacher1');
});

// ---------------------------------------------------------------- เพดานและโควตา

test('เกินเพดานไฟล์ต่อการ์ด → ปฏิเสธ และไม่มีไฟล์กำพร้า', async () => {
  const mediaCards = require('../functions/mediaCards');
  const cardId = await newFileCard('การ์ดชนเพดาน');
  // ยัดแถวตรง ๆ ให้ถึงเพดาน — อัปจริง 50 ครั้งแค่เพื่อทดสอบตัวนับคือเสียเวลาเปล่า
  for (let i = 0; i < mediaCards.MAX_FILES_PER_CARD; i++) {
    await query(
      `INSERT INTO media_files(card_id,file_key,file_name,file_size,sort_order)
       VALUES($1,$2,$3,1,$4)`,
      [cardId, 'f'.repeat(32) + '.pdf', `เดิม${i}.pdf`, i]
    );
  }
  const before = await diskCount();

  const res = await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'ใบที่เกิน.pdf' });
  assert.equal(res.status, 400);
  assert.match(res.body.__error, /ไม่เกิน 50 ไฟล์/);
  assert.equal(await diskCount(), before, 'นับเพดานต้องเกิดก่อนเขียนไฟล์ลงดิสก์');

  await query(`DELETE FROM media_files WHERE card_id=$1`, [cardId]);
  await query(`DELETE FROM media_cards WHERE id=$1`, [cardId]);
});

test('พื้นที่ของโรงเรียนเต็ม → 507 และไม่มีไฟล์กำพร้า', async () => {
  const cardId = await newFileCard('การ์ดโควตาเต็ม');
  const before = await diskCount();
  const saved = process.env.MEDIA_QUOTA_GB;
  // ~1 ไบต์ — เล็กกว่าที่ seed ใช้ไปแล้ว จึงเต็มตั้งแต่ไฟล์แรกไม่ว่าเทสต์ก่อนหน้าจะทิ้งอะไรไว้
  process.env.MEDIA_QUOTA_GB = '0.000000001';
  try {
    const res = await uploadRaw({ token: TOKENS.teacher1, cardId, filename: 'ล้น.pdf' });
    assert.equal(res.status, 507, 'ครูแก้เองได้ (ไปลบของเก่า) จึงไม่ใช่ 400');
    assert.match(res.body.__error, /พื้นที่เก็บไฟล์ของโรงเรียนเต็ม/);
    assert.equal(await diskCount(), before, 'เช็คโควตาต้องเกิดก่อนเขียนไฟล์ลงดิสก์');
  } finally {
    if (saved === undefined) delete process.env.MEDIA_QUOTA_GB;
    else process.env.MEDIA_QUOTA_GB = saved;
  }
  await ok('deleteMediaCard', [cardId], 'teacher1');
});

// ---------------------------------------------------------------- ถังขยะ / สถานะ

test('แก้การ์ด files เปลี่ยน url ไม่ได้ — การ์ดชนิดนี้ไม่มี url ให้ชี้', async () => {
  const before = await cardByTitle(FILE_CARD, 'teacher2');
  await ok('saveMediaCard', [{
    id: before.id, title: before.title, url: 'https://evil.example.com/แอบเปลี่ยน',
    icon: before.icon, color: before.color, group: before.group,
    visibleLevels: before.visibleLevels,
  }], 'teacher2');

  const after_ = await cardByTitle(FILE_CARD, 'teacher2');
  assert.equal(after_.url, '');
  assert.equal(after_.cardType, 'files');
});

test('สถานะที่เก็บไฟล์เป็นของ Admin และรายงานโควตาด้วย', async () => {
  await denied('getMediaStorageStatus', [], 'teacher1');
  const st = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(st.connected, true);
  assert.ok(st.files >= 4, 'นับจาก media_files ไม่ใช่จำนวนการ์ด');
  assert.ok(st.quota > 0, 'Admin ต้องเห็นเพดาน ไม่ใช่เห็นแค่ยอดที่ใช้ไป');
});

test('ลบการ์ดที่มีหลายไฟล์ → เข้าถังขยะ กู้คืนแล้วเปิดได้ครบทุกใบ', async () => {
  const card = await cardByTitle(FILE_CARD, 'teacher2');
  const files = await filesOf(card.id, 'teacher2');
  assert.equal(files.length, 3);

  const del = await ok('deleteMediaCard', [card.id], 'teacher2');
  assert.match(del.message, /กู้คืนได้จากถังขยะ/);
  assert.ok(!(await ok('getMediaCards', [], 'admin')).some(c => c.id === card.id));

  // ถังขยะยังต้องรายงานว่าการ์ดใบนี้มีกี่ไฟล์ — Admin ตัดสินใจกู้คืนจากตรงนั้น
  const trashed = (await ok('getDeletedMediaCards', [], 'admin')).find(c => c.id === card.id);
  assert.equal(trashed.fileCount, 3);

  await ok('restoreMediaCard', [card.id], 'admin');
  for (const f of files) {
    const ticket = await ok('getMediaFileTicket', [f.id], 'teacher2');
    assert.equal((await request(ticket.url)).status, 200,
      'ลบการ์ดไม่แตะไฟล์ กู้คืนแล้วต้องเปิดได้ครบ ไม่ใช่ได้การ์ดที่เปิดไม่ได้');
  }
});
