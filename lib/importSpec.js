'use strict';
/**
 * นิยามคอลัมน์ของไฟล์นำเข้า — แหล่งความจริงเดียวของทั้งระบบนำเข้า
 *
 * มีผู้ใช้สามราย: ตัวตรวจฝั่ง backend · ตัว parse หัวตารางฝั่งหน้าเว็บ · ตัวสร้างไฟล์แม่แบบ
 * สองรายหลังอยู่ฝั่ง client และรับ spec นี้ไปเป็น **ข้อมูล** ผ่าน RPC `getImportSpec`
 * ไม่ใช่ก๊อปโค้ดไปไว้อีกที่ — `src/*.html` ไม่มี module system ก๊อปไปเมื่อไหร่ก็ drift
 * แบบเดียวกับที่ `lib/subjectGroup.js` เจอมาแล้ว
 *
 * ⚠️ ไฟล์นี้ **ไม่แตะ DB** โดยตั้งใจ — กติกาที่ต้องถาม DB (ครูมีตัวตนจริงไหม,
 * ห้องนี้มีนักเรียนไหม) อยู่ที่ตัว import ไม่ใช่ที่นี่
 *
 * ⚠️ ไม่มีคอลัมน์ เทอม / ปี / รหัสผ่าน โดยตั้งใจ — เทอมกับปีมาจากค่า active ในระบบ
 * เท่านั้น (ขอบเขต DELETE ตอนนำเข้าตารางสอนขึ้นกับมัน ห้ามให้ช่องใน Excel กำหนด)
 * ส่วนรหัสผ่านตั้งให้เท่ากับชื่อผู้ใช้ ไฟล์จะได้ไม่มีรหัสผ่านจริงติดไปตอนส่งกันทางไลน์
 */

const { THAI_DOW } = require('./sessionCalendar');

// รูปย่อที่ครูเขียนกันจริงในไฟล์ตารางสอน → ชื่อเต็มที่ timetable.day ต้องเก็บ
// 'อ' = อังคาร, 'อา' = อาทิตย์ — คนละตัว อย่ายุบรวม
const DAY_ALIASES = {
  'อา': 'อาทิตย์', 'จ': 'จันทร์', 'อ': 'อังคาร', 'พ': 'พุธ',
  'พฤ': 'พฤหัสบดี', 'พฤหัส': 'พฤหัสบดี', 'ศ': 'ศุกร์', 'ส': 'เสาร์',
};

const _s = (v) => String(v == null ? '' : v).trim();

/** คืนชื่อวันไทยเต็มที่ `slotsFromRows()` อ่านออก หรือ '' ถ้าอ่านไม่ออก */
function normalizeDay(value) {
  const raw = _s(value).replace(/^วัน/, '').replace(/\.+$/, '').trim();
  if (!raw) return '';
  if (Object.prototype.hasOwnProperty.call(THAI_DOW, raw)) return raw;
  return DAY_ALIASES[raw] || '';
}

/**
 * กติกาตรวจเป็น **ข้อมูล** ไม่ใช่โค้ด เพื่อให้หน้าเว็บตรวจแบบเดียวกับ server ได้
 * โดยไม่ต้องก๊อป logic ไปไว้อีกฝั่ง — `prepareRows()` ที่นี่กับตัวตรวจฝั่ง client
 * อ่านจาก field ชุดเดียวกัน:
 *   required · unique · pattern (regex string) · oneOf (ค่าที่ยอมรับ) · normalize ('day')
 *   keepLeadingZero (คอลัมน์ที่ Excel ชอบกิน 0 นำหน้า → ขึ้นคำเตือน ไม่บล็อก)
 *   example (ค่าตัวอย่างในไฟล์แม่แบบ)
 */
const SPECS = {
  teacher: {
    title: 'ครู',
    columns: [
      { key: 'username',   label: 'ชื่อผู้ใช้', aliases: ['username'], required: true,
        unique: true, example: 'teacher1', note: 'ใช้เข้าระบบ ห้ามซ้ำ' },
      { key: 'fullName',   label: 'ชื่อ-สกุล', aliases: ['fullname', 'full_name', 'name'], required: true,
        example: 'นายอนุชา พงษ์เจริญ', note: 'ใส่คำนำหน้าด้วย' },
      { key: 'department', label: 'วิชาเอก', aliases: ['department', 'dept'],
        example: 'ฟิสิกส์', note: 'สาขาที่จบมา ไม่ใช่กลุ่มสาระ' },
      { key: 'email',      label: 'อีเมล', aliases: ['email'], example: '' },
      { key: 'role',       label: 'บทบาท', aliases: ['role'], oneOf: ['Teacher', 'Admin', 'Executive'],
        example: '', note: 'ว่าง = Teacher' },
    ],
  },
  student: {
    title: 'นักเรียน',
    columns: [
      { key: 'username', label: 'รหัสนักเรียน', aliases: ['username', 'student_id', 'studentid'],
        required: true, unique: true, keepLeadingZero: true, example: '01903',
        note: 'ใช้เข้าระบบ · 0 นำหน้าต้องอยู่ครบ' },
      { key: 'fullName', label: 'ชื่อ-สกุล', aliases: ['fullname', 'full_name', 'name'], required: true,
        example: 'เด็กชายคมสัน จำลอง' },
      { key: 'level',    label: 'ระดับ', aliases: ['level'], required: true, example: 'ม.1' },
      { key: 'room',     label: 'ห้อง', aliases: ['room'], required: true, pattern: '^\\d+$',
        example: '2', note: 'ตัวเลขล้วน' },
      { key: 'email',    label: 'อีเมล', aliases: ['email'], example: '' },
    ],
  },
  timetable: {
    title: 'ตารางสอน',
    columns: [
      { key: 'subjectCode', label: 'รหัสวิชา', aliases: ['subject_code', 'subjectcode'], required: true,
        example: 'ว30205' },
      { key: 'subjectName', label: 'ชื่อวิชา', aliases: ['subject_name', 'subjectname'], required: true,
        example: 'ฟิสิกส์' },
      { key: 'level',       label: 'ระดับ', aliases: ['level'], required: true, example: 'ม.6' },
      { key: 'room',        label: 'ห้อง', aliases: ['room'], required: true, pattern: '^\\d+$',
        example: '1' },
      { key: 'teacherId',   label: 'ชื่อผู้ใช้ครู', aliases: ['teacher_id', 'teacherid'], required: true,
        example: 'teacher1', note: 'ต้องนำเข้าครูก่อน' },
      { key: 'day',         label: 'วัน', aliases: ['day'], required: true,
        normalize: 'day', oneOf: Object.keys(THAI_DOW), example: 'จันทร์',
        note: 'ชื่อวันไทยเต็ม' },
      { key: 'period',      label: 'คาบ', aliases: ['period'], required: true, pattern: '^\\d+$',
        example: '3', note: "ตัวเลข 1 ขึ้นไป · '0' สงวนให้โฮมรูม" },
      { key: 'location',    label: 'สถานที่เรียน', aliases: ['location'], example: '',
        note: 'อาคาร/ห้องที่ไปสอนจริง คนละเรื่องกับคอลัมน์ ห้อง' },
    ],
  },
};

const KINDS = Object.keys(SPECS);

/** spec ในรูปที่ส่งข้ามไปฝั่งหน้าเว็บได้ (ไม่มีฟังก์ชัน) */
function importSpec() {
  return {
    kinds: KINDS,
    specs: SPECS,
    dayNames: Object.keys(THAI_DOW),
    dayAliases: DAY_ALIASES,
  };
}

/**
 * ด่านแรกสุด — เดิมทุกตัวคืน `{status:'success', message:'นำเข้า 0 รายการ'}`
 * เมื่อ rows ไม่ใช่ array ซึ่งเป็นสิ่งที่เกิดขึ้น **ทุกครั้ง** เพราะหน้าเว็บส่ง base64 มา
 * ครูเห็นเครื่องหมายถูกแล้วเชื่อว่านำเข้าแล้ว ทั้งที่ไม่มีอะไรลง DB เลย
 * ล้มดัง ๆ ดีกว่าโกหกเงียบ ๆ
 */
function assertRows(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('ไฟล์นำเข้าไม่ถูกรูปแบบ — ระบบต้องการรายการข้อมูลที่แปลงแล้ว กรุณาเลือกไฟล์ใหม่อีกครั้ง');
  }
  if (rows.length === 0) {
    throw new Error('ไม่พบข้อมูลในไฟล์ — ตรวจว่ามีแถวข้อมูลใต้หัวตารางหรือไม่');
  }
}

/**
 * ตรวจรูปทรงของทุกแถวแล้วคืนแถวที่ normalize แล้ว
 * `errors` ไม่ว่าง = ห้ามเขียนอะไรลง DB เลยแม้แต่แถวเดียว (ดู ADR 0003)
 * เลขแถวเป็นเลขแถวใน Excel (นับหัวตารางเป็นแถว 1) เพื่อให้คนเปิดไฟล์ไปหาเจอ
 */
function prepareRows(kind, rows) {
  const spec = SPECS[kind];
  if (!spec) throw new Error(`ไม่รู้จักชนิดไฟล์นำเข้า '${kind}'`);

  const errors = [];
  const out = [];
  const seen = new Map();

  rows.forEach((raw, i) => {
    const excelRow = i + 2;
    const row = {};
    for (const c of spec.columns) row[c.key] = _s(raw[c.key]);

    for (const c of spec.columns) {
      const v = row[c.key];

      if (c.required && !v) {
        errors.push({ row: excelRow, message: `ไม่ได้กรอก "${c.label}"` });
        continue;
      }
      if (!v) continue;

      // ชื่อวัน: timetable.day เป็น TEXT เปล่า ค่าอะไรก็ INSERT ผ่าน แต่ slotsFromRows()
      // ทิ้งแถวที่อ่านไม่ออกเงียบ ๆ คาบนั้นหายจากหน้าเช็คชื่อย้อนหลังและกระดานติดตาม
      // งานครูทั้งเทอมโดยไม่มี error ให้ใครเห็น จึงต้องดักตั้งแต่ตอนนำเข้า
      if (c.normalize === 'day') {
        const day = normalizeDay(v);
        if (!day) {
          errors.push({ row: excelRow, message: `${c.label} "${v}" อ่านไม่ออก — ใช้ชื่อวันไทยเต็ม เช่น จันทร์` });
          continue;
        }
        row[c.key] = day;
      }

      if (c.pattern && !new RegExp(c.pattern).test(row[c.key])) {
        errors.push({ row: excelRow, message: `${c.label} "${v}" รูปแบบไม่ถูกต้อง` });
        continue;
      }
      if (c.oneOf && c.oneOf.indexOf(row[c.key]) === -1) {
        errors.push({ row: excelRow, message: `${c.label} "${v}" ต้องเป็นหนึ่งใน: ${c.oneOf.join(', ')}` });
        continue;
      }

      if (c.unique) {
        const prev = seen.get(row[c.key]);
        if (prev) errors.push({ row: excelRow, message: `${c.label} "${v}" ซ้ำกับแถว ${prev}` });
        else seen.set(row[c.key], excelRow);
      }
    }

    out.push(row);
  });

  return { rows: out, errors };
}

/** errors → ข้อความเดียวที่ครูอ่านแล้วรู้ว่าต้องไปแก้แถวไหน */
function assertNoErrors(errors) {
  if (!errors.length) return;
  const head = errors.slice(0, 5).map((e) => `แถว ${e.row}: ${e.message}`);
  const more = errors.length > head.length ? `\n…และอีก ${errors.length - head.length} รายการ` : '';
  throw new Error(`นำเข้าไม่ได้ พบ ${errors.length} จุดที่ต้องแก้\n${head.join('\n')}${more}`);
}

module.exports = { SPECS, KINDS, importSpec, normalizeDay, assertRows, prepareRows, assertNoErrors };
