'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('OpenAI PDF scan ส่ง input_file เป็น PDF data URL', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousUrl = process.env.PD_AI_SCAN_URL;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.PD_AI_SCAN_URL;
  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    const draft = JSON.stringify({ title: '', type: 'อบรม', startsAt: null, endsAt: null, location: '', organizer: '', objective: '', details: '', hours: null, expenses: null, status: 'ร่าง' });
    // รูปแบบ raw REST response: ไม่มี output_text ระดับบน แต่ข้อความอยู่ใน output[].content[].
    return { ok: true, json: async () => ({ status: 'completed', output: [{
      type: 'message', content: [{ type: 'output_text', text: '```json\n' + draft + '\n```' }],
    }] }) };
  };
  try {
    const pd = require('../functions/professionalDevelopment');
    await pd.scanProfessionalDevelopmentPdf(
      { buffer: Buffer.from('%PDF-test'), originalname: 'sample.pdf' }, { id: 'teacher1' }
    );
    assert.equal(
      body.input[0].content[1].file_data,
      `data:application/pdf;base64,${Buffer.from('%PDF-test').toString('base64')}`
    );
    assert.match(body.input[0].content[0].text, /Asia\/Bangkok/);
    assert.match(body.input[0].content[0].text, /คริสต์ศักราช/);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PD_AI_SCAN_URL;
    else process.env.PD_AI_SCAN_URL = previousUrl;
  }
});

test('OpenAI PDF scan แปลงปี พ.ศ. และวันที่ไทยเป็นเวลาท้องถิ่นที่กรอกฟอร์มได้', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousUrl = process.env.PD_AI_SCAN_URL;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.PD_AI_SCAN_URL;
  global.fetch = async () => {
    const draft = JSON.stringify({
      title: 'อบรม', type: 'อบรม', startsAt: '15/09/2568 08:30',
      endsAt: '2025-09-15T09:30:00Z', location: '', organizer: '',
      objective: '', details: '', hours: null, expenses: null, status: 'ร่าง',
    });
    return { ok: true, json: async () => ({ output_text: draft }) };
  };
  try {
    const pd = require('../functions/professionalDevelopment');
    const result = await pd.scanProfessionalDevelopmentPdf(
      { buffer: Buffer.from('%PDF-test'), originalname: 'พ.ศ.pdf' }, { id: 'teacher1' }
    );
    assert.equal(result.draft.startsAt, '2025-09-15T08:30');
    assert.equal(result.draft.endsAt, '2025-09-15T16:30');
    assert.deepEqual(result.warnings, []);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PD_AI_SCAN_URL;
    else process.env.PD_AI_SCAN_URL = previousUrl;
  }
});

test('proxy PDF scan คงปี ค.ศ. เดิมและตัดวันสิ้นสุดที่ห่างผิดปกติ', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousUrl = process.env.PD_AI_SCAN_URL;
  const originalFetch = global.fetch;
  delete process.env.OPENAI_API_KEY;
  process.env.PD_AI_SCAN_URL = 'https://scanner.example.test/scan';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ draft: {
      title: 'ข้อมูลย้อนหลัง', type: 'อบรม', startsAt: '2021-05-04T09:00',
      endsAt: '2026-05-04T16:00', location: '', organizer: '', objective: '',
      details: '', hours: 43807, expenses: null, status: 'ร่าง',
    } }),
  });
  try {
    const pd = require('../functions/professionalDevelopment');
    const result = await pd.scanProfessionalDevelopmentPdf(
      { buffer: Buffer.from('%PDF-test'), originalname: 'history.pdf' }, { id: 'teacher1' }
    );
    assert.equal(result.draft.startsAt, '2021-05-04T09:00');
    assert.equal(result.draft.endsAt, null);
    assert.equal(result.draft.hours, null);
    assert.match(result.warnings.join(' '), /ช่วงเวลากิจกรรมยาวผิดปกติ/);
    assert.match(result.warnings.join(' '), /จำนวนชั่วโมง/);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PD_AI_SCAN_URL;
    else process.env.PD_AI_SCAN_URL = previousUrl;
  }
});

test('proxy PDF scan ตัดวันสิ้นสุดที่ก่อนวันเริ่มหลังแปลง พ.ศ.', async () => {
  const previousUrl = process.env.PD_AI_SCAN_URL;
  const originalFetch = global.fetch;
  process.env.PD_AI_SCAN_URL = 'https://scanner.example.test/scan';
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      title: 'กิจกรรม', type: 'ประชุม', startsAt: '2026-09-15T09:00:00+07:00',
      endsAt: '2568-09-15T16:00:00+07:00', location: '', organizer: '',
      objective: '', details: '', hours: null, expenses: null, status: 'ร่าง',
    }),
  });
  try {
    const pd = require('../functions/professionalDevelopment');
    const result = await pd.scanProfessionalDevelopmentPdf(
      { buffer: Buffer.from('%PDF-test'), originalname: 'mixed-years.pdf' }, { id: 'teacher1' }
    );
    assert.equal(result.draft.startsAt, '2026-09-15T09:00');
    assert.equal(result.draft.endsAt, null);
    assert.match(result.warnings.join(' '), /วันเวลาสิ้นสุดก่อนวันเวลาเริ่ม/);
  } finally {
    global.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.PD_AI_SCAN_URL;
    else process.env.PD_AI_SCAN_URL = previousUrl;
  }
});
