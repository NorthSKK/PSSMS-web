/**
 * ตัวอ่าน/ตรวจไฟล์นำเข้าฝั่งหน้าเว็บ — ดึงฟังก์ชันออกมาจาก `src/Scripts_Admin.html`
 * มารันจริงใน node
 *
 * ทำไมต้องมี: หน้าเว็บกับ server ตรวจด้วยกติกาชุดเดียวกันที่มาจาก `lib/importSpec.js`
 * แต่ **โค้ดที่เดินตามกติกาเป็นคนละชุด** (src/*.html ไม่มี module system แชร์ฟังก์ชันไม่ได้)
 * ถ้าสองฝั่ง drift กัน หน้าจอจะบอกว่าไฟล์ผ่านแล้ว server ปฏิเสธ — หรือแย่กว่านั้น
 * หน้าจอบอกว่าผิดทั้งที่ไม่ผิด ครูก็จะนั่งแก้ไฟล์ที่ถูกอยู่แล้ว
 * เทสนี้ยิงข้อมูลชุดเดียวกันเข้าทั้งสองทางแล้วเทียบว่าตัดสินตรงกัน
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { importSpec, prepareRows } = require('../lib/importSpec');

const SRC = path.join(__dirname, '../src/Scripts_Admin.html');
const WANTED = ['_csvCells', '_headerKey', '_gridToRows', '_validateImportRows', '_normalizeDayClient', '_decodeCsv'];

/** ตัดตัวฟังก์ชันออกมาด้วยการนับวงเล็บปีกกา ไม่ใช่ regex — body มี `}` อยู่เต็มไปหมด */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `หา function ${name} ใน Scripts_Admin.html ไม่เจอ`);
  let depth = 0, seen = false;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') { depth++; seen = true; }
    else if (src[i] === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`ตัด function ${name} ไม่จบ`);
}

const raw = fs.readFileSync(SRC, 'utf8').replace(/<script[^>]*>/gi, '').replace(/<\/script>/gi, '');
const sandbox = { _importSpec: importSpec(), TextDecoder, Uint8Array, console };
vm.createContext(sandbox);
vm.runInContext(WANTED.map((n) => extractFunction(raw, n)).join('\n'), sandbox);

function parseCsv(text, kind) {
  return sandbox._gridToRows(text.split(/\r?\n/).map(sandbox._csvCells), kind);
}

// ── หัวตาราง ──────────────────────────────────────────────────────────────

test('รับหัวตารางไทย และ alias อังกฤษปนกันในไฟล์เดียว', () => {
  const p = parseCsv('รหัสนักเรียน,ชื่อ-สกุล,level,room\n01903,เด็กชายคมสัน จำลอง,ม.6,1', 'student');
  assert.strictEqual(p.missingRequired.length, 0);
  assert.deepStrictEqual(p.rows[0].username, '01903');
  assert.deepStrictEqual(p.rows[0].level, 'ม.6');
});

test('หัวตารางที่ระบบไม่รู้จักถูกรายงาน ไม่ใช่เงียบ', () => {
  const p = parseCsv('รหัสนักเรียน,ชื่อ-สกุล,ระดับ,ห้อง,เบอร์ผู้ปกครอง\n01903,ก,ม.6,1,081', 'student');
  // Array.from เพราะค่าที่คืนมาสร้างใน vm context ต่างหาก prototype จึงคนละตัวกับ host
  assert.deepStrictEqual(Array.from(p.unknownHeaders), ['เบอร์ผู้ปกครอง']);
});

test('ขาดคอลัมน์บังคับต้องบอกเป็นชื่อไทยที่ครูเห็นในไฟล์', () => {
  const p = parseCsv('รหัสนักเรียน,ชื่อ-สกุล\n01903,ก', 'student');
  assert.deepStrictEqual(p.missingRequired, ['ระดับ', 'ห้อง']);
});

test('ค่าที่มี comma ต้องอยู่ใน quote แล้วไม่ถูกหั่น', () => {
  const p = parseCsv('รหัสวิชา,ชื่อวิชา,ระดับ,ห้อง,ชื่อผู้ใช้ครู,วัน,คาบ\nว30205,"ฟิสิกส์ 1, เพิ่มเติม",ม.6,1,teacher1,จันทร์,3', 'timetable');
  assert.strictEqual(p.rows[0].subjectName, 'ฟิสิกส์ 1, เพิ่มเติม');
});

test('แถวว่างกลางไฟล์ถูกข้าม ไม่กลายเป็นแถวที่ขาดข้อมูล', () => {
  const p = parseCsv('รหัสนักเรียน,ชื่อ-สกุล,ระดับ,ห้อง\n01903,ก,ม.6,1\n\n01904,ข,ม.6,1', 'student');
  assert.strictEqual(p.rows.length, 2);
});

test('เลขแถวที่รายงานตรงกับเลขแถวใน Excel', () => {
  const p = parseCsv('รหัสนักเรียน,ชื่อ-สกุล,ระดับ,ห้อง\n01903,ก,ม.6,1\n01904,ข,ม.6,1', 'student');
  assert.strictEqual(p.rows[0].__excelRow, 2, 'แถวข้อมูลแรกคือแถว 2 (หัวตารางเป็นแถว 1)');
  assert.strictEqual(p.rows[1].__excelRow, 3);
});

// ── encoding ─────────────────────────────────────────────────────────────

test('CSV ที่ Excel ไทยบันทึกเป็น windows-874 อ่านออก ไม่เป็นภาษาต่างดาว', () => {
  // 'ชื่อ' ใน TIS-620/windows-874
  const bytes = Uint8Array.from([0xAA, 0xD7, 0xE8, 0xCD]);
  assert.strictEqual(sandbox._decodeCsv(bytes.buffer), 'ชื่อ');
});

test('CSV UTF-8 ที่มี BOM ถูกตัด BOM ทิ้ง ไม่ติดไปกับหัวตารางแรก', () => {
  const withBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('รหัสนักเรียน', 'utf8')]);
  const text = sandbox._decodeCsv(withBom.buffer.slice(withBom.byteOffset, withBom.byteOffset + withBom.length));
  assert.strictEqual(text, 'รหัสนักเรียน');
  assert.strictEqual(sandbox._headerKey(importSpec().specs.student.columns, text), 'username');
});

// ── ตรวจแล้วต้องตัดสินตรงกับ server ─────────────────────────────────────────

const CASES = {
  student: [
    [{ username: '01903', fullName: 'ก', level: 'ม.6', room: '1' }, 'ถูกทุกอย่าง'],
    [{ username: '', fullName: 'ก', level: 'ม.6', room: '1' }, 'ไม่มีรหัส'],
    [{ username: '01903', fullName: 'ก', level: 'ม.6', room: 'หนึ่ง' }, 'ห้องไม่ใช่ตัวเลข'],
  ],
  teacher: [
    [{ username: 't1', fullName: 'ก', role: '' }, 'บทบาทว่าง'],
    [{ username: 't1', fullName: 'ก', role: 'ผู้อำนวยการ' }, 'บทบาทนอกลิสต์'],
  ],
  timetable: [
    [{ subjectCode: 'ว1', subjectName: 'ฟ', level: 'ม.6', room: '1', teacherId: 't1', day: 'จันทร์', period: '3' }, 'ถูกทุกอย่าง'],
    [{ subjectCode: 'ว1', subjectName: 'ฟ', level: 'ม.6', room: '1', teacherId: 't1', day: 'จ.', period: '3' }, 'วันรูปย่อ'],
    [{ subjectCode: 'ว1', subjectName: 'ฟ', level: 'ม.6', room: '1', teacherId: 't1', day: 'Monday', period: '3' }, 'วันอ่านไม่ออก'],
    [{ subjectCode: 'ว1', subjectName: 'ฟ', level: 'ม.6', room: '1', teacherId: 't1', day: 'จันทร์', period: 'เช้า' }, 'คาบไม่ใช่ตัวเลข'],
  ],
};

for (const [kind, cases] of Object.entries(CASES)) {
  for (const [row, label] of cases) {
    test(`${kind} — "${label}": หน้าเว็บกับ server ตัดสินตรงกัน`, () => {
      const clientRows = [Object.assign({ __excelRow: 2, __numeric: {} }, row)];
      const client = sandbox._validateImportRows(clientRows, kind);
      const server = prepareRows(kind, [row]);
      assert.strictEqual(
        client.errors.length, server.errors.length,
        `จำนวน error ไม่ตรง — client: ${JSON.stringify(client.errors)} · server: ${JSON.stringify(server.errors)}`
      );
      if (!server.errors.length) {
        // normalize แล้วต้องได้ค่าเดียวกันด้วย ไม่ใช่แค่ผ่านเหมือนกัน
        for (const k of Object.keys(row)) {
          assert.strictEqual(clientRows[0][k], server.rows[0][k], `ค่า ${k} หลัง normalize ไม่ตรง`);
        }
      }
    });
  }
}

test('รหัสซ้ำในไฟล์: ทั้งสองฝั่งจับได้เหมือนกัน', () => {
  const rows = [
    { username: '01903', fullName: 'ก', level: 'ม.6', room: '1' },
    { username: '01903', fullName: 'ข', level: 'ม.6', room: '1' },
  ];
  const clientRows = rows.map((r, i) => Object.assign({ __excelRow: i + 2, __numeric: {} }, r));
  assert.strictEqual(sandbox._validateImportRows(clientRows, 'student').errors.length, 1);
  assert.strictEqual(prepareRows('student', rows).errors.length, 1);
});

// ── คำเตือน 0 นำหน้า — มีเฉพาะฝั่งหน้าเว็บ เพราะ server ไม่เห็นชนิด cell ของ Excel ──

test('รหัสที่ Excel อ่านเป็นตัวเลขขึ้นคำเตือน แต่ไม่บล็อก', () => {
  const rows = [{ __excelRow: 2, __numeric: { username: true }, username: '1903', fullName: 'ก', level: 'ม.6', room: '1' }];
  const v = sandbox._validateImportRows(rows, 'student');
  assert.strictEqual(v.errors.length, 0, 'เป็นคำเตือน ไม่ใช่ข้อผิดพลาด');
  assert.strictEqual(v.warnings.length, 1);
  assert.match(v.warnings[0].message, /0 นำหน้า/);
});

test('รหัสที่สั้นกว่าเพื่อนในไฟล์ CSV ขึ้นคำเตือนว่าน่าจะโดนตัด 0', () => {
  const mk = (id, at) => ({ __excelRow: at, __numeric: {}, username: id, fullName: 'ก', level: 'ม.6', room: '1' });
  const v = sandbox._validateImportRows([mk('01903', 2), mk('1904', 3)], 'student');
  assert.strictEqual(v.errors.length, 0);
  assert.strictEqual(v.warnings.length, 1);
  assert.strictEqual(v.warnings[0].row, 3);
});

test('รหัสยาวเท่ากันทั้งไฟล์ไม่ขึ้นคำเตือนมั่ว', () => {
  const mk = (id, at) => ({ __excelRow: at, __numeric: {}, username: id, fullName: 'ก', level: 'ม.6', room: '1' });
  const v = sandbox._validateImportRows([mk('01903', 2), mk('01904', 3)], 'student');
  assert.strictEqual(v.warnings.length, 0);
});
