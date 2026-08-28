'use strict';
/**
 * ตัวรัน migration — รันเองตอน server boot ไม่ต้องสั่งมือ
 *
 * ทำไมต้องมี: ระบบนี้ขายแบบ 1 โรงเรียน = 1 deployment + 1 DB (ดู CLAUDE.md)
 * การรัน `psql -f` ด้วยมือไหวแค่ตอนมีโรงเรียนเดียว พอมี 20 โรงเรียนคือรันมือ 20 รอบ
 * ทุกครั้งที่มี migration และลืมโรงเรียนไหน โค้ดใหม่จะเจอตารางเก่าแล้วพังเฉพาะที่นั่น
 *
 * ไม่ได้ลง library เพราะ migration ที่นี่เป็น .sql ธรรมดาอยู่แล้ว และ repo นี้จงใจ
 * ไม่ใช้ framework (ไม่มี ORM ไม่มี router library เขียน SQL ดิบ)
 * ถ้าวันหนึ่งต้องการ rollback จริงจัง ย้ายไป postgrator ได้ อ่านไฟล์รูปแบบเดียวกัน
 */
const fs = require('fs').promises;
const path = require('path');
const { pool, query } = require('../lib/db');

const DIR = path.join(__dirname, 'migrations');

// เลขคงที่สำหรับ pg_advisory_lock — กันสอง instance รัน migration ชนกันตอน deploy
const LOCK_KEY = 8_150_926;

async function listFiles() {
  const files = await fs.readdir(DIR).catch(() => []);
  // ชื่อไฟล์ขึ้นต้นด้วยวันที่ เรียงตามตัวอักษร = เรียงตามเวลา
  return files.filter(f => f.endsWith('.sql')).sort();
}

async function applied() {
  const { rows } = await query(`SELECT filename FROM schema_migrations`);
  return new Set(rows.map(r => r.filename));
}

/**
 * DB เปล่าของโรงเรียนใหม่ — สร้างจาก db/schema.sql ไม่ใช่ไล่รัน migration ทั้งกอง
 *
 * db/migrations/ ไม่มี schema ตั้งต้น มีแต่ส่วนต่างที่เพิ่มมาทีหลัง และ schema.sql
 * ก็ถูกอัปเดตให้เป็นสภาพล่าสุดอยู่เสมอ — ไล่รัน migration ทับ schema.sql จึงพัง
 * (เช่น media-cards-pdf.sql จะเพิ่ม drive_file_id กลับมาทั้งที่ schema.sql มี file_key แล้ว)
 *
 * ⚠️ กติกาที่ต้องรักษา: **เขียน migration ใหม่แล้วต้องแก้ db/schema.sql ให้ตรงกันเสมอ**
 *    ไม่งั้นโรงเรียนใหม่จะได้ schema ที่ขาดของ (เคยหลุดมาแล้วกับ FK ของ substitute_assignments)
 */
async function bootstrapFreshDb(files, log) {
  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(sql);
  for (const f of files) {
    await query(`INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING`, [f]);
  }
  log(`[migrate] DB เปล่า — สร้างจาก schema.sql แล้วบันทึก ${files.length} ไฟล์เป็น baseline`);
}

/**
 * DB ที่มีอยู่ก่อนจะมีตัวรันนี้ ผ่าน migration ไปหมดแล้วด้วยมือ
 * ถ้าไม่ baseline ไว้ ตัวรันจะพยายามรันซ้ำทั้งหมด ซึ่ง **ไม่ปลอดภัย**:
 * 2026-08-26-media-cards-pdf.sql เพิ่มคอลัมน์ drive_file_id แล้ว
 * 2026-08-26-media-files-local.sql เปลี่ยนชื่อมันเป็น file_key — รันซ้ำจะได้ drive_file_id
 * กลับมาแล้ว rename ทับ file_key ที่มีอยู่ → error
 *
 * ตัดสินว่า "DB นี้เก่า" จากการมีตาราง users ซึ่ง DB เปล่าของโรงเรียนใหม่จะไม่มี
 */
async function baselineIfExistingDb(files) {
  const { rows } = await query(
    `SELECT to_regclass('public.users') IS NOT NULL AS has_users`
  );
  if (!rows[0].has_users) return false;

  for (const f of files) {
    await query(
      `INSERT INTO schema_migrations(filename) VALUES($1) ON CONFLICT DO NOTHING`, [f]
    );
  }
  return true;
}

/**
 * รัน migration ที่ยังไม่เคยรัน คืนรายชื่อไฟล์ที่รันไปในรอบนี้
 * เรียกก่อนเปิดรับ request เสมอ — migration พังต้องไม่ให้แอปขึ้นด้วยตารางที่ผิดรูป
 */
async function runMigrations({ log = console.log } = {}) {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = await listFiles();
  if (!files.length) return [];

  const client = await pool.connect();
  const ran = [];
  try {
    // session-level lock — instance อื่นที่ boot พร้อมกันจะรอตรงนี้จนตัวแรกเสร็จ
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const done = await applied();
    if (done.size === 0) {
      const baselined = await baselineIfExistingDb(files);
      if (baselined) {
        log(`[migrate] DB เดิมที่ migrate ด้วยมือมาแล้ว — บันทึก ${files.length} ไฟล์เป็น baseline`);
      } else {
        await bootstrapFreshDb(files, log);
      }
      return [];
    }

    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await fs.readFile(path.join(DIR, f), 'utf8');
      // ทั้งไฟล์อยู่ใน transaction เดียว — พังกลางทางแล้วไม่เหลือ schema ครึ่ง ๆ กลาง ๆ
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations(filename) VALUES($1)`, [f]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} ล้มเหลว: ${err.message}`);
      }
      ran.push(f);
      log(`[migrate] รัน ${f}`);
    }
    if (!ran.length) log('[migrate] ไม่มี migration ใหม่');
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { runMigrations, LOCK_KEY };

// รันตรง ๆ ได้ด้วย: node db/migrate.js
if (require.main === module) {
  runMigrations()
    .then(ran => { console.log(`[migrate] เสร็จ (${ran.length} ไฟล์)`); process.exit(0); })
    .catch(err => { console.error('[migrate]', err.message); process.exit(1); });
}
