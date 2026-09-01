'use strict';
/**
 * "วันนี้" ตามเวลาโรงเรียน
 *
 * บั๊กที่ล็อกไว้: ครูเปิดระบบเช้ามืดแล้วเห็นตาราง/ข้อมูลของเมื่อวาน
 * เกิดได้ 2 ทาง — toISOString() (UTC เสมอ) และ getFullYear()/getDay() (TZ ของ process
 * ซึ่งบน Railway คือ UTC เพราะไม่ได้ตั้ง TZ ไว้) เครื่อง dev เป็นเวลาไทยจึงผ่านทั้งคู่
 * เทสต์นี้จึงต้องผ่านโดยไม่ขึ้นกับ TZ ของเครื่องที่รัน
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolDateStr, schoolToday, schoolDayIndex } = require('../lib/schoolDate');

test('หลังห้าโมงเย็น UTC = วันถัดไปแล้วในไทย', () => {
  // 2026-09-01 18:30Z = 2026-09-02 01:30 เวลาไทย — ครูเปิดระบบตอนตีหนึ่งครึ่ง
  assert.equal(schoolDateStr(new Date('2026-09-01T18:30:00Z')), '2026-09-02');
  assert.equal(schoolDateStr(new Date('2026-09-01T16:59:59Z')), '2026-09-01', 'ก่อน 17:00Z ยังเป็นวันเดิม');
  assert.equal(schoolDateStr(new Date('2026-09-01T17:00:00Z')), '2026-09-02', 'ตั้งแต่ 17:00Z ข้ามวันแล้ว');
});

test('เลขวันในสัปดาห์อ่านจากสตริง ไม่พึ่ง TZ ของ process', () => {
  assert.equal(schoolDayIndex('2026-09-01'), 2, 'อังคาร');
  assert.equal(schoolDayIndex('2026-09-06'), 0, 'อาทิตย์');
});

test('วันที่กับวันในสัปดาห์ต้องมาจากวันเดียวกันเสมอ', () => {
  // ตีหนึ่งครึ่งของวันพุธตามเวลาไทย — ถ้าคิดแบบ UTC จะได้อังคาร แล้วตารางสอนเลื่อนไปทั้งวัน
  const d = new Date('2026-09-01T18:30:00Z');
  assert.equal(schoolDayIndex(schoolDateStr(d)), 3, 'พุธ');
});

test('schoolToday คืนรูป YYYY-MM-DD', () => {
  assert.match(schoolToday(), /^\d{4}-\d{2}-\d{2}$/);
});
