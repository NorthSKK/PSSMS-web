'use strict';
/**
 * ข้อมูลตัวอย่างของเดโมสาธารณะ — ทำให้ทุกเมนูมีของจริงให้ดู
 *
 * ทำไมต้องมี: db/seed-dev.js สร้างข้อมูล "พอให้เทสต์ผ่าน" — นักเรียน 6 คน เช็คชื่อ 16 แถว
 * ชุมนุม งบประมาณ เงินออม บันทึกหลังสอน ว่างเปล่าทั้งหมด ซึ่งพอเอาไปเป็นเดโมให้โรงเรียนกด
 * คนกดจะเจอหน้าว่างในเมนูที่หน้าขายโฆษณาไว้ แล้วสรุปเอาเองว่าระบบยังทำไม่เสร็จ
 *
 * ⚠️ ทุกชื่อในไฟล์นี้สมมติขึ้น ห้ามนำข้อมูลจริงจาก production มาใส่เด็ดขาด
 *
 * ⚠️ ตัวสุ่มต้องเป็น deterministic — เดโมถูกล้างและ seed ใหม่ทุกคืนตี 3 ถ้าใช้ Math.random
 *    ชื่อและคะแนนจะเปลี่ยนทุกเช้า คนที่จดบัญชีไว้ลองเมื่อวานจะงงว่าทำไมข้อมูลไม่เหมือนเดิม
 */
const { query } = require('../lib/db');

// ---------------------------------------------------------------- ตัวสุ่มแบบคงที่
/** mulberry32 — เมล็ดเดิมให้ลำดับเดิมเสมอ ไม่ต้องพึ่ง library */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------- คลังชื่อสมมติ
const GIVEN_M = [
  'กิตติพงษ์', 'จิรายุ', 'ณัฐดนัย', 'ธีรภัทร', 'ปวริศ', 'ภูมิพัฒน์', 'รัชชานนท์', 'ศุภกร',
  'อนุวัฒน์', 'ธนกฤต', 'พีรวิชญ์', 'ชยพล', 'กฤตเมธ', 'ณภัทร', 'วรเมธ', 'สิรวิชญ์',
  'อติวิชญ์', 'ปุณณวิช', 'ธนดล', 'ภาคิน', 'กันตพงศ์', 'เตชิต', 'รัฐภูมิ', 'อิทธิพัทธ์',
];
const GIVEN_F = [
  'กัญญาณัฐ', 'ชนัญชิดา', 'ณิชากร', 'นภัสสร', 'พิชญาภา', 'มนัสนันท์', 'วรินทร', 'สุพิชญา',
  'ปรียาภรณ์', 'ธัญชนก', 'จิดาภา', 'ณัฐณิชา', 'พิมพ์ลภัส', 'ศิรประภา', 'อารีรัตน์', 'กชกร',
  'เบญญาภา', 'ปาลิตา', 'ญาณิศา', 'ธีรกานต์', 'ชญานิษฐ์', 'วิภาวี', 'สิริกร', 'อโรชา',
];
const SURNAME = [
  'ชัยวัฒน์', 'บุญมี', 'เพชรรัตน์', 'สุขสวัสดิ์', 'แก้วประเสริฐ', 'พันธ์ทอง', 'มงคลชัย',
  'รุ่งเรือง', 'อารีย์วงศ์', 'คงทรัพย์', 'สินสมบูรณ์', 'ใจงาม', 'โพธิ์ทอง', 'ปัญญาดี',
  'เจริญสุข', 'ทิพย์มณี', 'วัฒนกุล', 'ศิริพงศ์', 'เรืองศรี', 'บวรกิจ', 'สุวรรณโชติ',
  'แสนสุข', 'ธำรงชัย', 'พิทักษ์วงศ์', 'อินทรสุวรรณ', 'ยอดเยี่ยม', 'ชื่นบาน', 'ดำรงเดช',
  'ภูมิใจ', 'สถิตย์พงษ์', 'กิจเจริญ', 'นาคทอง',
];

/** ม.1-3 ใช้ เด็กชาย/เด็กหญิง · ม.4-6 ใช้ นาย/นางสาว — ผิดแล้วครูเห็นทันทีว่าปลอม */
function titleFor(className, isMale) {
  const level = parseInt(String(className).replace(/[^0-9]/, ''), 10) || 1;
  if (level <= 3) return isMale ? 'เด็กชาย' : 'เด็กหญิง';
  return isMale ? 'นาย' : 'นางสาว';
}

// ห้องเรียนของเดโม — ต้องตรงกับ level/room ของ SUBJECTS ใน seed-dev.js
// ไม่งั้นครูบางคนจะมีวิชาที่ไม่มีนักเรียนสักคน
const CLASSES = [
  { name: 'ม.1/1', count: 20, idBase: 11001 },
  { name: 'ม.2/1', count: 18, idBase: 12001 },
  { name: 'ม.5/1', count: 16, idBase: 15001 },
  { name: 'ม.6/1', count: 14, idBase: 16001 },
];

const CLUBS = [
  ['CLUB01', 'ชุมนุมคอมพิวเตอร์', 'ฝึกใช้โปรแกรมสำนักงานและตัดต่อวิดีโอเบื้องต้น', 25, 'teacher3'],
  ['CLUB02', 'ชุมนุมกีฬาเพื่อสุขภาพ', 'ออกกำลังกายและฝึกทักษะกีฬาสากล', 30, 'teacher5'],
  ['CLUB03', 'ชุมนุมรักษ์ภาษาไทย', 'อ่านทำนองเสนาะ แต่งคำประพันธ์ และเล่านิทาน', 20, 'teacher4'],
  ['CLUB04', 'ชุมนุมวิทยาศาสตร์รอบตัว', 'ทดลองวิทยาศาสตร์อย่างง่ายจากของใกล้ตัว', 25, 'teacher1'],
  ['CLUB05', 'ชุมนุมสวนพฤกษศาสตร์โรงเรียน', 'ดูแลแปลงเกษตรและจัดทำทะเบียนพรรณไม้', 20, 'teacher2'],
];

const BUDGETS = [
  ['BG01', 'โครงการยกระดับผลสัมฤทธิ์ทางการเรียน', 85000, 61200],
  ['BG02', 'โครงการพัฒนาแหล่งเรียนรู้และห้องสมุด', 60000, 58400],
  ['BG03', 'โครงการส่งเสริมสุขภาพและกีฬาสี', 45000, 12500],
  ['BG04', 'โครงการระบบดูแลช่วยเหลือนักเรียน', 38000, 30100],
  ['BG05', 'โครงการพัฒนาครูและบุคลากร', 72000, 25000],
  ['BG06', 'โครงการโรงเรียนปลอดขยะ', 25000, 24800],
];

// ---------------------------------------------------------------- วันที่
const THAI_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/** ห้ามใช้ toISOString() — ไทยเป็น UTC+7 เที่ยงคืนตามเครื่องจะกลายเป็นวันก่อนหน้าใน UTC */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** วันเรียนย้อนหลัง n วัน (ข้ามเสาร์-อาทิตย์) เรียงจากเก่าไปใหม่ */
function schoolDaysBack(weeks) {
  const out = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);            // เที่ยงวัน กัน DST/ปัดเศษ
  for (let i = weeks * 7; i >= 0; i--) {
    const x = new Date(d.getTime() - i * 86400000);
    const dow = x.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: ymd(x), dow: THAI_DOW[dow] });
  }
  return out;
}

// ---------------------------------------------------------------- ตัวเติมข้อมูล
async function fill({ term, year, teacherNames }) {
  const r = rng(20260901);           // เมล็ดคงที่ — ล้างแล้ว seed ใหม่ต้องได้ข้อมูลชุดเดิม
  const log = [];

  // ล้างของเดิมที่ผูกกับนักเรียน แล้วสร้างใหม่ทั้งชุด
  // savings_transactions ไม่อยู่ในรายการล้างของ seed-dev.js — ถ้าไม่ล้างที่นี่ยอดจะบวมขึ้นทุกคืน
  for (const t of ['savings_transactions', 'club_members', 'club_advisors', 'clubs',
                   'morning_activity', 'detailed_lesson_records', 'attendance',
                   'score_database', 'qualitative_assess', 'grade_summary', 'budgets']) {
    await query(`DELETE FROM ${t}`).catch(e => log.push(`ข้าม ${t}: ${e.message}`));
  }
  await query(`DELETE FROM users WHERE role='Student'`);

  // โลโก้โรงเรียน — หน้าล็อกอินดึงมาแสดงตั้งแต่ยังไม่ล็อกอินแล้ว (loadLoginBranding)
  // เดโมจึงต้องไม่มีตราของโรงเรียนจริงค้างอยู่ ไม่งั้นตราจริงจะไปคู่กับชื่อโรงเรียนสมมติ
  await query(`DELETE FROM system_settings WHERE key IN ('schoolLogo','school_logo')`);

  // ---------------------------------------------------------------- ผู้บริหาร
  // แดชบอร์ดผู้บริหารเป็นหนึ่งใน 12 ฟีเจอร์ที่โฆษณาบน pssms.app แต่ seed-dev ไม่มีบัญชี
  // role นี้เลย คนที่มาลองจึงไม่มีทางเห็นหน้านั้นได้เลย
  await query(
    `INSERT INTO users(username,password,full_name,role,department,email,year,status)
     VALUES('director','1234','นายประสิทธิ์ วุฒิคุณ','Executive','บริหาร','director@demo.local',$1,'ปกติ')
     ON CONFLICT (username) DO UPDATE SET full_name=EXCLUDED.full_name, role=EXCLUDED.role`,
    [year]
  );

  // ---------------------------------------------------------------- นักเรียน
  const students = [];
  const usedNames = new Set();
  for (const cls of CLASSES) {
    for (let i = 0; i < cls.count; i++) {
      const isMale = r() < 0.5;
      let full;
      do {
        full = `${titleFor(cls.name, isMale)}${pick(r, isMale ? GIVEN_M : GIVEN_F)} ${pick(r, SURNAME)}`;
      } while (usedNames.has(full));   // ชื่อซ้ำในห้องเดียวกันคือสิ่งที่ครูจับผิดได้ทันที
      usedNames.add(full);
      students.push({ id: String(cls.idBase + i), name: full, cls: cls.name, seat: i + 1 });
    }
  }
  for (const s of students) {
    await query(
      `INSERT INTO users(username,password,full_name,role,department,email,year,status)
       VALUES($1,'1234',$2,'Student',$3,$4,$5,'ปกติ')`,
      [s.id, s.name, s.cls, `${s.id}@demo.local`, year]
    );
  }
  log.push(`นักเรียน ${students.length} คน / ${CLASSES.length} ห้อง`);

  // ---------------------------------------------------------------- เช็คเวลาเรียน
  const { rows: subjects } = await query(
    `SELECT DISTINCT subject_code, subject_name, teacher_id, level, room, day, period
       FROM timetable WHERE term=$1 AND year=$2 AND subject_code NOT LIKE 'CLUB%'`,
    [term, year]
  );
  const days = schoolDaysBack(6);
  let attRows = 0;

  for (const sub of subjects) {
    const cls = `${sub.level}/${sub.room}`;
    const roster = students.filter(s => s.cls === cls);
    if (!roster.length) continue;

    for (const d of days) {
      if (d.dow !== sub.day) continue;
      const sessionId = `${sub.subject_code}_${cls}_${d.date}_${sub.period}`;
      for (const s of roster) {
        // ~93% มา · ที่เหลือกระจายเป็นลา/ป่วย/สาย/ขาด — ห้องที่ทุกคนมาครบทุกคาบดูปลอม
        const x = r();
        const status = x < 0.93 ? 'มา' : x < 0.955 ? 'สาย' : x < 0.975 ? 'ลา' : x < 0.99 ? 'ป่วย' : 'ขาด';
        await query(
          `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,
                                  student_id,student_name,status,session_id,teacher_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [d.date, term, year, sub.subject_code, sub.subject_name, cls, String(sub.period),
           s.id, s.name, status, sessionId, sub.teacher_id]
        );
        attRows++;
      }
    }
  }
  log.push(`เช็คชื่อ ${attRows} แถว (ย้อนหลัง 6 สัปดาห์)`);

  // ---------------------------------------------------------------- คะแนน
  // seed-dev ตั้งตัวชี้วัดไว้แค่ 2 ชิ้น ซึ่งพอเปิด ปพ.5 แล้วเห็นตารางสองคอลัมน์
  // ไม่เหมือนของจริงที่ครูกรอกกัน — เขียนทับด้วยโครง 50:20:30 เต็มรูปแบบ
  const RATIO = '50:20:30';
  const INDICATORS = [
    { code: 'ว1.1', name: 'ใบงาน/แบบฝึกหัด',   score: 15, description: '' },
    { code: 'ว1.2', name: 'ชิ้นงานรายบุคคล',    score: 15, description: '' },
    { code: 'ว2.1', name: 'งานกลุ่ม/นำเสนอ',    score: 10, description: '' },
    { code: 'ว2.2', name: 'ทดสอบย่อยระหว่างภาค', score: 10, description: '' },
  ];
  const EXAM_INDICATORS = [
    { code: 'กลางภาค', name: 'สอบกลางภาค', score: 20 },
    { code: 'ปลายภาค', name: 'สอบปลายภาค', score: 30 },
  ];

  const { rows: configs } = await query(
    `SELECT subject_code, class_name FROM subject_config WHERE term=$1 AND year=$2`,
    [term, year]
  );
  let scoreRows = 0, qualRows = 0;

  for (const cfg of configs) {
    await query(
      `UPDATE subject_config SET score_ratio=$1, indicators_json=$2, exam_indicators_json=$3
       WHERE subject_code=$4 AND class_name=$5 AND term=$6 AND year=$7`,
      [RATIO, JSON.stringify(INDICATORS), JSON.stringify(EXAM_INDICATORS),
       cfg.subject_code, cfg.class_name, term, year]
    );

    const roster = students.filter(s => s.cls === cfg.class_name);
    for (const s of roster) {
      // นักเรียนแต่ละคนมี "ระดับ" ของตัวเอง ไม่งั้นคะแนนสุ่มล้วนจะเกลี่ยเท่ากันหมด
      // แล้วหน้าจัดกลุ่มเสี่ยงจะไม่มีใครโผล่มาเลย
      const ability = 0.45 + r() * 0.5;
      const cells = [];

      for (const [idx, ind] of INDICATORS.entries()) {
        // ชิ้นสุดท้ายเว้นว่างบางคน — หน้า "ยังกรอกคะแนนไม่ครบ" ต้องมีของให้เตือนจริง
        if (idx === INDICATORS.length - 1 && r() < 0.12) continue;
        cells.push([`formative_${idx}`, Math.round(ind.score * Math.min(1, ability + (r() - 0.5) * 0.25))]);
      }
      cells.push(['midterm', Math.round(20 * Math.min(1, ability + (r() - 0.5) * 0.2))]);
      if (r() > 0.08) cells.push(['final', Math.round(30 * Math.min(1, ability + (r() - 0.5) * 0.2))]);

      for (const [ind, val] of cells) {
        await query(
          `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (student_id,subject_code,indicator_id,term,year) DO UPDATE SET score=EXCLUDED.score`,
          [`${s.id}_${cfg.subject_code}_${ind}_${term}_${year}`, s.id, cfg.subject_code,
           ind, String(Math.max(0, val)), term, year]
        );
        scoreRows++;
      }

      // คุณลักษณะอันพึงประสงค์ + อ่านคิดวิเคราะห์ — ปพ.5 มีสองบล็อกนี้เสมอ เว้นว่างแล้วดูไม่จบ
      const g = () => int(r, 2, 3);
      const c = [g(), g(), g(), g()], rd = [g(), g(), g(), g()];
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      await query(
        `INSERT INTO qualitative_assess(student_id,subject_code,term,year,
           char1,char2,char3,char4,char_total,char_grade,
           read1,read2,read3,read4,read_total,read_grade,comp)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (student_id,subject_code,term,year) DO NOTHING`,
        [s.id, cfg.subject_code, term, year,
         ...c.map(String), sum(c), Math.round(sum(c) / 4),
         ...rd.map(String), sum(rd), Math.round(sum(rd) / 4), int(r, 2, 3)]
      );
      qualRows++;
    }
  }
  log.push(`คะแนน ${scoreRows} ช่อง · คุณลักษณะ ${qualRows} คน`);

  // ---------------------------------------------------------------- ชุมนุม
  for (const [id, name, desc, cap, advisor] of CLUBS) {
    await query(
      `INSERT INTO clubs(club_id,club_name,description,capacity,term,year,status)
       VALUES($1,$2,$3,$4,$5,$6,'open')`, [id, name, desc, cap, term, year]
    );
    await query(
      `INSERT INTO club_advisors(club_id,teacher_id,teacher_name,role,term,year)
       VALUES($1,$2,$3,'หัวหน้า',$4,$5)`,
      [id, advisor, teacherNames[advisor] || advisor, term, year]
    );
  }
  // นักเรียนส่วนใหญ่ลงชุมนุมแล้ว เหลือค้างไว้บ้าง — หน้า "ยังไม่ลงทะเบียน" ต้องมีของให้เห็น
  let members = 0;
  for (const s of students) {
    if (r() < 0.12) continue;
    const club = CLUBS[int(r, 0, CLUBS.length - 1)];
    await query(
      `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
       VALUES($1,$2,$3,$4,$5,$6,'admin')
       ON CONFLICT (student_id,term,year) DO NOTHING`,
      [club[0], s.id, s.name, s.cls, term, year]
    );
    members++;
  }
  log.push(`ชุมนุม ${CLUBS.length} ชุมนุม สมาชิก ${members} คน`);

  // ---------------------------------------------------------------- งบประมาณ
  for (const [id, name, amount, used] of BUDGETS) {
    await query(
      `INSERT INTO budgets(project_id,project_name,budget_amount,used_amount,status,year,created_by)
       VALUES($1,$2,$3,$4,'active',$5,'admin')`, [id, name, amount, used, year]
    );
  }
  log.push(`งบประมาณ ${BUDGETS.length} โครงการ`);

  // ---------------------------------------------------------------- เงินออม
  const savers = students.filter(() => r() < 0.55);
  let txns = 0;
  for (const s of savers) {
    for (const d of days.filter((_, i) => i % 5 === 0)) {
      if (r() < 0.35) continue;
      await query(
        `INSERT INTO savings_transactions(student_id,student_name,class,type,amount,recorded_by,note,date,term,year)
         VALUES($1,$2,$3,'deposit',$4,'admin','ออมประจำสัปดาห์',$5,$6,$7)`,
        [s.id, s.name, s.cls, int(r, 2, 20) * 10, d.date, term, year]
      );
      txns++;
    }
    if (r() < 0.15) {
      await query(
        `INSERT INTO savings_transactions(student_id,student_name,class,type,amount,recorded_by,note,date,term,year)
         VALUES($1,$2,$3,'withdraw',$4,'admin','ถอนไปซื้ออุปกรณ์การเรียน',$5,$6,$7)`,
        [s.id, s.name, s.cls, int(r, 5, 15) * 10, days[days.length - 1].date, term, year]
      );
      txns++;
    }
  }
  log.push(`เงินออม ${txns} รายการ (${savers.length} คน)`);

  // ---------------------------------------------------------------- กิจกรรมหน้าเสาโธง
  const recentDays = days.slice(-5);
  let morning = 0;
  for (const d of recentDays) {
    for (const s of students) {
      const ok = r() < 0.9;
      await query(
        `INSERT INTO morning_activity(date,term,year,class,student_id,student_name,
                                      area_status,duty_status,flag_status,teacher_id,session_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'admin',$10)`,
        [d.date, term, year, s.cls, s.id, s.name,
         ok ? 'ผ่าน' : 'ไม่ผ่าน', ok ? 'ผ่าน' : 'ไม่ผ่าน', ok ? 'มา' : 'ขาด',
         `morning_${s.cls}_${d.date}`]
      );
      morning++;
    }
  }
  log.push(`กิจกรรมหน้าเสาธง ${morning} แถว`);

  // ---------------------------------------------------------------- บันทึกหลังสอน
  const TOPICS = [
    ['ระบบไหลเวียนโลหิต', 'นักเรียนอธิบายเส้นทางการไหลเวียนโลหิตได้ถูกต้อง',
     'นักเรียนบางส่วนสับสนระหว่างหลอดเลือดแดงกับหลอดเลือดดำ',
     'ใช้แผนภาพสีแยกสองระบบ และให้จับคู่อธิบายให้เพื่อนฟัง'],
    ['อาหารและสารอาหาร', 'นักเรียนจำแนกสารอาหารหลัก 5 หมู่ และคำนวณพลังงานได้',
     'ตัวอย่างอาหารในหนังสือไม่ใกล้ตัวนักเรียน',
     'เปลี่ยนมาใช้เมนูอาหารกลางวันของโรงเรียนเป็นโจทย์แทน'],
    ['การปฐมพยาบาลเบื้องต้น', 'นักเรียนสาธิตการห้ามเลือดและพันผ้าได้ถูกวิธี',
     'อุปกรณ์ฝึกไม่พอต่อจำนวนนักเรียน',
     'แบ่งกลุ่มหมุนเวียนสถานี และยืมชุดปฐมพยาบาลจากห้องพยาบาลเพิ่ม'],
    ['สารเสพติดและการป้องกัน', 'นักเรียนวิเคราะห์ปัจจัยเสี่ยงและเสนอแนวทางปฏิเสธได้',
     'นักเรียนไม่กล้าแสดงความเห็นในประเด็นอ่อนไหว',
     'ใช้การเขียนใส่กระดาษโดยไม่ระบุชื่อ แล้วครูอ่านรวมให้ฟัง'],
  ];
  let lessons = 0;
  const teachDays = days.filter(d => d.dow === 'อังคาร').slice(-TOPICS.length);
  for (const [i, d] of teachDays.entries()) {
    const [topic, outcomes, problems, solutions] = TOPICS[i % TOPICS.length];
    await query(
      `INSERT INTO detailed_lesson_records(date,term,year,subject_code,subject_name,class,period,
                                           topic,outcomes,problems,solutions,teacher_id,session_id)
       VALUES($1,$2,$3,'พ22101','สุขศึกษา','ม.2/1','3',$4,$5,$6,$7,'teacher2',$8)`,
      [d.date, term, year, topic, outcomes, problems, solutions, `lesson_${d.date}`]
    );
    lessons++;
  }
  log.push(`บันทึกหลังสอน ${lessons} คาบ`);

  return log;
}

module.exports = { fill, CLASSES };
