'use strict';

/**
 * School-side outbox for support reports.
 *
 * The central PSSMS back office is the only place that can read reports and
 * files. A school database retains only a delivery audit; attachment bytes are
 * streamed from the authenticated school's request directly to the central
 * ingest endpoint and are never made available from this deployment.
 */
const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const { appInfo } = require('../lib/appInfo');
const types = require('../lib/storage/types');

const MAX_DESCRIPTION = 4000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACH_MB = 8;
const IMAGE_EXTS = ['jpg', 'png', 'webp'];
const INGEST_PATH = '/api/support/ingest';

function clean(value, max) { return String(value || '').trim().slice(0, max); }
function idOf(user) { return clean(user?.id, 120); }

function safeClientMeta(value) {
  const source = value && typeof value === 'object' ? value : {};
  const number = (n) => Number.isFinite(Number(n)) ? Math.max(0, Math.min(10000, Number(n))) : null;
  return {
    userAgent: clean(source.userAgent, 512),
    viewport: { width: number(source?.viewport?.width), height: number(source?.viewport?.height) },
    timezone: clean(source.timezone, 80),
    locale: clean(source.locale, 40),
  };
}

function ingestConfig() {
  const url = clean(process.env.PSSMS_SUPPORT_INGEST_URL, 500).replace(/\/+$/, '');
  const token = clean(process.env.PSSMS_SUPPORT_INGEST_TOKEN, 500);
  if (!url || !token) return null;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('ตั้งค่า PSSMS_SUPPORT_INGEST_URL ไม่ถูกต้อง'); }
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test') {
    throw new Error('PSSMS_SUPPORT_INGEST_URL ต้องเป็น HTTPS');
  }
  return { url, token };
}

async function relay(path, options = {}) {
  const config = ingestConfig();
  if (!config) return { delivered: false, reason: 'not_configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(config.url + INGEST_PATH + path, {
      ...options,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'X-PSSMS-Ingest-Version': '1',
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`ปลายทางตอบ ${response.status}`);
    return { delivered: true, body };
  } catch (err) {
    console.error('[problem-report:relay]', err.name === 'AbortError' ? 'timeout' : err.message);
    return { delivered: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

async function ownerReport(reportId, user) {
  const { rows } = await query(
    `SELECT id, reporter_id FROM problem_reports WHERE id=$1`, [String(reportId || '')]
  );
  const row = rows[0];
  if (!row) throw new Error('ไม่พบรายการแจ้งปัญหา');
  if (String(row.reporter_id) !== idOf(user)) throw new Error('ไม่มีสิทธิ์แนบไฟล์ในรายการนี้');
  return row;
}

async function createProblemReport([payload], user) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const description = clean(data.description, MAX_DESCRIPTION);
  if (description.length < 5) throw new Error('กรุณาอธิบายปัญหาอย่างน้อย 5 ตัวอักษร');

  const [config] = await Promise.all([getSystemConfig()]);
  const info = appInfo();
  const reporterId = idOf(user);
  if (!reporterId) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');
  const report = {
    description,
    pageKey: clean(data.pageKey, 120),
    pageLabel: clean(data.pageLabel, 160),
    clientMeta: safeClientMeta(data.clientMeta),
    app: info,
    reporter: { id: reporterId, name: clean(user?.name, 200), role: clean(user?.role, 40) },
    // This comes from the server-side school configuration, never the browser.
    schoolName: clean(config.schoolName, 240),
  };
  const { rows } = await query(`INSERT INTO problem_reports
    (reporter_id,reporter_name,reporter_role,school_name,description,page_key,page_label,
     app_version,app_build,deployed_at,client_meta)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [
    report.reporter.id, report.reporter.name, report.reporter.role, report.schoolName,
    report.description, report.pageKey, report.pageLabel, info.version, info.build,
    info.deployedAt, report.clientMeta,
  ]);
  const id = rows[0].id;
  const delivered = await relay('/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceReportId: id, ...report }),
  });
  await query(`UPDATE problem_reports SET delivery_status=$1, delivery_error=$2, remote_id=$3,
      delivered_at=CASE WHEN $1='delivered' THEN NOW() ELSE NULL END WHERE id=$4`, [
    delivered.delivered ? 'delivered' : 'pending',
    delivered.delivered ? null : delivered.reason,
    delivered.delivered ? clean(delivered.body?.id, 120) || null : null,
    id,
  ]);
  return {
    status: 'success', id, attachmentLimit: MAX_ATTACHMENTS,
    delivered: delivered.delivered,
    message: delivered.delivered ? 'ส่งรายละเอียดให้ทีม PSSMS แล้ว' : 'บันทึกรายการแล้ว จะส่งให้ทีม PSSMS เมื่อเชื่อมต่อได้',
  };
}

async function attachProblemReportFile(reportId, file, user) {
  const report = await ownerReport(reportId, user);
  const { rows: countRows } = await query(
    'SELECT count(*)::int AS count FROM problem_report_attachments WHERE report_id=$1', [report.id]
  );
  if (countRows[0].count >= MAX_ATTACHMENTS) throw new Error(`แนบภาพได้สูงสุด ${MAX_ATTACHMENTS} ภาพ`);
  const type = file && file.detectedExt;
  if (!IMAGE_EXTS.includes(type) || !file.buffer) throw new Error('รองรับเฉพาะภาพ JPG, PNG หรือ WebP');

  const form = new FormData();
  // MIME from multipart is client-controlled. The central store receives the
  // MIME derived from the magic-byte result instead.
  form.set('file', new Blob([file.buffer], { type: types.byExt(type).mime }),
    clean(file.originalname, 255) || `attachment.${type}`);
  const delivered = await relay(`/reports/${encodeURIComponent(report.id)}/attachments`, {
    method: 'POST', body: form,
    headers: { 'X-PSSMS-File-Name': encodeURIComponent(clean(file.originalname, 255) || `attachment.${type}`) },
  });
  if (!delivered.delivered) throw new Error('ส่งภาพให้ทีม PSSMS ไม่สำเร็จ ลองใหม่อีกครั้ง');
  const { rows } = await query(`INSERT INTO problem_report_attachments
    (report_id,file_name,file_ext,file_size,remote_file_id,delivery_status,delivered_at)
    VALUES($1,$2,$3,$4,$5,'delivered',NOW()) RETURNING id`, [
    report.id, clean(file.originalname, 255) || `attachment.${type}`, type, Number(file.size || file.buffer.length),
    clean(delivered.body?.id, 120) || null,
  ]);
  return { status: 'success', id: rows[0].id, message: 'แนบภาพแล้ว' };
}

module.exports = {
  IMAGE_EXTS, MAX_ATTACHMENTS, MAX_ATTACH_MB,
  createProblemReport, attachProblemReportFile,
};
