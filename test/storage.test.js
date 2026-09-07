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
const { Readable } = require('stream');
const fs = require('fs').promises;

after(stop);

test('disk stream เก็บไบต์ครบและลบไฟล์ที่เขียนค้างเมื่อ stream พัง', async () => {
  const content = Buffer.from('%PDF-1.4 stream test');
  const saved = await disk.putStream({ stream: Readable.from([content]), ext: 'pdf' });
  try {
    assert.equal(saved.size, content.length);
    assert.deepEqual(await fs.readFile(disk.safePath(saved.key)), content);
  } finally {
    await disk.remove(saved.key);
  }
  const before = (await fs.readdir(disk.ROOT)).sort();
  const broken = Readable.from((async function* () {
    yield content;
    throw new Error('source stream failed');
  })());
  await assert.rejects(disk.putStream({ stream: broken, ext: 'pdf' }), /source stream failed/);
  assert.deepEqual((await fs.readdir(disk.ROOT)).sort(), before);
});

test('s3 stream ส่ง signed request พร้อมขนาดจริง และไม่ retry stream ที่ใช้ไปแล้ว', async (t) => {
  const keys = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION'];
  const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', S3_BUCKET: 'pssms-test',
    S3_ACCESS_KEY_ID: 'testkey', S3_SECRET_ACCESS_KEY: 'testsecret', S3_REGION: 'auto',
  });
  const content = Buffer.from('%PDF-1.4 streaming upload');
  let status = 200;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    assert.equal(req.method, 'PUT');
    assert.equal(req.headers.get('content-length'), String(content.length));
    assert.equal(req.headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
    assert.match(req.headers.get('authorization'), /^AWS4-HMAC-SHA256 /);
    assert.deepEqual(Buffer.from(await req.arrayBuffer()), content);
    return new Response(status === 200 ? '' : 'temporary storage failure', { status });
  });
  try {
    const saved = await s3.putStream({ stream: Readable.from([content]), size: content.length, ext: 'pdf' });
    assert.equal(saved.size, content.length);
    assert.match(saved.key, /^[a-f0-9]{32}\.pdf$/);
    status = 503;
    await assert.rejects(s3.putStream({
      stream: Readable.from([content]), size: content.length, ext: 'pdf',
    }), /503/);
    assert.equal(fetchMock.mock.callCount(), 2, 'แต่ละอัปโหลดส่งครั้งเดียว แม้ปลายทางตอบ 503');
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k];
    }
  }
});

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

test('กวาดของหมดอายุ: ลบเฉพาะการ์ดที่เกิน 30 วัน และลบไฟล์ทุกใบในการ์ดนั้น', async () => {
  const mk = async (title, deletedDaysAgo, count) => {
    const { rows } = await query(
      `INSERT INTO media_cards(title, card_type, url, visible_levels, created_by, deleted_at)
       VALUES($1,'files','','{}','teacher1', NOW() - ($2 || ' days')::interval)
       RETURNING id`,
      [title, String(deletedDaysAgo)]
    );
    const keys = [];
    for (let i = 0; i < count; i++) {
      const saved = await disk.put({ buffer: Buffer.from(`%PDF-1.4 ${title} ${i}`), ext: 'pdf' });
      await query(
        `INSERT INTO media_files(card_id,file_key,file_name,file_size,sort_order)
         VALUES($1,$2,$3,$4,$5)`,
        [rows[0].id, saved.key, `${title}-${i}.pdf`, saved.size, i]
      );
      keys.push(saved.key);
    }
    return { id: rows[0].id, keys };
  };

  // การ์ดใบเดียวหลายไฟล์ — ต้องลบ object ครบทุกใบ ไม่ใช่แค่ใบแรก
  const expired = await mk('หมดอายุแล้ว', mediaCards.TRASH_DAYS + 1, 3);
  const recent = await mk('เพิ่งลบ', 1, 1);

  const res = await mediaCards.purgeExpiredCards({ log: () => {} });
  assert.ok(res.purged >= 1);
  assert.equal(res.failed, 0);

  const rows = await query(`SELECT id FROM media_cards WHERE id = ANY($1)`,
    [[expired.id, recent.id]]);
  assert.deepEqual(rows.rows.map(r => r.id), [recent.id], 'ต้องลบเฉพาะใบที่เกิน 30 วัน');

  for (const k of expired.keys) {
    assert.equal(disk.statSync(k), null, 'ไฟล์ทุกใบของการ์ดที่หมดอายุต้องถูกลบ');
  }
  assert.ok(disk.statSync(recent.keys[0]), 'ไฟล์ของใบที่ยังไม่หมดอายุต้องอยู่');
  const left = await query(`SELECT count(*)::int AS n FROM media_files WHERE card_id=$1`,
    [expired.id]);
  assert.equal(left.rows[0].n, 0, 'แถวไฟล์ต้องหายไปพร้อมกัน');

  await query(`DELETE FROM media_cards WHERE id=$1`, [recent.id]);
  await disk.remove(recent.keys[0]);
});

test('กวาดไฟล์ไม่สำเร็จ ต้องไม่ลบแถวทิ้ง — กันไฟล์กำพร้า', async () => {
  const { rows } = await query(
    `INSERT INTO media_cards(title, card_type, url, visible_levels, created_by, deleted_at)
     VALUES('คีย์พัง','files','','{}','teacher1', NOW() - INTERVAL '90 days')
     RETURNING id`
  );
  const id = rows[0].id;
  // ใบแรกลบได้ ใบที่สองคีย์พัง — การ์ดต้องถูกข้ามไว้ทั้งใบ ไม่ใช่ลบแถวทิ้งแล้วปล่อยกำพร้า
  const good = await disk.put({ buffer: Buffer.from('%PDF-1.4 ok'), ext: 'pdf' });
  await query(
    `INSERT INTO media_files(card_id,file_key,file_name,file_size,sort_order)
     VALUES($1,$2,'ปกติ.pdf',$3,0), ($1,'คีย์ที่ไม่ถูกรูปแบบ','พัง.pdf',10,1)`,
    [id, good.key, good.size]
  );

  const res = await mediaCards.purgeExpiredCards({ log: () => {} });
  assert.ok(res.failed >= 1, 'ลบไฟล์ไม่สำเร็จต้องนับเป็น failed');

  const still = await query(`SELECT id FROM media_cards WHERE id=$1`, [id]);
  assert.equal(still.rows.length, 1,
    'ลบไฟล์ไม่สำเร็จแล้วยังลบแถว = ไฟล์กำพร้าที่ไม่มีอะไรชี้ถึงตลอดกาล');
  const left = await query(`SELECT count(*)::int AS n FROM media_files WHERE card_id=$1`, [id]);
  assert.equal(left.rows[0].n, 1,
    'ใบที่ลบสำเร็จแล้วต้องหายไปจริง รอบหน้าจะได้เดินต่อจากที่ค้าง ไม่ลบซ้ำ');

  await query(`DELETE FROM media_cards WHERE id=$1`, [id]);
});

test('สถานะที่เก็บไฟล์รายงาน driver และนับจาก DB', async () => {
  const st = await ok('getMediaStorageStatus', [], 'admin');
  assert.equal(st.connected, true);
  assert.equal(st.driver, 'disk');
  assert.ok(st.files >= 1);
  assert.ok(st.usage > 0, 'ขนาดรวมมาจาก media_cards.file_size ไม่ได้ไปไล่ list ไฟล์');
});
