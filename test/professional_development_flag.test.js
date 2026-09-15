'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const cache = require('../lib/cache');
const { call, ok, stop, TOKENS, baseURL } = require('./helpers/api');

const originalFlag = process.env.PROFESSIONAL_DEVELOPMENT_ENABLED;

after(async () => {
  if (originalFlag === undefined) delete process.env.PROFESSIONAL_DEVELOPMENT_ENABLED;
  else process.env.PROFESSIONAL_DEVELOPMENT_ENABLED = originalFlag;
  cache.del('system_config');
  await stop();
});

function setEnabled(value) {
  process.env.PROFESSIONAL_DEVELOPMENT_ENABLED = value ? 'true' : 'false';
  cache.del('system_config');
}

async function postPdf(pathname) {
  const boundary = '----pssms-pd-flag';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.pdf"\r\n` +
    'Content-Type: application/pdf\r\n\r\n%PDF-1.4\nproof\n%%EOF\r\n' +
    `--${boundary}--\r\n`,
  );
  const base = await baseURL();
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKENS.teacher1}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('ปิดพัฒนาวิชาชีพ: config แจ้ง frontend และ GAS/page/media เรียกตรงไม่ได้', async () => {
  setEnabled(false);

  const config = await ok('getSystemConfig');
  assert.equal(config.features.professionalDevelopment, false);

  const list = await call('getProfessionalDevelopmentActivities', [], 'teacher1');
  assert.match(list.__error, /ยังไม่เปิดใช้งาน/);

  const page = await call('getPage', ['Page_Professional_Development'], 'teacher1');
  assert.match(page.__error, /ยังไม่เปิดใช้งาน/);

  const scan = await postPdf('/api/media/professional-development/scan');
  assert.equal(scan.status, 404);
  assert.match(scan.body.__error, /ยังไม่เปิดใช้งาน/);

  const attachment = await postPdf('/api/media/professional-development/1');
  assert.equal(attachment.status, 404);
  assert.match(attachment.body.__error, /ยังไม่เปิดใช้งาน/);
});

test('เปิดพัฒนาวิชาชีพ: config และ GAS ใช้งานได้ตามปกติ', async () => {
  setEnabled(true);

  const config = await ok('getSystemConfig');
  assert.equal(config.features.professionalDevelopment, true);
  assert.ok(Array.isArray(await ok('getProfessionalDevelopmentActivities', [], 'teacher1')));
});
