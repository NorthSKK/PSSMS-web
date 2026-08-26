/**
 * seed-dev.js — ข้อมูลจำลองสำหรับ DB dev
 *
 * ห้ามใช้กับ production — สคริปต์ปฏิเสธถ้า DATABASE_URL ไม่ได้ชี้ localhost
 *
 * ข้อมูลทั้งหมดเป็นของปลอม แต่จงใจให้มีรูปร่างเหมือนของจริง เพราะบั๊กหลายตัว
 * โผล่เฉพาะกับข้อมูลรูปแบบนี้:
 *   - รหัสนักเรียนมี 0 นำหน้า ('01903') — normID/parseInt ตัดทิ้ง เคยทำ Massive Grid
 *     บันทึกไม่ลง เพราะ lookup ด้วย id ที่ตัดแล้ว
 *   - ห้องเป็น 'ม.X/Y' — ต้องผ่าน normalize() ตอน match กับ timetable (level + room)
 *   - HR ลงตาราง จันทร์-ศุกร์ period '0' ครบ 5 วัน ไม่งั้น HR หายไปบางวัน
 *   - calendar_events สีแดง #dc3545 = วันหยุด ใช้ทดสอบตัวกรองของ massive grid
 *
 * Usage:
 *   node db/seed-dev.js           # ล้างข้อมูลเดิม (ยกเว้น config) แล้วใส่ใหม่
 */
require('dotenv').config();
const { query } = require('../lib/db');

// parse hostname จริง อย่าใช้ regex — URL ของ dev ไม่มี user:pass เลยไม่มี '@'
const url = String(process.env.DATABASE_URL || '');
let host = '';
try { host = new URL(url).hostname; } catch (_) { /* ปล่อยว่างไว้ ให้ตกไปที่ error ด้านล่าง */ }
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error('❌ DATABASE_URL ไม่ได้ชี้ localhost — ปฏิเสธการรัน กัน seed ทับ production');
  console.error('   ตอนนี้ชี้ไปที่:', host || '(อ่าน DATABASE_URL ไม่ได้)');
  process.exit(1);
}

const TERM = '1', YEAR = '2569';

// ครู 5 คน — teacher1/teacher2 ใช้ทดสอบ "ครูคนอื่นแก้ข้อมูลเราไม่ได้",
// teacher3-5 มีไว้ให้ระบบจัดสอนแทนอัตโนมัติมีตัวเลือกให้จัดลำดับ
// ⚠️ dept เป็น "วิชาเอก" ไม่ใช่ชื่อกลุ่มสาระ — ล้อ production ที่เก็บ ฟิสิกส์ / นาฏศิลป์ /
// อุตสาหกรรม ฯลฯ ถ้า seed ใส่ชื่อกลุ่มสาระเป๊ะ ๆ บั๊ก "จับคู่กลุ่มสาระจาก department"
// จะไม่โผล่ตอนเทส (ความถนัดจริงต้องดูจาก timetable ว่าสอน prefix ไหนกี่คาบ)
const TEACHERS = [
  { username: 'admin',    name: 'ผู้ดูแลระบบ',        role: 'Admin',   dept: 'บริหาร' },
  { username: 'teacher1', name: 'ครูสมชาย ใจดี',      role: 'Teacher', dept: 'ฟิสิกส์' },
  { username: 'teacher2', name: 'ครูสมหญิง ตั้งใจสอน', role: 'Teacher', dept: 'สุขศึกษา' },
  { username: 'teacher3', name: 'ครูวิทยา เคมีดี',     role: 'Teacher', dept: 'วิทยาศาสตร์ทั่วไป' },
  { username: 'teacher4', name: 'ครูอักษร ภาษางาม',   role: 'Teacher', dept: 'ภาษาไทย' },
  { username: 'teacher5', name: 'ครูพลศึกษ์ แข็งแรง',  role: 'Teacher', dept: 'พลศึกษา' },
];

// 0 นำหน้าเจตนา — อย่าแก้เป็นเลขล้วน
const STUDENTS = [
  { id: '01901', name: 'เด็กหญิงกานดา ทดสอบ',   cls: 'ม.6/1' },
  { id: '01902', name: 'เด็กหญิงขวัญ ทดลอง',     cls: 'ม.6/1' },
  { id: '01903', name: 'เด็กชายคมสัน จำลอง',     cls: 'ม.6/1' },
  { id: '01904', name: 'เด็กหญิงงามพิศ ตัวอย่าง', cls: 'ม.6/1' },
  { id: '02001', name: 'เด็กชายจตุพร ทดสอบ',    cls: 'ม.2/1' },
  { id: '02002', name: 'เด็กหญิงฉวี ทดลอง',      cls: 'ม.2/1' },
];

// subject_code, ชื่อ, ครู, level, room, [ [วัน, คาบ], ... ]
const SUBJECTS = [
  { code: 'ว30205', name: 'ฟิสิกส์',   teacher: 'teacher1', level: 'ม.6', room: '1',
    slots: [['พุธ', '2'], ['พฤหัสบดี', '1'], ['ศุกร์', '1']] },
  { code: 'พ22101', name: 'สุขศึกษา', teacher: 'teacher2', level: 'ม.2', room: '1',
    slots: [['อังคาร', '3']] },
  // teacher3 สอน ว 4 คาบ → prefix 'ว' ถือว่า "ถนัด" (>=3 คาบ) แม้ dept เขียนว่า
  // 'วิทยาศาสตร์ทั่วไป' ซึ่งไม่ตรงชื่อกลุ่มสาระ
  // ครบทุกวันทำการที่คาบ 4 โดยตั้งใจ — คาบสอนแทนที่ seed ไว้ที่คาบ 4 จะชนแน่นอน
  // ไม่ว่า SUB_DAY() จะตกวันไหน (ทดสอบกฎ "ครูติดคาบสอนตัวเอง")
  { code: 'ว31101', name: 'วิทยาศาสตร์กายภาพ', teacher: 'teacher3', level: 'ม.5', room: '1',
    slots: [['จันทร์', '4'], ['อังคาร', '4'], ['พุธ', '4'], ['พฤหัสบดี', '4'], ['ศุกร์', '4']] },
  { code: 'ท21101', name: 'ภาษาไทย', teacher: 'teacher4', level: 'ม.1', room: '1',
    slots: [['จันทร์', '5'], ['พุธ', '5'], ['ศุกร์', '5']] },
  { code: 'พ21101', name: 'พลศึกษา', teacher: 'teacher5', level: 'ม.1', room: '1',
    slots: [['อังคาร', '6'], ['พฤหัสบดี', '6'], ['ศุกร์', '6']] },
];

// คาบสอนแทนนับจาก "วันนี้" เสมอ (day 0 = วันนี้) เพราะหน้าจัดตารางสอนแทนเปิดมาด้วย
// ตัวกรองวันนี้ (initSubstituteAdminPage) ถ้า hardcode วันไว้ พอเวลาผ่านไปจะเปิดหน้ามา
// เจอ "ไม่มีรายการ" ทุกแท็บ. ข้ามเสาร์-อาทิตย์ — โรงเรียนไม่มีคาบสอนวันหยุด
const THAI_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function weekdayOffset(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); // วันนี้ตกเสาร์/อาทิตย์ → เลื่อนไปจันทร์
  for (let i = 0; i < n; i++) {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  }
  return d;
}
// ห้ามใช้ toISOString() — TZ ไทยเป็น +07 เที่ยงคืนตามเวลาเครื่องจะกลายเป็นวันก่อนหน้าใน UTC
// แล้ว date กับ day_of_week จะไม่ตรงกัน (เจอมาแล้วตอนเขียน seed นี้)
const SUB_DAY = (n) => {
  const d = weekdayOffset(n);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, dow: THAI_DOW[d.getDay()] };
};

// วันทำการย้อนหลัง — ใช้สร้างประวัติสอนแทนใน 30 วันที่ผ่านมา (ตัวถ่วงคะแนน "กระจายภาระ")
const SUB_PAST_DAY = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
  }
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, dow: THAI_DOW[d.getDay()] };
};

// ใบลา — substitute_assignments.leave_id ชี้มาที่นี่ หน้าจัดสอนแทนเอา type ไปโชว์ว่าลาอะไร
const LEAVES = [
  { key: 'L1', teacher: 'teacher1', type: 'ลากิจ',  day: 0, days: 3, reason: 'ธุระครอบครัว' },
  { key: 'L2', teacher: 'teacher2', type: 'ลาป่วย', day: 2, days: 2, reason: 'ไข้หวัดใหญ่' },
  // teacher4 ลาวันเดียวกับคาบ AUTO_BLOCKED — ระบบจัดอัตโนมัติต้องไม่เสนอครูที่ลาเอง
  { key: 'L3', teacher: 'teacher4', type: 'ลากิจ',  day: 6, days: 1, reason: 'ธุระส่วนตัว' },
];

// ครบทั้ง 3 สถานะ — จัดแล้ว 2 วัน (เทสมุมมองจัดกลุ่มตามวัน + หน้าพิมพ์),
// รอจัด (ปุ่ม "จัด" + badge นับ), ยกเลิก (แท็บที่ 3)
// day 0 = วันนี้ ต้องมีอย่างน้อย 1 คาบ "จัดแล้ว" ไม่งั้นเปิดหน้ามาแท็บนี้ว่าง
// leave: null = คาบที่กด "เพิ่มเอง" ไม่มีใบลาผูก → ไม่ต้องขึ้นป้ายประเภทการลา
const SUBSTITUTES = [
  // teacher1 ลากิจ → teacher2 สอนแทน
  { day: 0, period: '2', leave: 'L1', orig: 'teacher1', sub: 'teacher2', code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'จัดแล้ว' },
  { day: 0, period: '6', leave: 'L1', orig: 'teacher1', sub: 'teacher2', code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'จัดแล้ว' },
  { day: 1, period: '1', leave: 'L1', orig: 'teacher1', sub: 'teacher2', code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '',       status: 'จัดแล้ว' },
  // teacher2 ลาป่วย → teacher1 สอนแทน
  { day: 2, period: '3', leave: 'L2', orig: 'teacher2', sub: 'teacher1', code: 'พ22101', name: 'สุขศึกษา', cls: 'ม.2/1', room: 'โรงยิม', status: 'จัดแล้ว' },
  // สร้างเอง ไม่มีใบลา — ต้องไม่มีป้ายประเภทการลา
  { day: 0, period: '4', leave: null, orig: 'teacher2', sub: 'teacher1', code: 'พ22101', name: 'สุขศึกษา', cls: 'ม.2/1', room: '',       status: 'จัดแล้ว' },
  // ยังไม่ได้จัด
  { day: 3, period: '3', leave: 'L2', orig: 'teacher2', sub: '',         code: 'พ22101', name: 'สุขศึกษา', cls: 'ม.2/1', room: 'โรงยิม', status: 'รอจัด' },
  // ครูกลับมาเอง เลยยกเลิกไป
  { day: 1, period: '2', leave: 'L1', orig: 'teacher1', sub: '',         code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'ยกเลิก' },

  // ── ชุดทดสอบระบบจัดสอนแทนอัตโนมัติ (day 5-6 แยกจากชุดข้างบนเพื่อไม่ให้เทสชนกัน) ──
  // AUTO_SCIENCE + AUTO_CLASH อยู่ "วันเดียวกัน คาบเดียวกัน" คนละห้อง — ทางเดียวที่จะ
  // ทดสอบว่าระบบไม่จัดครูคนเดียวกันซ้อน 2 คาบในรอบ preview เดียว
  // ⚠️ ไม่มีคาบ HR ในชุดนี้ — คาบโฮมรูมไม่เข้าระบบสอนแทนแล้ว (manualCreateAffected กรองออก)
  { day: 5, period: '2', leave: null, orig: 'teacher1', sub: '',         code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'รอจัด' },
  { day: 5, period: '2', leave: null, orig: 'teacher2', sub: '',         code: 'พ22101', name: 'สุขศึกษา', cls: 'ม.2/1', room: 'โรงยิม', status: 'รอจัด' },
  // คาบ 4 → teacher3 ติดคาบสอนตัวเอง, teacher4 ลาวันนี้ (L3) — ทั้งคู่ต้องไม่ถูกเสนอ
  { day: 6, period: '4', leave: null, orig: 'teacher1', sub: '',         code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'รอจัด' },
];

// ประวัติสอนแทนย้อนหลังของ teacher4 — ตัวถ่วงคะแนน "กระจายภาระ" (หน้าต่าง 30 วัน)
// ไม่ผูกใบลา ไม่กระทบแท็บไหนเพราะอยู่นอกช่วงวันที่ที่หน้าเปิดมา
const PAST_SUBSTITUTES = [
  { back: 2, period: '1', sub: 'teacher4', orig: 'teacher1', code: 'ว30205', name: 'ฟิสิกส์', cls: 'ม.6/1', room: '214' },
  { back: 3, period: '1', sub: 'teacher4', orig: 'teacher1', code: 'ว30205', name: 'ฟิสิกส์', cls: 'ม.6/1', room: '214' },
  { back: 4, period: '1', sub: 'teacher4', orig: 'teacher1', code: 'ว30205', name: 'ฟิสิกส์', cls: 'ม.6/1', room: '214' },
  { back: 5, period: '1', sub: 'teacher4', orig: 'teacher1', code: 'ว30205', name: 'ฟิสิกส์', cls: 'ม.6/1', room: '214' },
];

const HOLIDAYS = [
  { id: 'EVTDEV_1', title: 'วันแม่แห่งชาติ', date: '2026-08-12' },
  { id: 'EVTDEV_2', title: 'วันเข้าพรรษา',   date: '2026-07-30' },
];

async function main() {
  // ล้างเฉพาะตารางข้อมูล — system_settings / curriculum / print_config ก๊อปมาจาก prod ไว้แล้ว
  const wipe = [
    'score_history', 'score_database', 'qualitative_assess', 'grade_summary', 'subject_config',
    'attendance', 'academic_records', 'detailed_lesson_records', 'morning_activity',
    'club_members', 'club_advisors', 'clubs',
    'substitute_assignments', 'leave_records', 'sarabun', 'budgets',
    'calendar_events', 'timetable', 'media_cards', 'user_history', 'users',
  ];
  for (const t of wipe) {
    await query(`DELETE FROM ${t}`).catch(e => console.warn(`  ข้าม ${t}: ${e.message}`));
  }

  // users ต้องมาก่อน timetable — timetable_teacher_id_fkey อ้าง users.username
  for (const t of TEACHERS) {
    await query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       VALUES($1,'1234',$2,$3,$4,$5,$6,'ปกติ')`,
      [t.username, t.name, t.role, t.dept, `${t.username}@dev.local`, YEAR]
    );
  }
  for (const s of STUDENTS) {
    await query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       VALUES($1,'1234',$2,'Student',$3,$4,$5,'ปกติ')`,
      [s.id, s.name, s.cls, `${s.id}@dev.local`, YEAR]
    );
  }

  // สื่อการสอน — 3 ใบครอบทุกกรณีของกติกาการมองเห็น:
  // ปักหมุด+ทุกชั้น / เฉพาะ ม.2 / ไม่ระบุชั้นเลย (= ครูเท่านั้น เช่นเฉลยข้อสอบ)
  const MEDIA_CARDS = [
    ['สุขศึกษาและพลศึกษา ม.2', 'สุขศึกษาและพลศึกษา', 'fa-heart-pulse', '#00897b',
     '14 หน่วยการเรียนรู้', 'เนื้อหาครบทุกหน่วยตามตัวชี้วัด',
     'https://health-m2.vercel.app', ['ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'], true, ''],
    ['ใบงานสุขศึกษา ม.2', 'สุขศึกษาและพลศึกษา', 'fa-book', '#00897b',
     'ใบงาน', 'ใบงานประกอบหน่วยที่ 1',
     'https://example.com/worksheet', ['ม.2'], false, 'teacher2'],
    ['เฉลยข้อสอบกลางภาค', 'สุขศึกษาและพลศึกษา', 'fa-file-pdf', '#c62828',
     'เฉลย', 'เฉลยข้อสอบ ห้ามให้นักเรียนเห็น',
     'https://example.com/answers', [], false, 'teacher2'],
  ];
  for (const m of MEDIA_CARDS) {
    await query(
      `INSERT INTO media_cards(title,subject_group,icon,color,meta,description,url,
                               visible_levels,is_featured,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, m
    );
  }

  for (const sub of SUBJECTS) {
    for (const [day, period] of sub.slots) {
      await query(
        `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
         VALUES($1,$2,$3,$4,'',$5,$6,$7,$8,$9)`,
        [sub.code, sub.name, sub.level, sub.room, sub.teacher, day, period, TERM, YEAR]
      );
    }
    await query(
      `INSERT INTO subject_config(subject_id,subject_code,class_name,term,year,score_ratio,indicators_json,teacher_id)
       VALUES($1,$2,$3,$4,$5,'50:20:30',$6,$7)`,
      [`${sub.code}_${sub.level}/${sub.room}_${TERM}_${YEAR}`, sub.code, `${sub.level}/${sub.room}`,
       TERM, YEAR,
       JSON.stringify([
         { code: '', name: 'ชิ้นงานที่ 1', score: 25, description: '' },
         { code: '', name: 'ชิ้นงานที่ 2', score: 25, description: '' },
       ]),
       sub.teacher]
    );
  }

  // HR ต้องครบ จันทร์-ศุกร์ period '0' ไม่งั้น HR หายไปบางวัน (ดู CLAUDE.md)
  // ม.2/1 มีครูที่ปรึกษา 2 คน เหมือน production (ทุกห้องที่นั่นมี 2 คน) — ครูที่ปรึกษาร่วม
  // คือคนที่ควรรับคาบโฮมรูมแทนเมื่ออีกคนลา
  for (const [cls, teachers] of [[['ม.2', '1'], ['teacher2', 'teacher5']]]) {
    for (const teacherId of teachers) {
      for (const day of ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']) {
        await query(
          `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
           VALUES('HR','กิจกรรมโฮมรูมหน้าเสาธง',$1,$2,'',$3,$4,'0',$5,$6)`,
          [cls[0], cls[1], teacherId, day, TERM, YEAR]
        );
      }
    }
  }

  // เช็คชื่อไว้บางคาบ ให้มีทั้งช่องที่เช็คแล้วและช่องว่างใน massive grid
  const sub = SUBJECTS[0];
  const cls = `${sub.level}/${sub.room}`;
  for (const date of ['2026-05-13', '2026-05-14']) {
    const sessionId = `${date}|${sub.code}|${cls}|${date === '2026-05-13' ? '2' : '1'}`;
    for (const s of STUDENTS.filter(x => x.cls === cls)) {
      await query(
        `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,student_id,student_name,status,session_id,teacher_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [date, TERM, YEAR, sub.code, sub.name, cls, date === '2026-05-13' ? '2' : '1',
         s.id, s.name, s.id === '01903' ? 'ขาด' : 'มา', sessionId, sub.teacher]
      );
    }
  }

  // คะแนนบางส่วน — จงใจกรอกไม่ครบ เพื่อให้ completeness gate ของ grade_summary ทำงาน
  for (const s of STUDENTS.filter(x => x.cls === cls)) {
    for (const [ind, score] of [['formative_0', '20'], ['remark', '-']]) {
      await query(
        `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [`${s.id}_${sub.code}_${ind}_${TERM}_${YEAR}`, s.id, sub.code, ind, score, TERM, YEAR]
      );
    }
  }

  const teacherName = (id) => (TEACHERS.find(t => t.username === id) || {}).name || '';

  // ใบลาต้องมาก่อน substitute_assignments — leave_id เป็น FK ชี้มาที่นี่
  const leaveIds = {};
  for (const lv of LEAVES) {
    const start = SUB_DAY(lv.day).date;
    const end = SUB_DAY(lv.day + lv.days - 1).date;
    const { rows } = await query(
      `INSERT INTO leave_records(teacher_id,staff_name,type,start_date,end_date,days,reason,status,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,'อนุมัติ',$8) RETURNING id`,
      [lv.teacher, teacherName(lv.teacher), lv.type, start, end, lv.days, lv.reason, YEAR]
    );
    leaveIds[lv.key] = rows[0].id;
  }

  for (const s of SUBSTITUTES) {
    const { date, dow } = SUB_DAY(s.day);
    await query(
      `INSERT INTO substitute_assignments(
         leave_id, date, period, day_of_week,
         original_teacher_id, original_teacher_name,
         sub_teacher_id, sub_teacher_name,
         subject_code, subject_name, class, room, status, assigned_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [s.leave ? leaveIds[s.leave] : null,
       date, s.period, dow,
       s.orig, teacherName(s.orig),
       s.sub || null, s.sub ? teacherName(s.sub) : null,
       s.code, s.name, s.cls, s.room, s.status,
       s.status === 'จัดแล้ว' ? 'admin' : null]
    );
  }

  for (const p of PAST_SUBSTITUTES) {
    const { date, dow } = SUB_PAST_DAY(p.back);
    await query(
      `INSERT INTO substitute_assignments(
         leave_id, date, period, day_of_week,
         original_teacher_id, original_teacher_name,
         sub_teacher_id, sub_teacher_name,
         subject_code, subject_name, class, room, status, assigned_by)
       VALUES(NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'จัดแล้ว','admin')`,
      [date, p.period, dow, p.orig, teacherName(p.orig), p.sub, teacherName(p.sub),
       p.code, p.name, p.cls, p.room]
    );
  }

  // สีแดง = วันหยุด (ข้อตกลงเรื่องสี ไม่ใช่คอลัมน์ใน schema)
  for (const h of HOLIDAYS) {
    await query(
      `INSERT INTO calendar_events(id,title,start_date,color,created_by)
       VALUES($1,$2,$3,'#dc3545','seed')`,
      [h.id, h.title, h.date]
    );
  }

  const counts = {};
  for (const t of ['users', 'timetable', 'subject_config', 'attendance', 'score_database', 'calendar_events', 'substitute_assignments']) {
    counts[t] = (await query(`SELECT COUNT(*) c FROM ${t}`)).rows[0].c;
  }
  console.log('✅ seed เสร็จ:', JSON.stringify(counts));
  console.log('   login: admin/1234, teacher1..teacher5/1234');
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
