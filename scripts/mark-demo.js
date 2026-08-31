#!/usr/bin/env node
'use strict';
/**
 * ทำเครื่องหมายว่าฐานข้อมูลนี้คือเดโมสาธารณะ — รันครั้งเดียวตอนตั้งเครื่องเดโม
 *
 *   node scripts/mark-demo.js --yes        ทำเครื่องหมาย
 *   node scripts/mark-demo.js --remove     ถอนเครื่องหมาย
 *
 * เครื่องหมายนี้คือใบอนุญาตให้ db/seed-demo.js ล้างฐานข้อมูลได้ (lib/instance.js)
 * ติดผิดที่ = อนุญาตให้ล้างข้อมูลโรงเรียนจริง สคริปต์จึงบังคับ --yes
 * และปฏิเสธถ้าฐานข้อมูลดูมีคนใช้จริงอยู่
 */
const { query, pool } = require('../lib/db');
const instance = require('../lib/instance');

// เดโมมีผู้ใช้ราวยี่สิบคน โรงเรียนจริงมีเป็นร้อย — ใช้เป็นสัญญาณว่าชี้ผิดที่
const REAL_SCHOOL_USERS = 60;

function host() {
  try { return new URL(String(process.env.DATABASE_URL || '')).hostname; } catch (_) { return '(อ่านไม่ได้)'; }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--remove')) {
    await instance.unmarkDemo();
    return console.log(`ถอนเครื่องหมายเดโมออกจาก ${host()} แล้ว — seed จะล้าง DB นี้ไม่ได้อีก`);
  }

  if (!args.includes('--yes')) {
    console.error(`
กำลังจะทำเครื่องหมาย "เดโม" ให้ฐานข้อมูลที่: ${host()}

หลังจากนี้ db/seed-demo.js จะ **ล้างข้อมูลในฐานข้อมูลนี้ทิ้งได้** ทุกคืน
ถ้าไม่ใช่เครื่องเดโมจริง ๆ อย่ารัน

ยืนยันด้วย: node scripts/mark-demo.js --yes
`);
    process.exit(1);
  }

  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM users`);
  const n = rows[0].n;
  if (n > REAL_SCHOOL_USERS && !args.includes('--force')) {
    console.error(`❌ ฐานข้อมูลนี้มีผู้ใช้ ${n} คน — มากเกินกว่าจะเป็นเดโม`);
    console.error(`   ที่: ${host()}  ดูเหมือนชี้ผิดไปที่โรงเรียนจริง ปฏิเสธการทำเครื่องหมาย`);
    process.exit(1);
  }

  await instance.markDemo();
  console.log(`ทำเครื่องหมายเดโมให้ ${host()} แล้ว (ผู้ใช้ ${n} คน)`);
  console.log('ต่อไป: node db/seed-demo.js จะรันกับฐานข้อมูลนี้ได้');
}

main()
  .catch((e) => { console.error('ล้มเหลว:', e.message); process.exitCode = 1; })
  .finally(() => pool && pool.end && pool.end());
