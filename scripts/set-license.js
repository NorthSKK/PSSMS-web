#!/usr/bin/env node
'use strict';
/**
 * ตั้งวันหมดอายุการใช้งานของโรงเรียนหนึ่งแห่ง — รันครั้งเดียวตอนส่งมอบ
 *
 *   node scripts/set-license.js 2026-10-31     ตั้งวันหมดอายุ
 *   node scripts/set-license.js --show         ดูวันหมดอายุปัจจุบัน
 *   node scripts/set-license.js --clear        ยกเลิกการจำกัด (ใช้กับโรงเรียนเราเอง/เดโม)
 *
 * รันชี้ไปที่ฐานข้อมูลของโรงเรียนนั้นผ่าน DATABASE_URL
 * ทดลองใช้ 30 วัน = วันส่งมอบ + 30
 */
const { query, pool } = require('../lib/db');
const license = require('../lib/license');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function usage(msg) {
  if (msg) console.error(`\n${msg}`);
  console.error(`
วิธีใช้:
  node scripts/set-license.js YYYY-MM-DD
  node scripts/set-license.js --show
  node scripts/set-license.js --clear
`);
  process.exit(1);
}

async function show() {
  const { state, until, daysLeft } = await license.read();
  if (state === 'none') return console.log('ยังไม่ได้ตั้งวันหมดอายุ — ใช้งานได้ไม่จำกัด');
  const label = { active: 'ปกติ', warn: 'ใกล้หมดอายุ', grace: 'เลยกำหนด (ช่วงผ่อนผัน)', locked: 'อ่านอย่างเดียว' }[state];
  console.log(`วันหมดอายุ: ${until}  (${daysLeft >= 0 ? `เหลือ ${daysLeft} วัน` : `เลยมา ${-daysLeft} วัน`})  สถานะ: ${label}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) usage('ต้องระบุวันหมดอายุ');

  if (arg === '--show') return show();

  if (arg === '--clear') {
    await query(`DELETE FROM system_settings WHERE key='license' AND subkey='until'`);
    license.invalidate();
    return console.log('ยกเลิกการจำกัดแล้ว — ใช้งานได้ไม่จำกัด');
  }

  if (!ISO.test(arg)) usage(`รูปแบบวันที่ไม่ถูกต้อง: ${arg} (ต้องเป็น YYYY-MM-DD)`);
  if (Number.isNaN(Date.parse(`${arg}T00:00:00Z`))) usage(`ไม่มีวันที่นี้จริง: ${arg}`);

  await query(
    `INSERT INTO system_settings(key, subkey, value1) VALUES('license','until',$1)
     ON CONFLICT(key, subkey) DO UPDATE SET value1=$1`,
    [arg]
  );
  license.invalidate();
  console.log(`ตั้งวันหมดอายุเป็น ${arg} แล้ว`);
  // แคชอยู่ในหน่วยความจำของแต่ละ process เซิร์ฟเวอร์ที่รันอยู่จะเห็นภายใน 1 นาที
  await show();
}

main()
  .catch((e) => { console.error('ล้มเหลว:', e.message); process.exitCode = 1; })
  .finally(() => pool && pool.end && pool.end());
