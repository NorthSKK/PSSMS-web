'use strict';
/**
 * ที่เก็บไฟล์ — ตัวเลือก driver, การกวาดของหมดอายุ, และ s3 driver ส่วนที่ทดสอบได้โดยไม่ยิงเน็ต
 *
 * driver s3 เป็น path ที่ production ใช้แต่เทสต์อัตโนมัติไม่ครอบ (ไม่มี R2 ตอนรันเทส)
 * จึงล็อกเท่าที่ล็อกได้: การตรวจ key, รูปทรงของ presigned URL, และการปิดตัวเองเมื่อ env ไม่ครบ
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop, TOKENS } = require('./helpers/api');
const { query } = require('../lib/db');
const storage = require('../lib/storage');
const disk = require('../lib/storage/disk');
const s3 = require('../lib/storage/s3');
const mediaCards = require('../functions/mediaCards');

after(stop);

test('driver เริ่มต้นเป็น disk และเทสต์ทั้งชุดวิ่งบนตัวนี้', () => {
  assert.equal(storage.driverName(), 'disk');
  assert.equal(disk.isConfigured(), true, 'harness ตั้ง MEDIA_STORAGE_DIR ไว้ให้');
});

test('STORAGE_DRIVER ที่ไม่รู้จัก ตกกลับมาเป็น disk ไม่ใช่พัง', () => {
  const before = process.env.STORAGE_DRIVER;
  try {
    process.env.STORAGE_DRIVER = 'ยังไม่มี driver นี้';
    assert.equal(storage.driverName(), 'disk');
  } finally {
    if (before === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = before;
  }
});

test('s3 driver ปิดตัวเองเมื่อ env ไม่ครบ ไม่ใช่ throw ตอน boot', () => {
  assert.equal(s3.isConfigured(), false, 'เทสต์ไม่ได้ตั้ง S3_* ไว้');
});

test('s3 driver ปฏิเสธ key ที่ไม่ใช่รูปแบบของเรา — กันหลุดออกนอก bucket', async () => {
  for (const bad of ['../../etc/passwd', 'a.pdf', 'x'.repeat(32) + '.pdf', '']) {
    await assert.rejects(() => s3.getFileUrl({ key: bad }), /ชื่อไฟล์ไม่ถูกต้อง|ตั้งค่า S3/);
  }
});

test('s3 presigned URL มีลายเซ็น วันหมดอายุ และชื่อไฟล์', async () => {
  const env = { ...process.env };
  Object.assign(process.env, {
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    S3_BUCKET: 'pssms-test',
    S3_ACCESS_KEY_ID: 'testkey',
    S3_SECRET_ACCESS_KEY: 'testsecret',
    S3_REGION: 'auto',
  });
  try {
    const key = 'a'.repeat(32) + '.pdf';
    const url = await s3.getFileUrl({ key, filename: 'ใบงานที่ 1.pdf' });
    const u = new URL(url);

    assert.equal(u.host, 'acct.r2.cloudflarestorage.com');
    assert.ok(u.pathname.includes('pssms-test'), 'ต้องชี้ bucket ที่ตั้งไว้');
    assert.ok(u.searchParams.get('X-Amz-Signature'), 'ต้องมีลายเซ็น');
    assert.equal(u.searchParams.get('X-Amz-Expires'), String(s3.URL_TTL_SECONDS));
    assert.match(u.searchParams.get('response-content-disposition') || '', /filename\*=UTF-8/,
      'ชื่อไฟล์ภาษาไทยต้องส่งแบบ RFC 5987 ไม่งั้นดาวน์โหลดมาได้ชื่อเพี้ยน');
    // secret ต้องไม่หลุดไปกับ URL
    assert.ok(!url.includes('testsecret'), 'secret ต้องไม่โผล่ใน URL');
  } finally {
    for (const k of ['S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_REGION']) {
      if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k];
    }
  }
});

test('s3 driver เติม globalThis.crypto ให้ Node ที่ยังไม่เปิดเป็น global', () => {
  // Node < 19 ไม่มี globalThis.crypto → aws4fetch พังด้วย "crypto is not defined"
  // ตอนอัปโหลดเท่านั้น (เคยหลุดขึ้น production มาแล้ว เพราะ dev รัน Node ใหม่กว่า)
  assert.ok(globalThis.crypto, 'require lib/storage/s3.js แล้วต้องมี globalThis.crypto');
  assert.equal(typeof globalThis.crypto.subtle.sign, 'function');
});

test('disk driver ปฏิเสธ key ที่ไม่ใช่รูปแบบของเรา', () => {
  assert.throws(() => disk.safePath('../../etc/passwd'), /ชื่อไฟล์ไม่ถูกต้อง/);
  assert.doesNotThrow(() => disk.safePath('b'.repeat(32) + '.pdf'));
});

test('กวาดของหมดอายุ: ลบเฉพาะการ์ดที่เกิน 30 วัน และลบไฟล์ด้วย', async () => {
  const fresh = await disk.put({ buffer: Buffer.from('%PDF-1.4 old'), ext: 'pdf' });
  const keep = await disk.put({ buffer: Buffer.from('%PDF-1.4 keep'), ext: 'pdf' });

  const mk = async (title, deletedDaysAgo, key) => {
    const { rows } = await query(
      `INSERT INTO media_cards(title, card_type, url, file_key, file_name, file_size,
                               visible_levels, created_by, deleted_at)
       VALUES($1,'pdf','',$2,$3,10,'{}','teacher1', NOW() - ($4 || ' days')::interval)
       RETURNING id`,
      [title, key, title + '.pdf', String(deletedDaysAgo)]
    );
    return rows[0].id;
  };

  const expiredId = await mk('หมดอายุแล้ว', mediaCards.TRASH_DAYS + 1, fresh.key);
  const recentId = await mk('เพิ่งลบ', 1, keep.key);

  const res = await mediaCards.purgeExpiredCards({ log: () => {} });
  assert.ok(res.purged >= 1);
  assert.equal(res.failed, 0);

  const rows = await query(`SELECT id FROM media_cards WHERE id = ANY($1)`, [[expiredId, recentId]]);
  assert.deepEqual(rows.rows.map(r => r.id), [recentId], 'ต้องลบเฉพาะใบที่เกิน 30 วัน');

  assert.equal(disk.statSync(fresh.key), null, 'ไฟล์ของใบที่หมดอายุต้องถูกลบ');
  assert.ok(disk.statSync(keep.key), 'ไฟล์ของใบที่ยังไม่หมดอายุต้องอยู่');

  await query(`DELETE FROM media_cards WHERE id=$1`, [recentId]);
  await disk.remove(keep.key);
});

test('กวาดไฟล์ไม่สำเร็จ ต้องไม่ลบแถวทิ้ง — กันไฟล์กำพร้า', async () => {
  const { rows } = await query(
    `INSERT INTO media_cards(title, card_type, url, file_key, file_name, file_size,
                             visible_levels, created_by, deleted_at)
     VALUES('คีย์พัง','pdf','','คีย์ที่ไม่ถูกรูปแบบ','x.pdf',10,'{}','teacher1',
            NOW() - INTERVAL '90 days')
     RETURNING id`
  );
  const id = rows[0].id;

  const res = await mediaCards.purgeExpiredCards({ log: () => {} });
  assert.ok(res.failed >= 1, 'ลบไฟล์ไม่สำเร็จต้องนับเป็น failed');

  const still = await query(`SELECT id FROM media_cards WHERE id=$1`, [id]);
  assert.equal(still.rows.length, 1,
    'ลบไฟล์ไม่สำเร็จแล้วยังลบแถว = ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล');

  await query(`DELETE FROM media_cards WHERE id=$1`, [id]);
});

test('สถานะที่เก็บไฟล์รายงาน driver และนับจาก DB', async () => {
  const st = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(st.connected, true);
  assert.equal(st.driver, 'disk');
  assert.ok(st.files >= 1);
  assert.ok(st.usage > 0, 'ขนาดรวมมาจาก media_cards.file_size ไม่ได้ไปไล่ list ไฟล์');
});
