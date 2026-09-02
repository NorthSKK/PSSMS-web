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

/**
 * รายวิชาที่เปิดสอน — ครูหนึ่งคนสอนหลายห้อง เหมือนภาระงานจริง
 *
 * seed-dev ให้ครูคนละวิชาห้องเดียว (teacher2 มีคาบเดียวทั้งสัปดาห์) ซึ่งพอเปิด
 * ตารางสอนบนเดโมแล้วเห็นช่องว่างเกือบทั้งตาราง ไม่มีครูคนไหนสอนแบบนั้นจริง
 *
 * [subject_code, ชื่อวิชา, ครู, ห้อง, คาบต่อสัปดาห์]
 */
const SUBJECTS = [
  // teacher4 — ภาษาไทย
  ['ท21101', 'ภาษาไทย',            'teacher4', 'ม.1/1', 3],
  ['ท22101', 'ภาษาไทย',            'teacher4', 'ม.2/1', 3],
  ['ท33101', 'ภาษาไทย',            'teacher4', 'ม.6/1', 2],
  // teacher3 — วิทยาศาสตร์
  ['ว21101', 'วิทยาศาสตร์',         'teacher3', 'ม.1/1', 3],
  ['ว22101', 'วิทยาศาสตร์',         'teacher3', 'ม.2/1', 3],
  ['ว31101', 'วิทยาศาสตร์กายภาพ',   'teacher3', 'ม.5/1', 3],
  // teacher1 — ฟิสิกส์ (เพิ่มเติม ม.ปลาย)
  ['ว30201', 'ฟิสิกส์ 1',           'teacher1', 'ม.5/1', 3],
  ['ว30205', 'ฟิสิกส์ 3',           'teacher1', 'ม.6/1', 3],
  // teacher2 — สุขศึกษา (บัญชีครูของเดโม ให้ครบทุกระดับชั้น)
  ['พ21101', 'สุขศึกษา',            'teacher2', 'ม.1/1', 2],
  ['พ22101', 'สุขศึกษา',            'teacher2', 'ม.2/1', 2],
  ['พ32101', 'สุขศึกษา',            'teacher2', 'ม.5/1', 1],
  ['พ33101', 'สุขศึกษา',            'teacher2', 'ม.6/1', 1],
  // teacher5 — พลศึกษา
  ['พ21103', 'พลศึกษา',            'teacher5', 'ม.1/1', 1],
  ['พ22103', 'พลศึกษา',            'teacher5', 'ม.2/1', 1],
  ['พ32103', 'พลศึกษา',            'teacher5', 'ม.5/1', 1],
  ['พ33103', 'พลศึกษา',            'teacher5', 'ม.6/1', 1],
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

/**
 * จัดตารางสอน — คาบ 1-6 วันจันทร์ถึงศุกร์
 *
 * ตรวจชนสองทาง: ครูอยู่สองที่พร้อมกันไม่ได้ และห้องเรียนมีสองวิชาซ้อนกันไม่ได้
 * ถ้าไม่ตรวจ ตารางที่ได้จะขัดแย้งในตัวเอง แล้วระบบจัดสอนแทน (ซึ่งเช็คว่าครูว่างคาบไหน)
 * จะเสนอชื่อครูที่ติดคาบอยู่ — บั๊กที่มองไม่เห็นจนกว่าจะมีคนกดใช้จริง
 *
 * คาบ 0 = โฮมรูม · คาบ 7 วันพฤหัสบดี = ชุมนุม จึงไม่แตะสองช่องนี้
 */
function buildTimetable(rand) {
  const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  const PERIODS = ['1', '2', '3', '4', '5', '6'];
  const teacherBusy = new Set();   // `${teacher}_${day}_${period}`
  const classBusy = new Set();     // `${class}_${day}_${period}`
  const out = [];

  // เรียงวิชาที่มีคาบเยอะไว้ก่อน — วางยากสุดตอนตารางยังโล่ง
  const ordered = [...SUBJECTS].sort((a, b) => b[4] - a[4]);

  for (const [code, name, teacher, cls, periodsPerWeek] of ordered) {
    let placed = 0;
    // ไล่ทุกช่องด้วยลำดับที่สุ่มแบบคงที่ ไม่ใช่สุ่มแล้วลองใหม่ — วางได้แน่นอนถ้ามีที่ว่าง
    const slots = [];
    for (const d of DAYS) for (const pd of PERIODS) slots.push([d, pd, rand()]);
    slots.sort((a, b) => a[2] - b[2]);

    for (const [day, period] of slots) {
      if (placed >= periodsPerWeek) break;
      const tKey = `${teacher}_${day}_${period}`;
      const cKey = `${cls}_${day}_${period}`;
      if (teacherBusy.has(tKey) || classBusy.has(cKey)) continue;
      // ไม่ให้วิชาเดียวกันซ้ำวันเดียวกัน — ตารางจริงกระจายทั้งสัปดาห์
      if (out.some(r => r.code === code && r.cls === cls && r.day === day)) continue;
      teacherBusy.add(tKey); classBusy.add(cKey);
      out.push({ code, name, teacher, cls, day, period });
      placed++;
    }
    if (placed < periodsPerWeek) {
      console.warn(`[demo] ${code} ${cls} วางได้ ${placed}/${periodsPerWeek} คาบ — ตารางแน่นเกินไป`);
    }
  }
  return out;
}

/**
 * ภาคเรียนและปีการศึกษาไทยจากวันจริง
 *
 * เทอม 1 = พ.ค.–ต.ค. · เทอม 2 = พ.ย.–มี.ค. · เม.ย. ปิดเทอมใหญ่ นับเป็นเทอม 1 ปีถัดไป
 * ต้องคำนวณ ไม่ใช่ hardcode — เดโมรันข้ามปี พอขึ้นปีการศึกษาใหม่แล้วยังค้างปีเก่า
 * ครูที่กดเข้ามาจะเห็น "ไม่พบวิชาในเทอมนี้" ทั้งที่ข้อมูลมีอยู่ครบ
 */
function currentThaiTerm(now = new Date()) {
  const m = now.getMonth() + 1;             // 1-12
  const ce = now.getFullYear();
  if (m >= 5 && m <= 10) return { term: '1', year: String(ce + 543) };
  if (m >= 11)           return { term: '2', year: String(ce + 543) };
  if (m <= 3)            return { term: '2', year: String(ce + 542) };
  // เมษายนคือปิดเทอมใหญ่ เทอม 1 ยังไม่เปิด — ใช้เทอม 2 ที่เพิ่งจบ ไม่ใช่เทอมที่ยัง
  // ไม่มีวันเรียนสักวัน ไม่งั้นเดโมทั้งเดือนเมษายนจะไม่มีข้อมูลอะไรเลย
  return { term: '2', year: String(ce + 542) };
}

/** ช่วงวันของภาคเรียน — ใช้เป็นวันเริ่มสร้างข้อมูลเช็คชื่อ และโชว์บนแดชบอร์ด */
function termRange(term, year) {
  const ce = Number(year) - 543;
  return term === '1'
    ? { start: `${ce}-05-11`,     end: `${ce}-10-10` }
    : { start: `${ce}-11-01`,     end: `${ce + 1}-03-31` };
}

// ---------------------------------------------------------------- ตัวเติมข้อมูล
async function fill({ term, year, teacherNames, schoolName }) {
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

  // ---------------------------------------------------------------- ภาคเรียนที่ใช้งาน
  // ฐานข้อมูลที่สร้างใหม่จาก schema.sql ไม่มีแถวนี้ getSystemConfig จึงตกไปใช้ค่า
  // ตั้งต้นในโค้ด (ปี 2568) ซึ่งไม่ตรงกับข้อมูลที่เรากำลังจะใส่ ผลคือครูเปิดหน้า
  // กรอกคะแนนหรือรายงานแล้วเจอ "ไม่พบวิชาในเทอมนี้" ทั้งที่ข้อมูลอยู่ครบ
  const range = termRange(term, year);
  await query(
    `INSERT INTO system_settings(key, subkey, value1, value2) VALUES('Active','Term',$1,$2)
     ON CONFLICT (key, subkey) DO UPDATE SET value1=EXCLUDED.value1, value2=EXCLUDED.value2`,
    [term, year]
  );
  await query(
    `INSERT INTO system_settings(key, subkey, value1, value2) VALUES('TermData',$1,$2,$3)
     ON CONFLICT (key, subkey) DO UPDATE SET value1=EXCLUDED.value1, value2=EXCLUDED.value2`,
    [`${term}_${year}`, range.start, range.end]
  );
  log.push(`ภาคเรียน ${term}/${year} (${range.start} ถึง ${range.end})`);

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

  // ---------------------------------------------------------------- ตารางสอน
  // สร้างใหม่ทั้งหมด — seed-dev ให้ครูคนละวิชาห้องเดียว ตารางเลยว่างเกือบทั้งสัปดาห์
  await query(`DELETE FROM timetable WHERE term=$1 AND year=$2`, [term, year]);

  const HOMEROOM = { 'ม.1/1': 'teacher4', 'ม.2/1': 'teacher2', 'ม.5/1': 'teacher3', 'ม.6/1': 'teacher1' };
  const WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  const ttBatch = [];

  for (const row of buildTimetable(r)) {
    const [level, room] = row.cls.split('/');
    ttBatch.push([row.code, row.name, level, room, row.teacher, row.day, row.period, term, year]);
  }
  // โฮมรูมคาบ 0 ทุกวัน — ครูที่ปรึกษาประจำห้อง
  for (const [cls, tid] of Object.entries(HOMEROOM)) {
    const [level, room] = cls.split('/');
    for (const d of WEEKDAYS) {
      ttBatch.push(['HR', 'กิจกรรมโฮมรูมหน้าเสาธง', level, room, tid, d, '0', term, year]);
    }
  }
  // ชุมนุมวันพฤหัสบดีคาบ 7 — ครูที่ปรึกษาชุมนุมเห็นในตารางตัวเอง
  for (const [id, name, , , advisor] of CLUBS) {
    ttBatch.push([`CLUB_${id}`, name, 'ชุมนุม', id, advisor, 'พฤหัสบดี', '7', term, year]);
  }
  await insertBatch(
    `INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)`,
    9, ttBatch
  );
  log.push(`ตารางสอน ${ttBatch.length} คาบ/สัปดาห์ (${SUBJECTS.length} รายวิชา)`);

  // ---------------------------------------------------------------- โครงสร้างรายวิชา
  // ทุกวิชาต้องมีโครงคะแนน ไม่งั้นครูเปิดหน้ากรอกคะแนนของวิชานั้นมาแล้วไม่มีช่องให้กรอก
  // และ ปพ.5 พิมพ์ออกมาไม่มีหัวคอลัมน์
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
  await query(`DELETE FROM subject_config WHERE term=$1 AND year=$2`, [term, year]);
  for (const [code, , teacher, cls] of SUBJECTS) {
    await query(
      `INSERT INTO subject_config(subject_id,subject_code,class_name,term,year,score_ratio,
                                  indicators_json,exam_indicators_json,teacher_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [`${code}_${cls}_${term}_${year}`, code, cls, term, year, RATIO,
       JSON.stringify(INDICATORS), JSON.stringify(EXAM_INDICATORS), teacher]
    );
  }
  log.push(`โครงสร้างรายวิชา ${SUBJECTS.length} วิชา`);

  // ---------------------------------------------------------------- เช็คเวลาเรียน
  const { rows: subjects } = await query(
    `SELECT DISTINCT subject_code, subject_name, teacher_id, level, room, day, period
       FROM timetable WHERE term=$1 AND year=$2 AND subject_code NOT LIKE 'CLUB%'`,
    [term, year]
  );
  const termStart = range.start;
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
  // โครงคะแนนตั้งไว้ตอนสร้าง subject_config ด้านบนแล้ว ที่นี่แค่กรอกคะแนนลงไป
  const { rows: configs } = await query(
    `SELECT subject_code, class_name, teacher_id FROM subject_config WHERE term=$1 AND year=$2`,
    [term, year]
  );
  let scoreRows = 0, qualRows = 0;

  for (const cfg of configs) {
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

  // ---------------------------------------------------------------- แฟ้มบันทึกหลังสอน
  // เดิมมีของครูคนเดียววิชาเดียว 4 คาบ — ครูคนอื่นเปิดแฟ้มตัวเองมาแล้วว่าง
  // เนื้อหาแยกตามกลุ่มสาระ ใช้ชุดเดียวกันทุกวิชาจะดูเป็นข้อความก๊อปวาง
  const TOPIC_BANK = {
    'พ': [
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
      ['ทักษะการเคลื่อนไหวและสมรรถภาพ', 'นักเรียนทดสอบสมรรถภาพทางกายและบันทึกผลของตนเองได้',
       'ฝนตกใช้สนามกลางแจ้งไม่ได้', 'ย้ายมาใช้โรงยิมและปรับเป็นสถานีในร่ม'],
    ],
    'ท': [
      ['การอ่านจับใจความสำคัญ', 'นักเรียนสรุปใจความสำคัญของบทอ่านได้ตรงประเด็น',
       'นักเรียนสรุปยาวเกินไป ยังแยกใจความหลักกับรายละเอียดไม่ออก',
       'ให้ฝึกเขียนสรุปในกรอบจำกัด 2 บรรทัดก่อน แล้วค่อยขยาย'],
      ['คำเป็นคำตาย และการผันวรรณยุกต์', 'นักเรียนผันวรรณยุกต์คำเป็นคำตายได้ถูกต้อง',
       'นักเรียนจำหลักการได้แต่ใช้จริงยังผิด', 'เพิ่มแบบฝึกหัดสั้น ๆ ท้ายคาบทุกครั้ง'],
      ['การเขียนเรียงความ', 'นักเรียนวางโครงเรื่องและเขียนเรียงความ 3 ย่อหน้าได้',
       'นักเรียนเริ่มต้นเขียนไม่ได้ ติดที่คำนำ',
       'ให้เขียนเนื้อเรื่องก่อน แล้วย้อนกลับมาเขียนคำนำทีหลัง'],
      ['วรรณคดี: นิราศภูเขาทอง', 'นักเรียนถอดคำประพันธ์และอธิบายคุณค่าด้านวรรณศิลป์ได้',
       'ศัพท์โบราณเยอะ นักเรียนเปิดพจนานุกรมไม่ทัน',
       'ทำใบความรู้รวมศัพท์แจกล่วงหน้าก่อนเรียน'],
    ],
    'ว': [
      ['หน่วยของสิ่งมีชีวิต', 'นักเรียนใช้กล้องจุลทรรศน์และวาดภาพเซลล์ที่สังเกตได้',
       'กล้องจุลทรรศน์มีไม่พอ ต้องผลัดกันใช้',
       'จัดกลุ่มละ 4 คน หมุนเวียนสถานี พร้อมใบงานให้ทำระหว่างรอ'],
      ['แรงและการเคลื่อนที่', 'นักเรียนคำนวณแรงลัพธ์และอธิบายกฎการเคลื่อนที่ของนิวตันได้',
       'นักเรียนแทนค่าสูตรได้แต่ตีความโจทย์ไม่ออก',
       'ฝึกวาดแผนภาพวัตถุอิสระก่อนลงมือคำนวณทุกข้อ'],
      ['สารและสมบัติของสาร', 'นักเรียนจำแนกสารตามสถานะและทดสอบความเป็นกรด-เบสได้',
       'สารเคมีบางตัวหมดอายุ ผลการทดลองไม่ชัด',
       'เบิกสารชุดใหม่จากพัสดุ และใช้กระดาษลิตมัสสำรอง'],
      ['ไฟฟ้าและวงจรไฟฟ้า', 'นักเรียนต่อวงจรอนุกรมและขนาน พร้อมวัดค่าได้ถูกต้อง',
       'นักเรียนต่อวงจรผิดขั้วทำให้ผลไม่ตรง',
       'ทำแผ่นภาพวงจรตัวอย่างติดไว้ที่โต๊ะทดลองทุกโต๊ะ'],
      ['พลังงานความร้อน', 'นักเรียนอธิบายการถ่ายโอนความร้อนทั้งสามแบบได้',
       'เวลาไม่พอทำการทดลองให้ครบทั้งสามแบบ',
       'แบ่งกลุ่มทำคนละแบบแล้วนำเสนอแลกเปลี่ยนกัน'],
    ],
  };
  const lessonBatch = [];
  const { rows: ttForLesson } = await query(
    `SELECT DISTINCT subject_code, subject_name, level||'/'||room AS cls, teacher_id, day, period
     FROM timetable WHERE term=$1 AND year=$2
       AND subject_code <> 'HR' AND subject_code NOT LIKE 'CLUB%'`,
    [term, year]
  );
  for (const t of ttForLesson) {
    const bank = TOPIC_BANK[t.subject_code.charAt(0)] || TOPIC_BANK['ว'];
    // คาบล่าสุดของวิชานั้นย้อนหลังไปเท่าจำนวนหัวข้อที่มี
    const dayList = days.filter(d => d.dow === t.day).slice(-bank.length);
    for (const [i, d] of dayList.entries()) {
      const [topic, outcomes, problems, solutions] = bank[i % bank.length];
      lessonBatch.push([d.date, term, year, t.subject_code, t.subject_name, t.cls, t.period,
        topic, outcomes, problems, solutions, t.teacher_id,
        `lesson_${t.subject_code}_${t.cls}_${d.date}_${t.period}`]);
    }
  }
  await insertBatch(
    `INSERT INTO detailed_lesson_records(date,term,year,subject_code,subject_name,class,period,
                                         topic,outcomes,problems,solutions,teacher_id,session_id)`,
    13, lessonBatch
  );
  log.push(`บันทึกหลังสอน ${lessonBatch.length} คาบ (ทุกครู ทุกวิชา)`);

  // ---------------------------------------------------------------- ช่องลงนาม ปพ.5
  // ปพ.5 มีช่องลงนามครูผู้สอน หัวหน้ากลุ่มสาระ หัวหน้าวัดผล รองวิชาการ และ ผอ.
  // อ่านจาก print_config — ว่างอยู่แปลว่าพิมพ์ออกมาแล้วช่องลงนามเป็นจุดไข่ปลาทั้งหน้า
  //
  // ⚠️ ชื่อทุกชื่อสมมติทั้งหมด ห้ามคัดลอกชื่อบุคลากรจริงมาไว้ที่นี่เด็ดขาด
  //    เดโมเปิดสาธารณะ = ชื่อจริงของครูจะถูกอ่านได้โดยใครก็ตามที่กดเข้ามา
  const SIGNERS = {
    school_name:    schoolName,
    principal_name: 'นายประสิทธิ์ วุฒิคุณ',
    academic_head:  'นางสาวพิมพ์ใจ วงศ์สถิตย์',
    measure_head:   'นายอนุชา พงษ์เจริญ',
    head_thai:      'นางสาวกมลชนก แสงทวี',
    head_math:      'นายธนากร ศรีสุวรรณ',
    head_sci:       'นายพีรพล อินทรโชติ',
    head_soc:       'นางสาวรุ่งทิวา ชาญบดินทร์',
    head_pe:        'นางสุภาพร ทองแท้',
    head_art:       'นายวรากร บุญเรือง',
    head_occ:       'นางสาวเพ็ญนภา ทรงศิริ',
    head_eng:       'นางสาวจุฑามาศ เลิศวิไล',
    head_act:       'นายอนุชา พงษ์เจริญ',
  };
  const homeroomRows = Object.entries(HOMEROOM).map(([cls, tid]) => ({
    cls, t1: teacherNames[tid] || tid, t2: '',
  }));
  await query(
    `INSERT INTO print_config(term,year,sys_data,homeroom_data) VALUES($1,$2,$3,$4)
     ON CONFLICT (term,year) DO UPDATE SET sys_data=EXCLUDED.sys_data,
                                           homeroom_data=EXCLUDED.homeroom_data`,
    [term, year, JSON.stringify(SIGNERS), JSON.stringify(homeroomRows)]
  );
  log.push('ช่องลงนาม ปพ.5 ครบทุกตำแหน่ง');

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

  // ---------------------------------------------------------------- คาบสอนแทน
  // ต้องสร้างใหม่จากใบลา + ตารางใหม่ ไม่ใช่ปล่อยของ seed-dev ไว้
  // ตารางถูกจัดใหม่ทั้งหมด คาบสอนแทนเดิมจึงชี้ไปวัน/คาบที่ครูคนนั้นไม่ได้สอนแล้ว
  // แล้วหน้าจัดสอนแทนจะโชว์คาบที่ไม่มีอยู่จริงในตาราง
  await query(`DELETE FROM substitute_assignments`);

  const { rows: leaveRows2 } = await query(
    `SELECT id, teacher_id, staff_name, to_char(start_date,'YYYY-MM-DD') AS start_date,
            to_char(end_date,'YYYY-MM-DD') AS end_date, status
     FROM leave_records WHERE year=$1 AND status IN ('อนุมัติ','รอพิจารณา')`, [year]
  );
  const { rows: ttAll } = await query(
    `SELECT subject_code, subject_name, level, room, teacher_id, day, period
     FROM timetable WHERE term=$1 AND year=$2 AND subject_code <> 'HR'`, [term, year]
  );
  const freeAt = (tid, day, period) =>
    !ttAll.some(t => t.teacher_id === tid && t.day === day && t.period === period);

  let subRows = 0;
  for (const lv of leaveRows2) {
    // ทุกวันที่ครูลา ไปหาคาบที่เขาต้องสอน แล้วหาคนว่างมาแทน
    for (let d = new Date(`${lv.start_date}T12:00:00`);
         d <= new Date(`${lv.end_date}T12:00:00`);
         d = new Date(d.getTime() + 86400000)) {
      const dow = THAI_DOW[d.getDay()];
      if (dow === 'เสาร์' || dow === 'อาทิตย์') continue;
      const slots = ttAll.filter(t => t.teacher_id === lv.teacher_id && t.day === dow);
      for (const slot of slots) {
        // ครูที่ว่างคาบนั้นและไม่ใช่คนลาเอง — ใบที่ยังรอพิจารณาปล่อยว่างไว้ให้ผู้ดูแลจัด
        const candidates = Object.keys(teacherNames)
          .filter(tid => tid !== 'admin' && tid !== lv.teacher_id && freeAt(tid, dow, slot.period));
        const pickSub = lv.status === 'อนุมัติ' && candidates.length ? candidates[int(r, 0, candidates.length - 1)] : null;
        await query(
          `INSERT INTO substitute_assignments(leave_id,date,period,day_of_week,
             original_teacher_id,original_teacher_name,sub_teacher_id,sub_teacher_name,
             subject_code,subject_name,class,room,status,assigned_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [lv.id, ymd(d), slot.period, dow,
           lv.teacher_id, lv.staff_name, pickSub, pickSub ? teacherNames[pickSub] : null,
           slot.subject_code, slot.subject_name, `${slot.level}/${slot.room}`, slot.room,
           pickSub ? 'จัดแล้ว' : 'รอจัด', pickSub ? 'admin' : null]
        );
        subRows++;
      }
    }
  }
  log.push(`คาบสอนแทน ${subRows} คาบ`);

  // ---------------------------------------------------------------- สรุปคาบสอน (ปพ.5 ช่องลงชื่อ)
  let acadRows = 0;
  const { rows: sessions } = await query(
    `SELECT session_id, MIN(date) AS date, MIN(subject_code) AS subject_code,
            MIN(subject_name) AS subject_name, MIN(class) AS class, MIN(period) AS period,
            MIN(teacher_id) AS teacher_id,
            COUNT(*) FILTER (WHERE status='มา')  AS present,
            COUNT(*) FILTER (WHERE status IN ('ขาด','โดด')) AS absent,
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

module.exports = { fill, fillMediaTrash, currentThaiTerm, termRange, CLASSES };
