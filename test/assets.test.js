'use strict';
/**
 * ไฟล์ JS/CSS ที่เสิร์ฟให้เบราว์เซอร์ — และ **รหัสรุ่นที่ติดไปกับมัน**
 *
 * เหตุที่ต้องมีเทสต์นี้: `Scripts_Core.html` cache HTML ของแต่ละหน้าไว้ใน sessionStorage
 * 30 นาที ส่วน JS เสิร์ฟแบบ no-store คือใหม่เสมอ · ถ้า cache key ไม่ผูกกับรุ่น
 * deploy ที่แก้ markup จะทำให้เบราว์เซอร์ที่เปิดค้างได้ **JS ใหม่คู่กับ HTML เก่า**
 * แล้วพังเงียบ ๆ (เกิดจริงตอนเปลี่ยน id ในฟอร์มการ์ดสื่อ — กดปุ่มเพิ่มแล้วไม่มีอะไรขึ้น)
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { stop, baseURL } = require('./helpers/api');
const { buildId } = require('../lib/buildId');

after(stop);

function get(pathname) {
  return baseURL().then(base => new Promise((resolve, reject) => {
    http.get(`${base}${pathname}`, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  }));
}

test('JS ที่เสิร์ฟต้องพก __PSSMS_BUILD มาด้วย และห้าม cache', async () => {
  const res = await get('/api/assets/script/Scripts_Core');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-store/,
    'JS ต้องใหม่เสมอ ไม่งั้นรหัสรุ่นที่ติดมากับมันก็ค้างตามไปด้วย');

  const m = /^window\.__PSSMS_BUILD=("[^"]+");/.exec(res.body);
  assert.ok(m, 'บรรทัดแรกต้องประกาศ __PSSMS_BUILD');
  assert.equal(JSON.parse(m[1]), buildId());
  assert.ok(JSON.parse(m[1]).length > 0, 'รหัสรุ่นว่างไม่ได้ — cache key จะกลายเป็นตัวเดียวกันหมด');
});

test('รหัสรุ่นเหมือนกันทุกไฟล์ในรอบ deploy เดียว', async () => {
  const grab = async (name) => {
    const res = await get('/api/assets/script/' + name);
    return /^window\.__PSSMS_BUILD=("[^"]+");/.exec(res.body)[1];
  };
  assert.equal(await grab('Scripts_Core'), await grab('Scripts_General'),
    'คนละค่ากัน = หน้าไหนโหลดทีหลังจะล้าง cache ของอีกหน้าทิ้งตลอดเวลา');
});

test('ชื่อไฟล์แปลก ๆ ต้องไม่หลุดออกนอก src/', async () => {
  assert.equal((await get('/api/assets/script/..%2F..%2Fpackage')).status, 400);
  const missing = await get('/api/assets/script/NotARealFile');
  assert.equal(missing.status, 404);
  // ตอบเป็น JS ที่ parse ได้เสมอ ไม่ใช่ HTML error page ที่จะพังตอนเบราว์เซอร์ eval
  assert.match(missing.headers['content-type'], /javascript/);
});

test('CSS เสิร์ฟได้และไม่ถูก cache', async () => {
  const res = await get('/api/assets/style');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['content-type'], /css/);
  assert.ok(!/<style/i.test(res.body), 'ต้องถอด <style> ออกแล้ว');
});
