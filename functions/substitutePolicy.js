'use strict';

// ปรับที่เดียวจบ — ตัวเลขพวกนี้คือ "นโยบายการจัด" ไม่ใช่รายละเอียดการทำงาน
const FAIRNESS_WINDOW_DAYS = 30;
const MAX_SUBSTITUTE_PER_DAY = 2;

const SCORE_WEIGHTS = {
  exactSubject:   50,  // สอน subject_code นี้อยู่แล้วในเทอมปัจจุบัน
  strongPrefix:   30,  // สอนกลุ่มสาระเดียวกัน >= STRONG_PREFIX_MIN คาบ
  weakPrefix:     15,  // สอนกลุ่มสาระเดียวกัน 1-2 คาบ
  homeroom:       25,  // เป็นครูที่ปรึกษาของห้องนั้น
  sameClass:       8,  // สอนห้องนี้อยู่แล้ว (คนละวิชา)
  dailyLoadPer:   -4,  // ต่อ 1 คาบสอนปกติ+สอนแทนในวันนั้น
  workloadPer:    -6,  // ต่อ 1 คาบสอนแทนในหน้าต่าง FAIRNESS_WINDOW_DAYS
};

module.exports = {
  FAIRNESS_WINDOW_DAYS,
  MAX_SUBSTITUTE_PER_DAY,
  SCORE_WEIGHTS,
};
