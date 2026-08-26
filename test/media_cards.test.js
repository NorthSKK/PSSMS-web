'use strict';
/**
 * สื่อการสอน — เน้นกติกา "ใครเห็นการ์ดใบไหน"
 *
 * บั๊กที่แพงที่สุดของฟีเจอร์นี้คือนักเรียนเห็นเฉลย ซึ่งเป็นบั๊กเงียบ ไม่มีใครรายงาน
 * เทสต์ชุดนี้จึงล็อกการมองเห็นไว้ก่อนอย่างอื่น
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop, token } = require('./helpers/api');

after(stop);

// ตรงกับ db/seed-dev.js — 3 ใบครอบทุกกรณีของ visible_levels
const PUBLIC_CARD = 'สุขศึกษาและพลศึกษา ม.2';   // ทุกชั้น + ปักหมุด
const M2_CARD     = 'ใบงานสุขศึกษา ม.2';         // ม.2 อย่างเดียว, teacher2 เป็นเจ้าของ
const SECRET_CARD = 'เฉลยข้อสอบกลางภาค';        // ไม่ระบุชั้น = ครูเท่านั้น

const STUDENT_M2 = token({ id: '02001', role: 'Student' });
const STUDENT_M6 = token({ id: '01901', role: 'Student' });

const titles = (cards) => cards.map(c => c.title);

async function cardByTitle(title, as = 'admin') {
  const cards = await ok('getMediaCards', [], as);
  const found = cards.find(c => c.title === title);
  assert.ok(found, `ไม่พบการ์ด "${title}" — seed-dev เปลี่ยนไปหรือเปล่า`);
  return found;
}

test('ครูเห็นการ์ดครบทุกใบ รวมใบที่ไม่ระบุชั้น', async () => {
  const cards = await ok('getMediaCards', [], 'teacher1');
  const t = titles(cards);
  assert.ok(t.includes(PUBLIC_CARD));
  assert.ok(t.includes(M2_CARD));
  assert.ok(t.includes(SECRET_CARD), 'ครูต้องเห็นการ์ดที่ไม่ระบุชั้น');
});

test('การ์ดปักหมุดอยู่บนสุดเสมอ', async () => {
  const cards = await ok('getMediaCards', [], 'admin');
  assert.equal(cards[0].title, PUBLIC_CARD);
  assert.equal(cards[0].isFeatured, true);
});

test('นักเรียน ม.2 เห็นเฉพาะการ์ดของชั้นตัวเอง ไม่เห็นเฉลย', async () => {
  const cards = await ok('getMediaCards', [], STUDENT_M2);
  const t = titles(cards);
  assert.ok(t.includes(PUBLIC_CARD));
  assert.ok(t.includes(M2_CARD));
  assert.ok(!t.includes(SECRET_CARD), 'การ์ดที่ไม่ระบุชั้นต้องไม่หลุดถึงนักเรียน');
});

test('นักเรียน ม.6 ไม่เห็นการ์ดที่ระบุไว้เฉพาะ ม.2', async () => {
  const cards = await ok('getMediaCards', [], STUDENT_M6);
  const t = titles(cards);
  assert.ok(t.includes(PUBLIC_CARD));
  assert.ok(!t.includes(M2_CARD));
  assert.ok(!t.includes(SECRET_CARD));
});

test('การมองเห็นใช้ชั้นปัจจุบันจาก DB ไม่ใช่ dept ที่ค้างอยู่ใน JWT', async () => {
  // JWT อายุ 90 วัน เด็กเลื่อนชั้นแล้ว dept ใน token จะค้างชั้นเก่าเกือบ 3 เดือน
  const staleToken = token({ id: '01901', role: 'Student', dept: 'ม.2/1' });
  const cards = await ok('getMediaCards', [], staleToken);
  assert.ok(!titles(cards).includes(M2_CARD),
    'ถ้าเชื่อ dept ใน token นักเรียน ม.6 จะเห็นการ์ด ม.2');
});

test('นักเรียนเพิ่ม/ลบการ์ดไม่ได้', async () => {
  await denied('saveMediaCard', [{ title: 'ของนักเรียน', url: 'https://example.com' }], STUDENT_M2);
  const card = await cardByTitle(M2_CARD);
  await denied('deleteMediaCard', [card.id], STUDENT_M2);
});

test('ครูแก้/ลบการ์ดของครูคนอื่นไม่ได้', async () => {
  const card = await cardByTitle(M2_CARD); // เจ้าของคือ teacher2
  const msg = await denied('saveMediaCard',
    [{ id: card.id, title: 'แอบแก้', url: 'https://example.com' }], 'teacher1');
  assert.match(msg, /เฉพาะการ์ดที่ตัวเอง/);
  await denied('deleteMediaCard', [card.id], 'teacher1');
});

test('canEdit บอกสิทธิ์ตามเจ้าของ — Admin แก้ได้ทุกใบ', async () => {
  const asOwner = await cardByTitle(M2_CARD, 'teacher2');
  assert.equal(asOwner.canEdit, true);
  const asOther = await cardByTitle(M2_CARD, 'teacher1');
  assert.equal(asOther.canEdit, false);
  const asAdmin = await cardByTitle(M2_CARD, 'admin');
  assert.equal(asAdmin.canEdit, true);
});

test('ปฏิเสธ URL ที่ไม่ใช่ http/https', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ไม่ใช่ลิงก์']) {
    await denied('saveMediaCard', [{ title: 'ทดสอบ', url }], 'teacher1');
  }
});

test('ปฏิเสธ icon/color/กลุ่มสาระ นอก allowlist', async () => {
  const base = { title: 'ทดสอบ', url: 'https://example.com' };
  await denied('saveMediaCard', [{ ...base, icon: 'fa-evil" onload="alert(1)' }], 'teacher1');
  await denied('saveMediaCard', [{ ...base, color: 'red;background:url(x)' }], 'teacher1');
  await denied('saveMediaCard', [{ ...base, group: 'กลุ่มสาระที่ไม่มีจริง' }], 'teacher1');
});

test('ชื่อสื่อว่างบันทึกไม่ได้', async () => {
  await denied('saveMediaCard', [{ title: '   ', url: 'https://example.com' }], 'teacher1');
});

test('ครูปักหมุดการ์ดตัวเองไม่ได้ แต่ Admin ได้', async () => {
  const created = await ok('saveMediaCard',
    [{ title: 'ทดสอบปักหมุด', url: 'https://example.com', isFeatured: true }], 'teacher1');
  const card = await cardByTitle('ทดสอบปักหมุด');
  assert.equal(card.isFeatured, false, 'ครูต้องปักหมุดเองไม่ได้');

  await ok('saveMediaCard',
    [{ id: created.id, title: 'ทดสอบปักหมุด', url: 'https://example.com', isFeatured: true }], 'admin');
  assert.equal((await cardByTitle('ทดสอบปักหมุด')).isFeatured, true);

  await ok('deleteMediaCard', [created.id], 'admin');
});

test('การ์ดใหม่ที่ไม่เลือกชั้น นักเรียนต้องไม่เห็น', async () => {
  const created = await ok('saveMediaCard',
    [{ title: 'ค่าเริ่มต้นต้องเป็นครูเท่านั้น', url: 'https://example.com' }], 'teacher1');

  assert.ok(!titles(await ok('getMediaCards', [], STUDENT_M2))
    .includes('ค่าเริ่มต้นต้องเป็นครูเท่านั้น'));
  assert.ok(titles(await ok('getMediaCards', [], 'teacher1'))
    .includes('ค่าเริ่มต้นต้องเป็นครูเท่านั้น'));

  await ok('deleteMediaCard', [created.id], 'teacher1');
});

test('เลือกชั้นแล้วบันทึก เรียงตาม ม.1→ม.6 และตัดค่าที่ไม่รู้จักทิ้ง', async () => {
  const created = await ok('saveMediaCard', [{
    title: 'ทดสอบระดับชั้น', url: 'https://example.com',
    visibleLevels: ['ม.3', 'ม.1', 'ม.9', ''],
  }], 'teacher1');

  const card = await cardByTitle('ทดสอบระดับชั้น');
  assert.deepEqual(card.visibleLevels, ['ม.1', 'ม.3']);

  await ok('deleteMediaCard', [created.id], 'teacher1');
});

test('ลบแล้วหายจากหน้ารวม แต่ยังอยู่ในถังขยะและกู้คืนได้', async () => {
  const created = await ok('saveMediaCard',
    [{ title: 'ทดสอบลบ', url: 'https://example.com', visibleLevels: ['ม.2'] }], 'teacher1');

  await ok('deleteMediaCard', [created.id], 'teacher1');
  assert.ok(!titles(await ok('getMediaCards', [], 'admin')).includes('ทดสอบลบ'));
  assert.ok(!titles(await ok('getMediaCards', [], STUDENT_M2)).includes('ทดสอบลบ'));

  const trashed = await ok('getDeletedMediaCards', [], 'admin');
  assert.ok(titles(trashed).includes('ทดสอบลบ'));

  await ok('restoreMediaCard', [created.id], 'admin');
  assert.ok(titles(await ok('getMediaCards', [], 'admin')).includes('ทดสอบลบ'));

  await ok('deleteMediaCard', [created.id], 'admin');
});

test('ถังขยะและการกู้คืนเป็นของ Admin เท่านั้น', async () => {
  await denied('getDeletedMediaCards', [], 'teacher1');
  await denied('restoreMediaCard', [1], 'teacher1');
  await denied('getDeletedMediaCards', [], STUDENT_M2);
});

test('getMediaCardOptions ส่ง allowlist ชุดเดียวกับที่ server ใช้ตรวจ', async () => {
  const opts = await ok('getMediaCardOptions', [], 'teacher1');
  assert.deepEqual(opts.levels, ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6']);
  assert.ok(opts.icons.includes('fa-heart-pulse'));
  assert.ok(opts.colors.includes('#00897b'));
  assert.ok(opts.groups.includes('สุขศึกษาและพลศึกษา'));

  // สีของการ์ดที่ seed ไว้ต้องอยู่ในจาน ไม่งั้นแก้การ์ดนั้นแล้วบันทึกไม่ผ่าน
  const seeded = await cardByTitle(SECRET_CARD);
  assert.ok(opts.colors.includes(seeded.color));
});
