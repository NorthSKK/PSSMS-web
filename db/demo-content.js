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

/**
 * วันเรียนตั้งแต่เปิดเทอมถึงวันนี้ (ข้ามเสาร์-อาทิตย์)
 *
 * ต้องเป็นทั้งเทอมจริง ไม่ใช่ย้อนหลังไม่กี่สัปดาห์ เพราะหน้ากลุ่มเสี่ยงคิด % เวลาเรียน
 * จากคาบทั้งเทอม (periodsPerWeek x 20 สัปดาห์ — functions/attendanceReport.js)
 * ถ้ามีข้อมูลแค่ 6 สัปดาห์ ต่อให้นักเรียนขาดทุกคาบก็ยังได้ 70% ไม่มีใครเข้าข่าย มส. เลย
 * แล้วหน้าที่เราโฆษณาว่า "เห็นทันทีว่าใครเข้าข่าย มส." จะว่างเปล่าตลอดกาล
 */
function schoolDaysSince(startISO) {
  const out = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const start = new Date(`${startISO}T12:00:00`);
  for (let x = new Date(start); x <= today; x = new Date(x.getTime() + 86400000)) {
    const dow = x.getDay();
    if (dow === 0 || dow === 6) continue;
    out.push({ date: ymd(x), dow: THAI_DOW[dow] });
  }
  return out;
}

/**
 * ใส่ทีละก้อน — ทั้งเทอมมีเช็คชื่อหลายพันแถว ยิงทีละ INSERT บนเครื่องคลาวด์
 * คือหลายพัน round trip ทำให้รอบล้างประจำคืนกินเวลาเป็นนาที
 */
async function insertBatch(head, cols, rowsArr, chunk = 400) {
  for (let i = 0; i < rowsArr.length; i += chunk) {
    const slice = rowsArr.slice(i, i + chunk);
    const values = slice.map((_, k) =>
      '(' + Array.from({ length: cols }, (_, c) => `$${k * cols + c + 1}`).join(',') + ')'
    ).join(',');
    await query(`${head} VALUES ${values}`, slice.flat());
  }
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
  const { rows: td } = await query(
    `SELECT value1 FROM system_settings WHERE key='TermData' AND subkey=$1`, [`${term}_${year}`]
  );
  const termStart = (td[0] && td[0].value1) || ymd(new Date(Date.now() - 120 * 86400000));
  const days = schoolDaysSince(termStart);

  // นิสัยการมาเรียนของนักเรียนแต่ละคน — ห้องที่ทุกคนมาเกือบครบเท่ากันหมดดูปลอม
  // และทำให้หน้ากลุ่มเสี่ยงไม่มีใครขึ้นเลย ซึ่งเป็นฟีเจอร์ที่เราโฆษณาไว้
  //   ปกติ ~93% ของห้อง · เสี่ยง ~5% (ขาดจนต่ำกว่า 80%) · หนัก ~2% (ต่ำกว่า 60% = เข้าข่าย มส.)
  // กำหนดเป็นจำนวนคน "ต่อห้อง" ไม่ใช่สุ่มเป็น % ของทั้งโรงเรียน
  // สุ่มรวมทำให้คนขาดเรื้อรังไปกองอยู่ห้องเดียว แล้วครูห้องอื่นเปิดหน้ากลุ่มเสี่ยงมาเจอศูนย์
  const missRate = new Map();
  for (const cls of CLASSES) {
    const roster = students.filter(s => s.cls === cls.name);
    const order = roster.map((s, i) => ({ s, k: r() })).sort((a, b) => a.k - b.k).map(o => o.s);
    order.forEach((s, i) => {
      // 1 คนขาดหนักจนเข้าข่าย มส. · 2 คนเริ่มน่าห่วง · ที่เหลือปกติ
      const rate = i === 0 ? 0.55 + r() * 0.15
                 : i <= 2  ? 0.18 + r() * 0.08
                           : 0.02 + r() * 0.05;
      missRate.set(s.id, rate);
    });
  }
  let attRows = 0;
  const attBatch = [];

  for (const sub of subjects) {
    const cls = `${sub.level}/${sub.room}`;
    const roster = students.filter(s => s.cls === cls);
    if (!roster.length) continue;

    for (const d of days) {
      if (d.dow !== sub.day) continue;
      const sessionId = `${sub.subject_code}_${cls}_${d.date}_${sub.period}`;
      for (const s of roster) {
        const miss = missRate.get(s.id);
        const x = r();
        // 'สาย' ไม่นับเป็นขาดในสูตร % เวลาเรียน จึงแยกออกจากโควตาการขาด
        const status = x < miss ? (r() < 0.55 ? 'ขาด' : r() < 0.6 ? 'ลา' : 'ป่วย')
                     : x < miss + 0.03 ? 'สาย' : 'มา';
        attBatch.push([d.date, term, year, sub.subject_code, sub.subject_name, cls,
                       String(sub.period), s.id, s.name, status, sessionId, sub.teacher_id]);
        attRows++;
      }
    }
  }
  await insertBatch(
    `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,
                            student_id,student_name,status,session_id,teacher_id)`,
    12, attBatch
  );
  log.push(`เช็คชื่อ ${attRows} แถว (${days.length} วันเรียน ตั้งแต่ ${termStart})`);

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
    `SELECT subject_code, class_name, teacher_id FROM subject_config WHERE term=$1 AND year=$2`,
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
  // คนแรกของทุกห้องต้องมีเสมอ — บัญชี "นักเรียน" บนหน้าล็อกอินชี้ไปที่คนแรกสุด
  // ถ้าปล่อยให้สุ่มล้วน คนที่กดลองอาจเปิดหน้าเงินออมมาแล้วเจอศูนย์บาท
  const firstOfClass = new Set(CLASSES.map(c => String(c.idBase)));
  const savers = students.filter(s => firstOfClass.has(s.id) || r() < 0.55);
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

  // ---------------------------------------------------------------- โฮมรูม + คาบชุมนุม
  // seed-dev ตั้ง HR ไว้ให้ ม.2/1 ห้องเดียว ห้องอื่นเปิดหน้าโฮมรูมมาแล้วว่าง
  // และไม่มีคาบชุมนุมในตารางเลย ทั้งที่มีเมนูชุมนุมอยู่
  const HOMEROOM = { 'ม.1/1': 'teacher4', 'ม.2/1': 'teacher2', 'ม.5/1': 'teacher3', 'ม.6/1': 'teacher1' };
  const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  let ttRows = 0;
  for (const [cls, tid] of Object.entries(HOMEROOM)) {
    const [level, room] = cls.split('/');
    for (const d of WEEKDAYS) {
      await query(
        `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
         SELECT 'HR','กิจกรรมโฮมรูมหน้าเสาธง',$1,$2,$3,$4,'0',$5,$6
         WHERE NOT EXISTS (SELECT 1 FROM timetable WHERE subject_code='HR' AND level=$1 AND room=$2
                             AND teacher_id=$3 AND day=$4 AND term=$5 AND year=$6)`,
        [level, room, tid, d, term, year]
      );
      ttRows++;
    }
  }
  // คาบชุมนุมวันพฤหัสบดี คาบ 7 — ครูที่ปรึกษาชุมนุมเห็นในตารางสอนตัวเอง
  for (const [id, name, , , advisor] of CLUBS) {
    await query(
      `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
       VALUES($1,$2,'ชุมนุม',$3,$4,'พฤหัสบดี','7',$5,$6)`,
      [`CLUB_${id}`, name, id, advisor, term, year]
    );
    ttRows++;
  }
  log.push(`ตารางสอน +${ttRows} คาบ (โฮมรูม 4 ห้อง + ชุมนุม)`);

  // ---------------------------------------------------------------- เช็คชื่อชุมนุม
  // getClubAttendanceSummary อ่านจากตาราง attendance ที่ subject_code ขึ้นต้น CLUB_
  const clubDays = days.filter(d => d.dow === 'พฤหัสบดี');
  const membersByClub = {};
  const { rows: memRows } = await query(
    `SELECT club_id, student_id, student_name, class_name FROM club_members WHERE term=$1 AND year=$2`,
    [term, year]
  );
  for (const m of memRows) (membersByClub[m.club_id] ||= []).push(m);

  let clubAtt = 0;
  for (const [id, name, , , advisor] of CLUBS) {
    for (const d of clubDays) {
      for (const m of membersByClub[id] || []) {
        await query(
          `INSERT INTO attendance(date,term,year,subject_code,subject_name,class,period,
                                  student_id,student_name,status,session_id,teacher_id)
           VALUES($1,$2,$3,$4,$5,$6,'7',$7,$8,$9,$10,$11)`,
          [d.date, term, year, `CLUB_${id}`, name, id,
           m.student_id, m.student_name, r() < 0.94 ? 'มา' : 'ขาด', `club_${id}_${d.date}`, advisor]
        );
        clubAtt++;
      }
    }
  }
  log.push(`เช็คชื่อชุมนุม ${clubAtt} แถว`);

  // ---------------------------------------------------------------- ใบลา
  // seed-dev ทิ้งไว้ 3 ใบและอนุมัติหมดแล้ว หน้าอนุมัติของผู้บริหารจึงว่างเปล่า
  const LEAVES = [
    ['teacher3', 'ลาป่วย',    -12, 2, 'เป็นไข้หวัดใหญ่ มีใบรับรองแพทย์',              'อนุมัติ',    'admin'],
    ['teacher5', 'ลากิจ',     -6,  1, 'ไปติดต่อราชการที่อำเภอ',                    'อนุมัติ',    'admin'],
    ['teacher4', 'ลาป่วย',    -3,  1, 'ปวดศีรษะไมเกรน',                          'อนุมัติ',    'admin'],
    ['teacher1', 'ลากิจ',      3,  2, 'ไปงานฌาปนกิจญาติที่ต่างจังหวัด',              'รอพิจารณา', null],
    ['teacher3', 'ลาพักร้อน',  7,  3, 'พาครอบครัวไปต่างจังหวัดช่วงปิดภาคเรียน',       'รอพิจารณา', null],
    ['teacher5', 'ลากิจ',      2,  1, 'ไปรับลูกที่โรงพยาบาล',                       'รอพิจารณา', null],
    ['teacher4', 'ลากิจ',     -20, 1, 'ธุระส่วนตัว',                               'ไม่อนุมัติ',  'admin'],
  ];
  const shift = (n) => {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    return ymd(new Date(d.getTime() + n * 86400000));
  };
  let leaveRows = 0;
  for (const [tid, type, offset, dayCount, reason, status, by] of LEAVES) {
    await query(
      `INSERT INTO leave_records(teacher_id,staff_name,type,start_date,end_date,days,reason,status,year,
                                 admin_comment,reviewed_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tid, teacherNames[tid] || tid, type, shift(offset), shift(offset + dayCount - 1), dayCount,
       reason, status, year,
       status === 'ไม่อนุมัติ' ? 'ช่วงสอบกลางภาค ขอให้เลื่อนวันลา' : '', by]
    );
    leaveRows++;
  }
  log.push(`ใบลา +${leaveRows} ใบ (รอพิจารณา 3)`);

  // ---------------------------------------------------------------- สรุปคาบสอน (ปพ.5 ช่องลงชื่อ)
  let acadRows = 0;
  const { rows: sessions } = await query(
    `SELECT session_id, MIN(date) AS date, MIN(subject_code) AS subject_code,
            MIN(subject_name) AS subject_name, MIN(class) AS class, MIN(period) AS period,
            MIN(teacher_id) AS teacher_id,
            COUNT(*) FILTER (WHERE status='มา')  AS present,
            COUNT(*) FILTER (WHERE status='ขาด') AS absent,
            COUNT(*) FILTER (WHERE status IN ('ลา','ป่วย')) AS leave
     FROM attendance WHERE term=$1 AND year=$2 AND subject_code NOT LIKE 'CLUB_%'
     GROUP BY session_id`,
    [term, year]
  );
  for (const s of sessions) {
    await query(
      `INSERT INTO academic_records(date,term,year,subject_code,subject_name,class,period,topic,
                                    present,absent,leave,teacher_id,signature,session_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [s.date, term, year, s.subject_code, s.subject_name, s.class, s.period,
       'สอนตามแผนการจัดการเรียนรู้', s.present, s.absent, s.leave, s.teacher_id,
       teacherNames[s.teacher_id] || s.teacher_id, s.session_id]
    );
    acadRows++;
  }
  log.push(`สรุปคาบสอน ${acadRows} คาบ`);

  // ---------------------------------------------------------------- สรุปเกรด
  // หน้ารายงานทุกรายวิชาและ Page_Grade_Summary อ่านจากตารางนี้ ไม่ได้คำนวณสด
  const GRADE = (pct) => pct >= 80 ? '4' : pct >= 75 ? '3.5' : pct >= 70 ? '3' : pct >= 65 ? '2.5'
                       : pct >= 60 ? '2' : pct >= 55 ? '1.5' : pct >= 50 ? '1' : '0';
  const { rows: totals } = await query(
    `SELECT s.student_id, s.subject_code, SUM(NULLIF(s.score,'')::numeric) AS total
     FROM score_database s
     WHERE s.term=$1 AND s.year=$2 AND s.indicator_id <> 'remark'
     GROUP BY s.student_id, s.subject_code`,
    [term, year]
  );
  const { rows: attPct } = await query(
    `SELECT student_id, subject_code,
            ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('มา','สาย')) / NULLIF(COUNT(*),0), 1) AS pct
     FROM attendance WHERE term=$1 AND year=$2 AND subject_code NOT LIKE 'CLUB_%'
     GROUP BY student_id, subject_code`,
    [term, year]
  );
  const pctMap = new Map(attPct.map(a => [`${a.student_id}_${a.subject_code}`, a.pct]));
  let gradeRows = 0;
  for (const t of totals) {
    const total = Number(t.total) || 0;
    const pct = pctMap.get(`${t.student_id}_${t.subject_code}`);
    await query(
      `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,remedial_status,
                                 attendance_percent,term,year)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (student_id,subject_code,term,year) DO UPDATE
         SET total_score=EXCLUDED.total_score, grade=EXCLUDED.grade,
             attendance_percent=EXCLUDED.attendance_percent`,
      [t.student_id, t.subject_code, total, GRADE(total),
       total < 50 ? 'ต้องซ่อมเสริม' : '', pct, term, year]
    );
    gradeRows++;
  }
  log.push(`สรุปเกรด ${gradeRows} แถว`);

  // ---------------------------------------------------------------- ประวัติการแก้คะแนน
  // หน้าแก้คะแนนมีปุ่มดูประวัติ ว่างอยู่จะดูเหมือนระบบไม่ได้บันทึกอะไรเลย
  let histRows = 0;
  for (const cfg of configs) {
    const roster = students.filter(s => s.cls === cfg.class_name).slice(0, 3);
    for (const s of roster) {
      const oldScore = int(r, 5, 12), newScore = oldScore + int(r, 1, 4);
      await query(
        `INSERT INTO score_history(teacher_id,student_id,subject_code,indicator_id,old_score,new_score,term,year)
         VALUES($1,$2,$3,'formative_0',$4,$5,$6,$7)`,
        [cfg.teacher_id || 'admin', s.id, cfg.subject_code, String(oldScore), String(newScore), term, year]
      );
      histRows++;
    }
  }
  log.push(`ประวัติแก้คะแนน ${histRows} รายการ`);

  // ---------------------------------------------------------------- ประวัติการแก้ข้อมูลผู้ใช้
  const uh = [
    ['11003', 'edit',   'admin', 'ย้ายห้องเรียนจาก ม.1/2 มา ม.1/1'],
    ['15004', 'edit',   'admin', 'แก้คำนำหน้าชื่อให้ถูกต้อง'],
    ['teacher4', 'edit','admin', 'ปรับวิชาเอกเป็นภาษาไทย'],
    ['16002', 'add',    'admin', 'นักเรียนย้ายเข้าระหว่างภาคเรียน'],
  ];
  for (const [username, action, by, note] of uh) {
    await query(
      `INSERT INTO user_history(username,action,changed_by,old_data,new_data)
       VALUES($1,$2,$3,$4,$5)`,
      [username, action, by, JSON.stringify({}), JSON.stringify({ note })]
    );
  }
  log.push(`ประวัติแก้ข้อมูลผู้ใช้ ${uh.length} รายการ`);

  // ---------------------------------------------------------------- ปฏิทินโรงเรียน
  const EVENTS = [
    ['เปิดภาคเรียนที่ 1/2569', -113, 0, '#2e7d32', 'นักเรียนทุกระดับชั้นเข้าเรียนตามปกติ'],
    ['สอบกลางภาค',            -21,  2, '#c62828', 'งดการเรียนการสอนตามตารางปกติ'],
    ['กิจกรรมวันวิทยาศาสตร์',   -9,   0, '#1565c0', 'จัดที่หอประชุม นักเรียนแต่งกายชุดนักเรียน'],
    ['ประชุมผู้ปกครองชั้นเรียน',  5,   0, '#6a1b9a', 'ภาคเช้า ม.ต้น · ภาคบ่าย ม.ปลาย'],
    ['กีฬาสีภายใน',            12,  2, '#ef6c00', 'งดการเรียนการสอน 3 วัน'],
    ['สอบปลายภาค',             33,  4, '#c62828', 'ตามตารางสอบที่ฝ่ายวิชาการกำหนด'],
    ['ส่งผลการเรียน ปพ.5',      40,  0, '#00897b', 'ครูผู้สอนส่งไฟล์และเอกสารที่ฝ่ายวิชาการ'],
  ];
  await query(`DELETE FROM calendar_events`);
  for (const [title, offset, span, color, desc] of EVENTS) {
    await query(
      `INSERT INTO calendar_events(title,start_date,end_date,color,description,created_by)
       VALUES($1,$2,$3,$4,$5,'admin')`,
      [title, shift(offset), shift(offset + span), color, desc]
    );
  }
  log.push(`ปฏิทินโรงเรียน ${EVENTS.length} รายการ`);

  // ---------------------------------------------------------------- รายการสิ่งที่ต้องทำ
  // เก็บใน system_settings key='todo' subkey=<username> (functions/getTodoList.js)
  const TODOS = {
    admin: [
      ['ตรวจใบลาที่ค้างอยู่ 3 ใบ', false],
      ['จัดครูสอนแทนสัปดาห์หน้า', false],
      ['ส่งรายงานจำนวนนักเรียนให้ สพม.', false],
      ['อัปเดตตารางสอนหลังปรับคาบชุมนุม', true],
      ['แจ้งครูเรื่องกำหนดส่ง ปพ.5', true],
    ],
    director: [
      ['ประชุมหัวหน้ากลุ่มสาระ วันพุธ 14.00 น.', false],
      ['ติดตามผลการใช้งบโครงการที่ยังไม่เบิก', false],
      ['ลงนามคำสั่งแต่งตั้งกรรมการกีฬาสี', true],
    ],
    teacher1: [
      ['ส่งแผนการสอนหน่วยที่ 5', false],
      ['เตรียมข้อสอบปลายภาค ฟิสิกส์ ม.6', false],
      ['กรอกคะแนนชิ้นงานที่ 4 ให้ครบ', false],
    ],
    teacher2: [
      ['กรอกคะแนนสอบกลางภาค ม.2/1', false],
      ['ตามงานนักเรียนที่ยังไม่ส่ง 3 คน', false],
      ['เตรียมสื่อหน่วยสารเสพติด', false],
      ['ส่งบันทึกหลังสอนสัปดาห์นี้', true],
      ['เช็คเวลาเรียนนักเรียนกลุ่มเสี่ยง มส.', true],
    ],
    teacher3: [
      ['ยืมชุดทดลองจากห้องปฏิบัติการ', false],
      ['ส่งรายชื่อสมาชิกชุมนุมคอมพิวเตอร์', true],
    ],
    teacher4: [
      ['ตรวจสมุดบันทึกการอ่าน ม.1/1', false],
      ['เตรียมแข่งทักษะอ่านทำนองเสนาะ', false],
    ],
    teacher5: [
      ['จัดสนามกีฬาสีภายใน', false],
      ['ตรวจสุขภาพนักเรียนรอบที่ 2', true],
    ],
  };
  let todoUsers = 0;
  for (const [username, items] of Object.entries(TODOS)) {
    const json = JSON.stringify(items.map(([text, done]) => ({ text, done, notionId: null })));
    await query(
      `INSERT INTO system_settings(key, subkey, value1) VALUES('todo',$1,$2)
       ON CONFLICT (key, subkey) DO UPDATE SET value1=EXCLUDED.value1`,
      [username, json]
    );
    todoUsers++;
  }
  // นักเรียนสองคนแรกมีรายการของตัวเองด้วย — หน้านักเรียนใช้ช่องเดียวกัน
  for (const s of students.slice(0, 2)) {
    await query(
      `INSERT INTO system_settings(key, subkey, value1) VALUES('todo',$1,$2)
       ON CONFLICT (key, subkey) DO UPDATE SET value1=EXCLUDED.value1`,
      [s.id, JSON.stringify([
        { text: 'ส่งใบงานวิชาภาษาไทย', done: false, notionId: null },
        { text: 'เตรียมชุดกีฬาวันพฤหัสบดี', done: false, notionId: null },
        { text: 'ส่งเงินค่าอาหารกลางวัน', done: true, notionId: null },
      ])]
    );
    todoUsers++;
  }
  log.push(`สิ่งที่ต้องทำ ${todoUsers} คน`);

  return log;
}

/** ต้องเรียก *หลัง* seed-demo.js ใส่การ์ดสื่อของตัวเองแล้ว ไม่งั้นโดน DELETE ทับ */
async function fillMediaTrash() {
  // ---------------------------------------------------------------- ถังขยะสื่อการสอน
  // เมนูถังขยะของ Admin ว่างอยู่ ทั้งที่เป็นฟีเจอร์ที่ต้องโชว์ว่ากู้คืนได้
  await query(
    `INSERT INTO media_cards(title,subject_group,icon,color,meta,description,url,card_type,
                             visible_levels,is_featured,created_by,deleted_at)
     VALUES('ใบงานเก่าปีการศึกษา 2568','คณิตศาสตร์','fa-file-lines','#78909c','ใบงาน 8 ชุด',
            'ชุดใบงานของปีที่แล้ว เก็บไว้ก่อนเผื่อต้องใช้อ้างอิง',
            'https://drive.google.com/drive/folders/demo3','link',$1,false,'teacher2', NOW() - INTERVAL '3 days')`,
    [['ม.2']]
  );

  return 'ถังขยะสื่อ 1 การ์ด';
}

module.exports = { fill, fillMediaTrash, CLASSES };
