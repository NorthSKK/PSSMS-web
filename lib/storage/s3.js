'use strict';
/**
 * driver `s3` — object storage ที่พูด S3 API (ตั้งใจใช้กับ Cloudflare R2)
 *
 * ทำไมไม่ใช้ดิสก์: Railway ไม่มีดิสก์ถาวรให้ service (มี Volume แต่หาไม่เจอบนแพลนนี้)
 * ทำไมไม่ใช้ Google Drive: publish OAuth เป็น production ต้องยืนยันความเป็นเจ้าของโดเมน
 *   ซึ่ง *.up.railway.app เป็นของ Railway และถ้าค้างโหมด Testing token หมดอายุทุก 7 วัน
 * ทำไมไม่ใช้ Postgres bytea: ระบบนี้จะขายหลายโรงเรียน — ไฟล์ใน DB ทำให้ restore ช้า
 *   ตอนที่อยากให้เร็วที่สุด และดึง blob 25MB จองการเชื่อมต่อจาก pool ที่มีแค่ 20 ตัว
 *
 * ── ทำไม aws4fetch ไม่ใช่ @aws-sdk/client-s3 ──────────────────────
 * ใช้แค่ PUT / DELETE / presigned GET · aws-sdk กิน ~20MB พร้อม dependency หลายสิบตัว
 * ซึ่งจะ build ช้าลงทุก deploy × ทุกโรงเรียน เพื่อความสามารถที่ไม่ได้ใช้
 * ถ้าวันหนึ่งต้องรับไฟล์ใหญ่จนต้อง multipart upload ค่อยเปลี่ยน กระทบแค่ไฟล์นี้
 *
 * ── env ────────────────────────────────────────────────────────
 *   S3_ENDPOINT           https://<account_id>.r2.cloudflarestorage.com
 *   S3_BUCKET             1 bucket ต่อ 1 โรงเรียน (จำกัด blast radius ตอน key หลุด)
 *   S3_ACCESS_KEY_ID      token ผูกกับ bucket นั้นใบเดียว
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION             R2 ใช้ 'auto'
 */
const crypto = require('crypto');

// aws4fetch เซ็นด้วย WebCrypto ผ่าน globalThis.crypto ซึ่ง Node เพิ่งเปิดเป็น global
// ตั้งแต่ 19 — บน Node 18 จะได้ "crypto is not defined" ตอนอัปโหลดเท่านั้น
// (เครื่อง dev ที่ Node ใหม่กว่าจะไม่เจอ เจอครั้งแรกบน production)
// ต้อง require ก่อน aws4fetch เพราะมันอ่าน global ตอนเรียกใช้
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;

const { AwsClient } = require('aws4fetch');

const name = 's3';

// ลิงก์อายุสั้น — เปิดไฟล์ทีก็ขอใหม่ที · ยาวไปคือแจกสิทธิ์ให้คนที่ส่งต่อ URL
const URL_TTL_SECONDS = 300;

function config() {
  return {
    endpoint: String(process.env.S3_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: String(process.env.S3_BUCKET || '').trim(),
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    region: process.env.S3_REGION || 'auto',
  };
}

function isConfigured() {
  const c = config();
  return !!(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
}

function client() {
  const c = config();
  if (!isConfigured()) throw new Error('ยังไม่ได้ตั้งค่า S3_* — ปิดการอัปโหลดไว้');
  return new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    region: c.region,
    service: 's3',
  });
}

function objectUrl(key) {
  const c = config();
  return `${c.endpoint}/${c.bucket}/${encodeURIComponent(key)}`;
}

function newKey() {
  return crypto.randomBytes(16).toString('hex') + '.pdf';
}

// key มาจาก DB แต่ถูกเอาไปต่อเป็น URL — กันไว้อีกชั้นเหมือน driver disk
function assertKey(key) {
  if (!/^[0-9a-f]{32}\.pdf$/.test(String(key || ''))) throw new Error('ชื่อไฟล์ไม่ถูกต้อง');
}

async function put({ buffer }) {
  const key = newKey();
  const res = await client().fetch(objectUrl(key), {
    method: 'PUT',
    body: buffer,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
    },
  });
  if (!res.ok) {
    throw new Error(`อัปโหลดขึ้นที่เก็บไฟล์ไม่สำเร็จ (${res.status}): ${await safeText(res)}`);
  }
  return { key, size: buffer.length };
}

async function remove(key) {
  if (!key) return;
  assertKey(key);
  const res = await client().fetch(objectUrl(key), { method: 'DELETE' });
  // 404 = ไฟล์ไม่อยู่แล้ว ถือว่าสำเร็จ ไม่ใช่เหตุให้การลบการ์ดล้ม
  if (!res.ok && res.status !== 404) {
    throw new Error(`ลบไฟล์ไม่สำเร็จ (${res.status}): ${await safeText(res)}`);
  }
}

/**
 * presigned URL — เบราว์เซอร์โหลดจาก R2 ตรง Railway ไม่แตะ byte ไหนเลย
 *
 * สิทธิ์ถูกตรวจตอน "ออก" URL (functions/mediaCards.js getMediaFileTicket)
 * ตัว URL เองเป็น bearer capability เหมือนตั๋วของ driver disk — ใครถือก็เปิดได้
 * จนหมดอายุ จึงตั้งไว้สั้น และเพิกถอนกลางคันไม่ได้ (ยอมรับแล้วตอนออกแบบ)
 *
 * response-content-disposition ทำให้ชื่อไฟล์ภาษาไทยที่ครูอัปมาแสดงถูกตอนโหลด
 */
async function getFileUrl({ key, filename }) {
  assertKey(key);
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(URL_TTL_SECONDS));
  if (filename) {
    url.searchParams.set(
      'response-content-disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
  }
  const signed = await client().sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  return signed.url;
}

async function check() {
  if (!isConfigured()) return { ok: false, detail: 'ยังไม่ได้ตั้งค่า S3_*' };
  const c = config();
  try {
    // ListObjects แบบขอ 1 ชิ้น — ยืนยันทั้ง endpoint, key, และสิทธิ์บน bucket นี้
    const res = await client().fetch(`${c.endpoint}/${c.bucket}?list-type=2&max-keys=1`);
    if (!res.ok) {
      return { ok: false, detail: `ที่เก็บไฟล์ตอบ ${res.status}: ${await safeText(res)}` };
    }
    return { ok: true, detail: `${c.bucket} @ ${new URL(c.endpoint).host}` };
  } catch (err) {
    return { ok: false, detail: 'ต่อที่เก็บไฟล์ไม่ได้: ' + err.message };
  }
}

async function safeText(res) {
  try { return (await res.text()).slice(0, 200); } catch { return ''; }
}

module.exports = { name, isConfigured, put, remove, getFileUrl, check, URL_TTL_SECONDS };
