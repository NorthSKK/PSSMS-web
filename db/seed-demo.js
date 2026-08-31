#!/usr/bin/env node
'use strict';
/**
 * ชุดข้อมูลสำหรับถ่ายภาพหน้าจอไปใช้บนเว็บขาย (pssms.app)
 *
 * ต่างจาก seed-dev.js ตรงที่ **ชื่อคนต้องดูเหมือนโรงเรียนจริงที่ใช้งานอยู่**
 * seed-dev จงใจใส่คำว่า "ทดสอบ / ทดลอง / จำลอง" ในชื่อเพื่อกันสับสนตอน dev
 * ซึ่งพอไปโผล่ในภาพโฆษณาแล้วทำลายความน่าเชื่อถือทันที
 *
 * ⚠️ **ห้ามใช้ข้อมูลจริงจาก production ถ่ายภาพ** — เป็นข้อมูลครูและนักเรียนจริง
 *    ต้องขออนุญาต และการเบลอพลาดครั้งเดียวคือข้อมูลนักเรียนหลุด
 *    ชื่อทุกชื่อในไฟล์นี้สมมติขึ้นทั้งหมด
 *
 * วิธีใช้ (localhost เท่านั้น เหมือน seed-dev):
 *   node db/seed-demo.js
 *   PORT=3999 MEDIA_STORAGE_DIR=$PWD/storage/media node server.js
 *   แล้วถ่ายภาพ
 *
 * กลับไปข้อมูล dev ปกติ: node db/seed-dev.js
 */
require('dotenv').config();
if (!process.env.MEDIA_STORAGE_DIR) {
  process.env.MEDIA_STORAGE_DIR = require('path').join(__dirname, '../storage/media');
}
const { execFileSync } = require('child_process');
const path = require('path');
const { query, pool } = require('../lib/db');

let host = '';
try { host = new URL(String(process.env.DATABASE_URL || '')).hostname; } catch (_) { /* ตกไป error */ }
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error('❌ DATABASE_URL ไม่ได้ชี้ localhost — ปฏิเสธการรัน');
  process.exit(1);
}

const SCHOOL = 'โรงเรียนสาธิตวิทยา';

// ชื่อสมมติทั้งหมด — ไม่มีคำว่าทดสอบ/ทดลอง เพราะจะไปโผล่ในภาพ
const TEACHER_NAMES = {
  admin:    'นางสาวพิมพ์ใจ วงศ์สถิตย์',
  teacher1: 'นายอนุชา พงษ์เจริญ',
  teacher2: 'นางสุภาพร ทองแท้',
  teacher3: 'นางสาวกมลชนก แสงทวี',
  teacher4: 'นายธนากร ศรีสุวรรณ',
  teacher5: 'นายพีรพล อินทรโชติ',
};

// ม.2/1 เต็มห้อง — หน้า ปพ.5 กับเช็คชื่อจะได้ดูเหมือนห้องเรียนจริง ไม่ใช่ตาราง 2 แถว
const M2_NAMES = [
  'เด็กชายกิตติพงษ์ ชัยวัฒน์', 'เด็กหญิงกัญญาณัฐ บุญมี',
  'เด็กชายจิรายุ เพชรรัตน์',   'เด็กหญิงชนัญชิดา สุขสวัสดิ์',
  'เด็กชายณัฐดนัย แก้วประเสริฐ', 'เด็กหญิงณิชากร พันธ์ทอง',
  'เด็กชายธีรภัทร มงคลชัย',    'เด็กหญิงนภัสสร รุ่งเรือง',
  'เด็กชายปวริศ อารีย์วงศ์',    'เด็กหญิงพิชญาภา คงทรัพย์',
  'เด็กชายภูมิพัฒน์ สินสมบูรณ์', 'เด็กหญิงมนัสนันท์ ใจงาม',
  'เด็กชายรัชชานนท์ โพธิ์ทอง',  'เด็กหญิงวรินทร ปัญญาดี',
  'เด็กชายศุภกร เจริญสุข',     'เด็กหญิงสุพิชญา ทิพย์มณี',
];

const M6_NAMES = [
  'นายกฤตเมธ วัฒนกุล', 'นางสาวจิดาภา ศิริพงศ์',
  'นายชยพล เรืองศรี',  'นางสาวธัญชนก บวรกิจ',
];

async function main() {
  console.log('🎬 เตรียมข้อมูลสำหรับถ่ายภาพหน้าจอ...');

  // ใช้โครงจาก seed-dev ทั้งหมด (ตารางสอน คะแนน เช็คชื่อ สอนแทน) แล้วค่อยเปลี่ยนชื่อทับ
  // ไม่คัดลอกตรรกะซ้ำ — seed-dev เป็นเจ้าของรูปร่างข้อมูลอยู่แล้ว
  execFileSync(process.execPath, [path.join(__dirname, 'seed-dev.js')], { stdio: 'pipe' });

  for (const [username, name] of Object.entries(TEACHER_NAMES)) {
    await query(`UPDATE users SET full_name=$1 WHERE username=$2`, [name, username]);
  }
  // ชื่อครูถูกคัดลอกไว้ในตารางอื่นด้วยตอน seed — ไล่แก้ให้ตรงกัน
  for (const [username, name] of Object.entries(TEACHER_NAMES)) {
    await query(`UPDATE sarabun SET requester=$1 WHERE requester ILIKE '%' || $2 || '%'`,
      [name, username]).catch(() => {});
  }

  // นักเรียนเดิม 6 คนของ seed-dev → เปลี่ยนชื่อ แล้วเติมให้ ม.2/1 เต็มห้อง
  const existing = await query(`SELECT username, department FROM users WHERE role='Student' ORDER BY username`);
  let m2 = 0, m6 = 0;
  for (const row of existing.rows) {
    const isM2 = String(row.department || '').startsWith('ม.2');
    const name = isM2 ? M2_NAMES[m2++] : M6_NAMES[m6++];
    if (name) await query(`UPDATE users SET full_name=$1 WHERE username=$2`, [name, row.username]);
  }

  // เติมนักเรียน ม.2/1 ให้ครบ 16 คน
  const { rows: cfg } = await query(`SELECT value1 FROM system_settings WHERE key='year' LIMIT 1`);
  const YEAR = (cfg[0] && cfg[0].value1) || '2569';
  for (; m2 < M2_NAMES.length; m2++) {
    const id = String(2001 + m2).padStart(5, '0');
    await query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       VALUES($1,'1234',$2,'Student','ม.2/1',$3,$4,'ปกติ')
       ON CONFLICT (username) DO UPDATE SET full_name=EXCLUDED.full_name`,
      [id, M2_NAMES[m2], `${id}@demo.local`, YEAR]
    );
  }

  /**
   * ชื่อคนถูก "คัดลอกเป็นข้อความ" ไว้ในอีกหลายตาราง (denormalised) ไม่ได้ join จาก users
   * เปลี่ยนแค่ users จึงไม่พอ — ภาพจะมีชื่อเก่ากับชื่อใหม่ปนกัน
   * เคยหลุดมาแล้วกับ substitute_assignments ที่โชว์ "แทน ครูสมชาย ใจดี" บนแดชบอร์ด
   */
  const NAME_COPIES = [
    ['attendance', 'student_name', 'student_id'],
    ['morning_activity', 'student_name', 'student_id'],
    ['club_members', 'student_name', 'student_id'],
    ['savings_transactions', 'student_name', 'student_id'],
    ['substitute_assignments', 'original_teacher_name', 'original_teacher_id'],
    ['substitute_assignments', 'sub_teacher_name', 'sub_teacher_id'],
    ['club_advisors', 'teacher_name', 'teacher_id'],
    ['leave_records', 'staff_name', 'teacher_id'],
  ];
  for (const [table, nameCol, idCol] of NAME_COPIES) {
    await query(
      `UPDATE ${table} t SET ${nameCol} = u.full_name
       FROM users u WHERE LOWER(u.username) = LOWER(t.${idCol})`
    ).catch(e => console.warn(`  ข้าม ${table}.${nameCol}: ${e.message}`));
  }

  await query(
    `INSERT INTO system_settings(key, subkey, value1) VALUES('schoolName','',$1)
     ON CONFLICT (key, subkey) DO UPDATE SET value1=EXCLUDED.value1`, [SCHOOL]
  );

  // การ์ดสื่อการสอนให้ดูมีของ — หน้าสื่อการสอนเป็นภาพที่จะใช้ขายเยอะที่สุด
  await query(`DELETE FROM media_cards`);
  const CARDS = [
    ['สุขศึกษาและพลศึกษา ม.2', 'สุขศึกษาและพลศึกษา', 'fa-heart-pulse', '#00897b',
     '14 หน่วยการเรียนรู้', 'เนื้อหาครบทุกหน่วยตามตัวชี้วัด พร้อมแบบทดสอบท้ายหน่วย',
     'https://health-m2.vercel.app', ['ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'], true],
    ['ป้องกันทุจริตศึกษา', 'สังคมศึกษา ศาสนา และวัฒนธรรม', 'fa-scale-balanced', '#8a3324',
     '34 บทเรียน', 'สรุปรัฐธรรมนูญ 2560 และประมวลกฎหมายอาญา พร้อมเควิซท้ายบท',
     'https://thai-law-learning.vercel.app', ['ม.4','ม.5','ม.6'], true],
    ['คลิปสอนแรงและการเคลื่อนที่', 'วิทยาศาสตร์และเทคโนโลยี', 'fa-atom', '#2e7d32',
     'วิดีโอ 8 ตอน', 'คลิปประกอบการสอนหน่วยแรงและการเคลื่อนที่',
     'https://www.youtube.com/playlist?list=demo', ['ม.4','ม.5'], false],
    ['ใบงานคณิตศาสตร์ ม.2', 'คณิตศาสตร์', 'fa-calculator', '#1565c0',
     'ใบงาน 12 ชุด', 'ใบงานฝึกทักษะพร้อมเฉลยสำหรับครูผู้สอน',
     'https://drive.google.com/drive/folders/demo', ['ม.2'], false],
    ['คลังข้อสอบภาษาไทย', 'ภาษาไทย', 'fa-feather-pointed', '#c62828',
     'ครูเท่านั้น', 'ข้อสอบกลางภาคและปลายภาค พร้อมเฉลยละเอียด',
     'https://drive.google.com/drive/folders/demo2', [], false],
  ];
  for (const c of CARDS) {
    await query(
      `INSERT INTO media_cards(title,subject_group,icon,color,meta,description,url,card_type,
                               visible_levels,is_featured,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'link',$8,$9,'teacher2')`, c
    );
  }

  // ทะเบียนสารบรรณให้มีหลายประเภท — โชว์ตัวกรองประเภทได้
  await query(`DELETE FROM sarabun`);
  const DOCS = [
    ['บันทึกข้อความ', 'ศธ 118/2569', 'ขออนุญาตนำนักเรียนไปแข่งขันทักษะวิชาการ', TEACHER_NAMES.teacher1, '2026-08-24'],
    ['บันทึกข้อความ', 'ศธ 117/2569', 'ขอใช้ห้องประชุมเพื่อจัดอบรมครู', TEACHER_NAMES.teacher3, '2026-08-21'],
    ['ทะเบียนคำสั่ง', 'คำสั่ง 42/2569', 'แต่งตั้งคณะกรรมการดำเนินงานกีฬาสี', TEACHER_NAMES.admin, '2026-08-19'],
    ['ทะเบียนหนังสือส่ง', 'ศธ 04231/210', 'รายงานผลการดำเนินงานประจำเดือนสิงหาคม', TEACHER_NAMES.admin, '2026-08-18'],
    ['ทะเบียนเกียรติบัตร', 'กบ 55/2569', 'เกียรติบัตรนักเรียนแข่งขันคณิตศาสตร์', TEACHER_NAMES.teacher4, '2026-08-15'],
  ];
  for (const [type, num, subject, requester, date] of DOCS) {
    await query(
      `INSERT INTO sarabun(doc_type,doc_number,subject,requester,target_date,status,year)
       VALUES($1,$2,$3,$4,$5,'รอดำเนินการ',$6)`, [type, num, subject, requester, date, YEAR]
    );
  }

  const counts = await query(`
    SELECT (SELECT count(*) FROM users WHERE role='Student') AS students,
           (SELECT count(*) FROM media_cards) AS media,
           (SELECT count(*) FROM sarabun) AS sarabun`);
  console.log('✅ พร้อมถ่ายภาพ:', counts.rows[0], '·', SCHOOL);
  console.log('   ล็อกอิน: teacher2 / 1234 (ครูผู้สอน) · admin / 1234 (ผู้ดูแล)');
}

main()
  .then(() => pool.end())
  .catch(err => { console.error('❌', err.message); process.exit(1); });
