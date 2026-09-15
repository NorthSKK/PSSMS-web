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
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PD_AI_SCAN_URL;
    else process.env.PD_AI_SCAN_URL = previousUrl;
  }
});
