'use strict';
/**
 * ตัวรัน migration — เส้นทางที่พังแล้วเจ็บที่สุดคือ "โรงเรียนใหม่ DB เปล่า"
 * เพราะจะรู้ตอนขายได้ลูกค้าใหม่แล้วเท่านั้น และ schema.sql กับ db/migrations/
 * เหลื่อมกันได้ง่ายมาก (เคยหลุดมาแล้วกับ FK ของ substitute_assignments)
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { stop } = require('./helpers/api');
const { runMigrations } = require('../db/migrate');
const { query } = require('../lib/db');

after(stop);

const FRESH_DB = 'pssms_migrate_test';
const silent = { log: () => {} };

function adminUrl(dbName) {
  const u = new URL(process.env.DATABASE_URL);
  u.pathname = '/' + dbName;
  return u.toString();
}

async function withAdmin(fn) {
  const client = new Client({ connectionString: adminUrl('postgres') });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

test('DB ที่ migrate ด้วยมือมาแล้ว ต้องถูก baseline ไม่ใช่รันซ้ำ', async () => {
  // dev DB มีข้อมูลอยู่แล้ว — รันซ้ำจะทำให้ media-cards-pdf.sql เพิ่ม drive_file_id
  // กลับมา แล้ว media-files-local.sql rename ทับ file_key จนพัง
  await runMigrations(silent);

  const { rows } = await query(`SELECT filename FROM schema_migrations ORDER BY filename`);
  assert.ok(rows.length >= 4, 'ต้องบันทึกไฟล์ที่มีอยู่เป็น baseline');

  // ไฟล์ของการ์ดสื่อย้ายไป media_files แล้ว (2026-09-06-media-multifile.sql)
  // คอลัมน์เก่าต้องไม่โผล่กลับมา ไม่งั้นจะมีแหล่งความจริง 2 ที่
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='media_cards'
       AND column_name IN ('file_key','drive_file_id','file_name','file_size')`
  );
  assert.deepEqual(cols.rows.map(r => r.column_name), [],
    'media_cards ต้องไม่ถือไฟล์เองอีกแล้ว');
  const moved = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='media_files' AND column_name='file_key'`
  );
  assert.equal(moved.rows.length, 1, 'file_key ต้องย้ายไปอยู่ที่ media_files');
});

test('รันซ้ำแล้วไม่มีอะไรเกิดขึ้น', async () => {
  const ran = await runMigrations(silent);
  assert.deepEqual(ran, [], 'ไม่มี migration ใหม่ ต้องไม่รันอะไรเลย');
});

/**
 * ⚠️ เทสต์นี้เกิดจากของจริงที่พัง: migration media-multifile รันผ่านทุกที่ตอน dev
 * แล้วล้มที่โรงเรียนแรกที่มีการ์ด `card_type='pdf'` อยู่จริง
 * ("new row for relation media_cards violates check constraint")
 *
 * สาเหตุคือลำดับคำสั่ง: UPDATE เขียน 'files' ตอนที่ CHECK เดิมยังบังคับ IN ('link','pdf')
 * **เทสต์ทุกตัวที่มีอยู่รันบน media_cards ที่ว่าง** UPDATE จึงแมตช์ 0 แถวและไม่มีอะไรละเมิด
 *
 * กติกาที่เทสต์นี้ล็อกไว้: **migration ต้องถูกลองกับ "ข้อมูลแบบเดิม" ไม่ใช่แค่ DB เปล่า**
 */
test('migration ของสื่อการสอน ต้องรันผ่านบน DB ที่มีการ์ดชนิดเดิมอยู่จริง', async (t) => {
  const LEGACY_DB = 'pssms_legacy_test';
  let created = false;
  try {
    await withAdmin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${LEGACY_DB}`);
      await c.query(`CREATE DATABASE ${LEGACY_DB}`);
    });
    created = true;
  } catch (err) {
    t.skip('สร้าง database ไม่ได้ (สิทธิ์ไม่พอ): ' + err.message);
    return;
  }

  const fs = require('fs').promises;
  const path = require('path');
  const legacy = new Client({ connectionString: adminUrl(LEGACY_DB) });
  await legacy.connect();
  try {
    // สร้างตารางแบบ *ก่อน* multifile ขึ้นมาเอง — ไล่รัน migration เก่าไม่ได้เพราะ
    // ตัวรันจะ bootstrap จาก schema.sql ซึ่งเป็นสภาพล่าสุดไปแล้ว
    await legacy.query(`
      CREATE TABLE media_cards (
        id             SERIAL PRIMARY KEY,
        title          TEXT NOT NULL,
        subject_group  TEXT NOT NULL DEFAULT '',
        icon           TEXT NOT NULL DEFAULT 'fa-book-open-reader',
        color          TEXT NOT NULL DEFAULT '#00897b',
        meta           TEXT NOT NULL DEFAULT '',
        description    TEXT NOT NULL DEFAULT '',
        url            TEXT NOT NULL DEFAULT '',
        card_type      TEXT NOT NULL DEFAULT 'link' CHECK (card_type IN ('link', 'pdf')),
        visible_levels TEXT[] NOT NULL DEFAULT '{}',
        is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
        created_by     TEXT NOT NULL DEFAULT '',
        file_key       TEXT,
        file_name      TEXT,
        file_size      BIGINT,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
      );
      CREATE INDEX idx_media_cards_file_key ON media_cards (file_key) WHERE file_key IS NOT NULL;
    `);
    await legacy.query(
      `INSERT INTO media_cards(title, card_type, url, file_key, file_name, file_size, created_by)
       VALUES ('การ์ดลิงก์เดิม','link','https://example.com',NULL,NULL,NULL,'teacher1'),
              ('การ์ด PDF เดิม','pdf','','${'a'.repeat(32)}.pdf','ใบความรู้.pdf',1234,'teacher2')`
    );

    const sql = await fs.readFile(
      path.join(__dirname, '../db/migrations/2026-09-06-media-multifile.sql'), 'utf8');
    // ห่อ transaction เหมือน db/migrate.js — ล้มแล้วต้องไม่เหลือ schema ครึ่ง ๆ กลาง ๆ
    await legacy.query('BEGIN');
    await legacy.query(sql);
    await legacy.query('COMMIT');

    const cards = await legacy.query(`SELECT title, card_type FROM media_cards ORDER BY id`);
    assert.deepEqual(cards.rows.map(r => r.card_type), ['link', 'files'],
      "การ์ด 'pdf' เดิมต้องกลายเป็น 'files' และการ์ดลิงก์ต้องไม่ถูกแตะ");

    const files = await legacy.query(`SELECT card_id, file_name, label, file_size FROM media_files`);
    assert.equal(files.rows.length, 1, 'ไฟล์ของการ์ดเดิมต้องถูกย้ายเข้า media_files');
    assert.equal(files.rows[0].file_name, 'ใบความรู้.pdf');
    assert.equal(files.rows[0].label, 'ใบความรู้.pdf', 'label ตั้งต้นใช้ชื่อไฟล์เดิม');
    assert.equal(Number(files.rows[0].file_size), 1234);

    const gone = await legacy.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='media_cards' AND column_name IN ('file_key','file_name','file_size')`
    );
    assert.deepEqual(gone.rows, [], 'คอลัมน์เก่าต้องถูก drop ทิ้ง ไม่เหลือแหล่งความจริงที่สอง');

  } finally {
    await legacy.end();
    if (created) {
      await withAdmin(c => c.query(`DROP DATABASE IF EXISTS ${LEGACY_DB}`)).catch(() => {});
    }
  }
});

test('DB เปล่าของโรงเรียนใหม่ สร้างจาก schema.sql ได้ครบและตรงกับ migrations', async (t) => {
  let created = false;
  try {
    await withAdmin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
      await c.query(`CREATE DATABASE ${FRESH_DB}`);
    });
    created = true;
  } catch (err) {
    t.skip('สร้าง database ไม่ได้ (สิทธิ์ไม่พอ): ' + err.message);
    return;
  }

  const fresh = new Client({ connectionString: adminUrl(FRESH_DB) });
  await fresh.connect();
  try {
    // db/migrate.js ใช้ pool กลาง จึงต้องรันเป็น subprocess ที่ชี้ DATABASE_URL อื่น
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, ['db/migrate.js'], {
      cwd: require('path').join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: adminUrl(FRESH_DB) },
      stdio: 'pipe',
    });

    const tables = await fresh.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'`
    );
    assert.ok(tables.rows[0].n > 20, `ตารางน้อยผิดปกติ (${tables.rows[0].n})`);

    const migrations = await fresh.query(`SELECT count(*)::int AS n FROM schema_migrations`);
    assert.ok(migrations.rows[0].n >= 4, 'ต้อง baseline ไฟล์ migration ทั้งหมด');

    // schema.sql ต้องสะท้อนทุก migration — เคสที่เคยหลุดจริง
    const cols = await fresh.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='media_files' AND column_name IN ('file_key','label','sort_order')`
    );
    assert.deepEqual(cols.rows.map(r => r.column_name).sort(), ['file_key', 'label', 'sort_order'],
      'schema.sql ต้องมีตาราง media_files ครบตาม 2026-09-06-media-multifile.sql');
    const cardType = await fresh.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname='media_cards_card_type_check'`
    );
    assert.match(cardType.rows[0].def, /'files'/,
      "schema.sql ต้องยอม card_type 'files' ไม่ใช่ 'pdf'");

    const fk = await fresh.query(
      `SELECT confdeltype FROM pg_constraint WHERE conname='substitute_assignments_leave_id_fkey'`
    );
    assert.equal(fk.rows[0] && fk.rows[0].confdeltype, 'n',
      'FK ต้องเป็น ON DELETE SET NULL ตาม 2026-08-17-substitute-leave-fk.sql');
    // ── ด่านกัน schema.sql เพี้ยนจากฐานข้อมูลที่ใช้งานจริง ──────────────────
    // เทียบคอลัมน์ทีละตัวระหว่าง DB ที่เพิ่งสร้างกับ DB dev (ตัวแทนของโรงเรียนที่ใช้มานาน)
    // เคยเพี้ยนจนตาราง savings_transactions หายทั้งตาราง และ score เป็น NUMERIC
    // ทั้งที่ ปพ.5 ต้องเก็บ 'ร' 'มส' '-' — รู้ตัวตอนตั้งเครื่องเดโมเท่านั้น
    const COLS = `SELECT table_name||'.'||column_name||' : '||data_type AS c
                  FROM information_schema.columns
                  WHERE table_schema='public' AND table_name<>'schema_migrations'
                  ORDER BY 1`;
    const freshCols = (await fresh.query(COLS)).rows.map(r => r.c);
    const devCols   = (await query(COLS)).rows.map(r => r.c);

    const missing = devCols.filter(c => !freshCols.includes(c));
    const extra   = freshCols.filter(c => !devCols.includes(c));
    assert.deepEqual(missing, [], `schema.sql ขาดของที่ DB จริงมี — โรงเรียนใหม่จะได้ระบบที่พัง:\n  ${missing.join('\n  ')}`);
    assert.deepEqual(extra,   [], `schema.sql มีของที่ DB จริงไม่มี:\n  ${extra.join('\n  ')}`);

    // seed ลงบน DB ที่สร้างจาก schema.sql ได้จริง — ข้อนี้คือข้อที่จับ NUMERIC vs TEXT ได้
    execFileSync(process.execPath, ['db/seed-dev.js'], {
      cwd: require('path').join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: adminUrl(FRESH_DB) },
      stdio: 'pipe',
    });
    const seeded = await fresh.query(`SELECT count(*)::int AS n FROM users`);
    assert.ok(seeded.rows[0].n > 0, 'seed ลง DB ของโรงเรียนใหม่ไม่ได้');

  } finally {
    await fresh.end();
    if (created) {
      await withAdmin(c => c.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`)).catch(() => {});
    }
  }
});
