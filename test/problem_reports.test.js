'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ok, baseURL, stop, TOKENS, token } = require('./helpers/api');
const { query } = require('../lib/db');
const reports = require('../functions/problemReports');

after(async () => {
  await query("DELETE FROM problem_reports WHERE description LIKE 'รายงานทดสอบ%'");
  await stop();
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png'),
]);

function attach(reportId, bearer, content = PNG, filename = 'screen.png') {
  const boundary = '----support' + Date.now() + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return baseURL().then(base => new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/media/problem-report/${reportId}/attachment`, {
      method: 'POST', headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  }));
}

test('ทุกบทบาทส่งรายงานได้ และข้อมูลฝั่ง browser ถูกจำกัดให้ปลอดภัย', async () => {
  const result = await ok('createProblemReport', [{
    description: 'รายงานทดสอบ นักเรียนกดปุ่มแล้วหน้าไม่เปลี่ยน',
    pageKey: 'student-dashboard', pageLabel: 'หน้าหลักนักเรียน',
    clientMeta: { userAgent: 'x'.repeat(900), viewport: { width: 390, height: 844 }, timezone: 'Asia/Bangkok' },
  }], 'student');
  assert.equal(result.status, 'success');
  assert.equal(result.attachmentLimit, 3);
  assert.equal(result.delivered, false, 'เทสต์ไม่ตั้งปลายทางหลังบ้านกลาง');
  const { rows } = await query(`SELECT reporter_id,reporter_role,page_key,app_version,app_build,client_meta
    FROM problem_reports WHERE id=$1`, [result.id]);
  assert.equal(rows[0].reporter_id, '01901');
  assert.equal(rows[0].reporter_role, 'Student');
  assert.equal(rows[0].page_key, 'student-dashboard');
  assert.ok(rows[0].app_version && rows[0].app_build);
  assert.equal(rows[0].client_meta.userAgent.length, 512);
});

test('ภาพถูก relay สู่หลังบ้านกลางเท่านั้น และผูกกับเจ้าของรายงาน', async (t) => {
  const oldUrl = process.env.PSSMS_SUPPORT_INGEST_URL;
  const oldToken = process.env.PSSMS_SUPPORT_INGEST_TOKEN;
  process.env.PSSMS_SUPPORT_INGEST_URL = 'http://support.test';
  process.env.PSSMS_SUPPORT_INGEST_TOKEN = 'school-specific-secret';
  let reportId = '';
  let attachmentCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.headers.get('authorization'), 'Bearer school-specific-secret');
    const path = new URL(request.url).pathname;
    if (path.endsWith('/reports')) {
      const body = await request.json();
      reportId = body.sourceReportId;
      assert.equal(body.reporter.id, 'teacher1');
      assert.equal(typeof body.schoolName, 'string');
      return Response.json({ id: 'central-report-1' });
    }
    assert.match(path, new RegExp(`/reports/${reportId}/attachments$`));
    const form = await request.formData();
    const file = form.get('file');
    assert.equal(file.type, 'image/png');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    attachmentCalls++;
    return Response.json({ id: 'central-file-' + attachmentCalls });
  });
  try {
    const created = await ok('createProblemReport', [{ description: 'รายงานทดสอบ ครูแนบภาพหน้าจอ' }], 'teacher1');
    assert.equal(created.delivered, true);
    const other = await attach(created.id, TOKENS.teacher2);
    assert.equal(other.status, 400);
    assert.match(other.body.__error, /ไม่มีสิทธิ์/);
    for (let i = 0; i < 3; i++) {
      const uploaded = await attach(created.id, TOKENS.teacher1);
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    }
    const fourth = await attach(created.id, TOKENS.teacher1);
    assert.equal(fourth.status, 400);
    assert.match(fourth.body.__error, /สูงสุด 3/);
    const saved = await query(`SELECT file_ext,remote_file_id FROM problem_report_attachments WHERE report_id=$1`, [created.id]);
    assert.equal(saved.rows.length, 3);
    assert.deepEqual(saved.rows.map(r => r.file_ext), ['png', 'png', 'png']);
    assert.deepEqual(saved.rows.map(r => r.remote_file_id), ['central-file-1', 'central-file-2', 'central-file-3']);
  } finally {
    if (oldUrl === undefined) delete process.env.PSSMS_SUPPORT_INGEST_URL; else process.env.PSSMS_SUPPORT_INGEST_URL = oldUrl;
    if (oldToken === undefined) delete process.env.PSSMS_SUPPORT_INGEST_TOKEN; else process.env.PSSMS_SUPPORT_INGEST_TOKEN = oldToken;
  }
});

test('app info endpoint เปิดเฉพาะ version/build/deployedAt', async () => {
  const base = await baseURL();
  const result = await fetch(base + '/api/app-info');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const body = await result.json();
  assert.deepEqual(Object.keys(body).sort(), ['build', 'deployedAt', 'version']);
  assert.match(body.version, /^\d+\.\d+\.\d+/);
});

test('WebP magic bytes are accepted only for the support-report allowlist', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const types = require('../lib/storage/types');
  assert.equal(types.detect(webp, reports.IMAGE_EXTS).ext, 'webp');
  assert.equal(types.detect(Buffer.from('RIFFxxxxxWEBP'), reports.IMAGE_EXTS), null);
});
