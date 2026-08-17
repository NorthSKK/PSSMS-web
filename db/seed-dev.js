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

// ครู 2 คน — ใช้ทดสอบเคส "ครูคนอื่นแก้ข้อมูลเราไม่ได้"
const TEACHERS = [
  { username: 'admin',    name: 'ผู้ดูแลระบบ',        role: 'Admin',   dept: 'บริหาร' },
  { username: 'teacher1', name: 'ครูสมชาย ใจดี',      role: 'Teacher', dept: 'วิทยาศาสตร์และเทคโนโลยี' },
  { username: 'teacher2', name: 'ครูสมหญิง ตั้งใจสอน', role: 'Teacher', dept: 'สุขศึกษาและพลศึกษา' },
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

// ใบลา — substitute_assignments.leave_id ชี้มาที่นี่ หน้าจัดสอนแทนเอา type ไปโชว์ว่าลาอะไร
const LEAVES = [
  { key: 'L1', teacher: 'teacher1', type: 'ลากิจ',  day: 0, days: 3, reason: 'ธุระครอบครัว' },
  { key: 'L2', teacher: 'teacher2', type: 'ลาป่วย', day: 2, days: 2, reason: 'ไข้หวัดใหญ่' },
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
  { day: 3, period: '0', leave: 'L2', orig: 'teacher2', sub: '',         code: 'HR',     name: 'กิจกรรมโฮมรูมหน้าเสาธง', cls: 'ม.2/1', room: '', status: 'รอจัด' },
  // ครูกลับมาเอง เลยยกเลิกไป
  { day: 1, period: '2', leave: 'L1', orig: 'teacher1', sub: '',         code: 'ว30205', name: 'ฟิสิกส์',   cls: 'ม.6/1', room: '214',    status: 'ยกเลิก' },
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
    'calendar_events', 'timetable', 'user_history', 'users',
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
  for (const day of ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์']) {
    await query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,location,teacher_id,day,period,term,year)
       VALUES('HR','กิจกรรมโฮมรูมหน้าเสาธง','ม.2','1','','teacher2',$1,'0',$2,$3)`,
      [day, TERM, YEAR]
    );
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
  console.log('   login: admin/1234, teacher1/1234, teacher2/1234');
}

main().then(() => process.exit(0)).catch(e => { console.error('❌', e.message); process.exit(1); });
