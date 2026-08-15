/**
 * Test harness — boots the Express app in-process on an ephemeral port and
 * talks to it exactly like gas-shim.js does (POST /api/gas/<fn> {args:[...]}).
 *
 * Every test file requires this, so the localhost guard below runs everywhere:
 * these tests write to the DB and must never touch production.
 */
'use strict';
process.env.NODE_ENV = 'test';
require('dotenv').config();

const http = require('http');
const jwt = require('jsonwebtoken');

// parse hostname จริง อย่าใช้ regex — เหมือน db/seed-dev.js
let host = '';
try { host = new URL(String(process.env.DATABASE_URL || '')).hostname; } catch (_) { /* ตกไป error ข้างล่าง */ }
if (host !== 'localhost' && host !== '127.0.0.1') {
  console.error('❌ DATABASE_URL ไม่ได้ชี้ localhost — ปฏิเสธการรันเทส กันเขียนทับ production');
  console.error('   ตอนนี้ชี้ไปที่:', host || '(อ่าน DATABASE_URL ไม่ได้)');
  process.exit(1);
}

const app = require('../../server');
const { pool } = require('../../lib/db');

let server = null;
let baseUrl = '';

function start() {
  if (server) return Promise.resolve(baseUrl);
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve(baseUrl);
    });
  });
}

// node:test ค้างถ้าไม่ปิด pool — เรียกใน after() ของทุกไฟล์
function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => { server = null; resolve(); });
  }).then(() => pool.end());
}

const token = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

// ตรงกับ db/seed-dev.js — teacher1 สอน ว30205 (ม.6/1), teacher2 สอน พ22101 (ม.2/1) + HR
const TOKENS = {
  admin:    token({ id: 'admin',    role: 'Admin' }),
  teacher1: token({ id: 'teacher1', role: 'Teacher' }),
  teacher2: token({ id: 'teacher2', role: 'Teacher' }),
  student:  token({ id: '01901',    role: 'Student' }),
};

/**
 * เรียก endpoint แบบเดียวกับ gas-shim.js
 * คืน body ดิบ — { __result } หรือ { __error } (dispatcher ตอบ 200 เสมอ)
 */
async function call(fnName, args = [], as = null) {
  await start();
  const body = JSON.stringify({ args });
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/gas/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(as ? { Authorization: `Bearer ${TOKENS[as] || as}` } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`non-JSON response: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** คาดว่าสำเร็จ — throw พร้อม __error ถ้าไม่ใช่ ทำให้ assertion อ่านง่าย */
async function ok(fnName, args = [], as = null) {
  const res = await call(fnName, args, as);
  if (res.__error) throw new Error(`${fnName} failed: ${res.__error}`);
  return res.__result;
}

/** คาดว่าโดนปฏิเสธ — คืนข้อความ error, throw ถ้าดันสำเร็จ */
async function denied(fnName, args = [], as = null) {
  const res = await call(fnName, args, as);
  if (!res.__error) throw new Error(`${fnName} should have been denied but returned ${JSON.stringify(res.__result)}`);
  return res.__error;
}

module.exports = { call, ok, denied, stop, TOKENS, token };
