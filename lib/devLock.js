'use strict';
/**
 * กันสอง process แตะฐานข้อมูล dev ตัวเดียวกันพร้อมกัน
 *
 * ⚠️ **ปัญหาที่แก้** — `npm test` รัน `db/seed-dev.js` เป็น pretest ซึ่ง**ล้างข้อมูลทั้งชุด**
 * ถ้ามีคน (หรือ agent อีกตัว) กำลังรันเทสอยู่บน DB เดียวกัน การล้างจะเกิดกลางคัน
 * แล้วเทสของอีกฝ่ายแดงด้วยเหตุผลที่ไม่ใช่บั๊กของใครเลย — ซึ่งเป็นอาการที่ไล่หาสาเหตุ
 * ยากที่สุด เพราะโค้ดไม่ผิด ข้อมูลก็ดูปกติเมื่อดูทีหลัง
 *
 * ใช้ `pg_try_advisory_lock` — **ไม่รอคิว ล้มทันที** พร้อมบอกว่าทำอะไรอยู่
 * รอคิวแล้วสองรอบจะสลับกันล้างข้อมูลกันเองจนกว่าจะมีใครยอมแพ้
 *
 * ⚠️ **ล็อกผูกกับ connection ไม่ใช่กับ transaction** — ต้องถือ client ตัวเดิมไว้
 * ทั้งช่วงที่ต้องการกัน ปล่อย client เมื่อไหร่ ล็อกหลุดทันที
 *
 * เทคนิคเดียวกับ `db/migrate.js` ที่กันสอง instance รัน migration ชนกันตอน deploy
 * แต่คนละคีย์ เพราะคนละเรื่องกัน
 */
const { pool } = require('./db');

const LOCK_KEY = 8_150_927;   // migrate.js ใช้ 8_150_926 — ห้ามซ้ำ

/**
 * จับล็อก คืนฟังก์ชันสำหรับคืนล็อก · จับไม่ได้ = throw
 * `who` คือชื่อที่จะขึ้นในข้อความว่าใครถืออยู่ (ช่วยคนอ่านว่าไปปิดอะไร)
 */
async function acquire(who) {
  const client = await pool.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_KEY]);
  if (!rows[0].got) {
    client.release();
    throw new Error(
      `ฐานข้อมูล dev นี้มี process อื่นใช้อยู่ (${who} จับล็อกไม่ได้)\n` +
      '   มีเทสหรือ seed ของอีกหน้าต่างรันค้างอยู่ รอให้จบก่อนแล้วลองใหม่\n' +
      '   ถ้าทำงานพร้อมกันหลายคน ให้แยกฐานข้อมูลกันคนละตัว (createdb pssms_dev_<ชื่อ>)'
    );
  }
  return async () => {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  };
}

module.exports = { acquire, LOCK_KEY };
