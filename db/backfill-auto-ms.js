/**
 * backfill-auto-ms.js
 *
 * เติม (และถอนคืน) มส. อัตโนมัติจากเวลาเรียนย้อนหลังให้ข้อมูลที่มีอยู่แล้ว
 *
 * ตั้งแต่นี้ไประบบทบทวนให้เองทุกครั้งที่เช็คชื่อ (`functions/attendance.js`)
 * สคริปต์นี้จึงใช้ครั้งเดียวตอนขึ้นฟีเจอร์ หรือตอนสงสัยว่าแถวเพี้ยน
 *
 * กติกาใครชนะใครอยู่ที่ `functions/autoMs.js` ที่เดียว — สคริปต์นี้แค่ไล่หา
 * คู่ (วิชา × ห้อง) ที่มีการเช็คชื่อแล้วส่งให้มันตัดสิน **ห้ามก๊อปสูตรมาไว้ที่นี่**
 *
 * Usage:
 *   node db/backfill-auto-ms.js                      # dry-run ทั้งหมด
 *   node db/backfill-auto-ms.js --term=1 --year=2569
 *   node db/backfill-auto-ms.js --apply              # เขียนจริง
 */
require('dotenv').config();
const { query } = require('../lib/db');
const { planAutoMs, syncAutoMs, isGradedSubject } = require('../functions/autoMs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};
const FILTER_TERM = argVal('term');
const FILTER_YEAR = argVal('year');

async function main() {
  const where = [`class <> ''`, `subject_code <> ''`];
  const params = [];
  if (FILTER_TERM) { params.push(FILTER_TERM); where.push(`term=$${params.length}`); }
  if (FILTER_YEAR) { params.push(FILTER_YEAR); where.push(`year=$${params.length}`); }

  const { rows: pairs } = await query(
    `SELECT DISTINCT subject_code, class, term, year
       FROM attendance
      WHERE ${where.join(' AND ')}
      ORDER BY year, term, subject_code, class`,
    params
  );

  const graded = pairs.filter(p => isGradedSubject(p.subject_code));
  console.log(`คู่ (วิชา × ห้อง) ที่มีการเช็คชื่อ: ${pairs.length} — เป็นรายวิชาที่มีเกรด ${graded.length}`);
  if (!graded.length) { console.log('ไม่มีอะไรต้องทำ — จบ'); return; }

  let totalWrite = 0;
  let totalRemove = 0;
  const samples = [];

  for (const p of graded) {
    const target = { subjectCode: p.subject_code, className: p.class, term: p.term, year: p.year };
    if (APPLY) {
      const res = await syncAutoMs(target);
      totalWrite += res.written;
      totalRemove += res.removed;
      if (res.written || res.removed) {
        console.log(`  ${p.subject_code} ${p.class} ${p.term}/${p.year} → เขียน ${res.written} ถอน ${res.removed}`);
      }
    } else {
      const plan = await planAutoMs(target);
      totalWrite += plan.toWrite.length;
      totalRemove += plan.toRemove.length;
      for (const w of plan.toWrite) {
        if (samples.length < 20) {
          samples.push(`  ${w.studentId} ${p.subject_code} ${p.class} ${p.term}/${p.year} เวลาเรียน ${w.percent}%`);
        }
      }
    }
  }

  if (!APPLY) {
    console.log(`\n--- DRY RUN (ยังไม่เขียน) ---`);
    console.log(`จะเขียน มส. อัตโนมัติ: ${totalWrite} รายการ`);
    console.log(`จะถอนคืน (เวลาเรียนกลับขึ้น ≥80%): ${totalRemove} รายการ`);
    if (samples.length) {
      console.log('\nตัวอย่างที่จะเขียน:');
      samples.forEach(s => console.log(s));
    }
    console.log('\nเขียนจริงด้วย: node db/backfill-auto-ms.js --apply');
    return;
  }

  console.log(`\n✅ เขียน มส. อัตโนมัติ ${totalWrite} รายการ · ถอนคืน ${totalRemove} รายการ`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('❌', e.message); process.exit(1); });
