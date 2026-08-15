/**
 * ค่าคงที่ที่ต้องตรงกับ db/seed-dev.js — แก้ seed แล้วต้องแก้ที่นี่ด้วย
 */
'use strict';

module.exports = {
  TERM: '1',
  YEAR: '2569',
  // teacher1
  PHYSICS: { code: 'ว30205', name: 'ฟิสิกส์', className: 'ม.6/1' },
  // teacher2
  HEALTH:  { code: 'พ22101', name: 'สุขศึกษา', className: 'ม.2/1' },
  // 0 นำหน้าเจตนา — key ของ data map ต้องใช้ id ดิบเสมอ (ดู CLAUDE.md)
  M6_STUDENTS: ['01901', '01902', '01903', '01904'],
  M2_STUDENTS: ['02001', '02002'],
};
