'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generatePP5Template } = require('../functions/generatePP5Template');

test('หน้ารายละเอียดตัวชี้วัด ปพ.5 แสดงแถวรวมคะแนนเป็นแถวสุดท้าย', async () => {
  const html = await generatePP5Template([{
    subCode: '',
    subName: 'วิชาทดสอบ',
    className: 'ม.1/1',
    classNum: '1',
    sys: {},
    user: { name: 'ครูทดสอบ', currentTerm: '1', currentYear: '2569' },
    config: {
      ratio: '50:20:30',
      indicators: [
        { code: 'ท 1.1', name: 'งานที่ 1', score: 35 },
        { code: 'ท 1.2', name: 'งานที่ 2', score: 15 },
      ],
      examIndicators: {
        midterm: { code: 'ท กลาง', description: 'สอบกลางภาค' },
        final: { code: 'ท ปลาย', description: 'สอบปลายภาค' },
      },
    },
    students: [],
    attSessions: [],
  }]);

  assert.match(
    html,
    /<tr class="indicator-total-row font-bold">\s*<td colspan="4"[^>]*>รวมคะแนน<\/td>\s*<td[^>]*>100<\/td>\s*<\/tr>\s*<\/tbody>/,
    'ยอดรวมต้องรวมคะแนนชิ้นงาน กลางภาค และปลายภาค และอยู่ท้ายตาราง'
  );
});
