'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const MAGIC = Buffer.from('PSSMSA1\n');

function archiveKey(value) {
  const key = Buffer.from(String(value || ''), 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) throw new Error('Invalid archive encryption key');
  return key;
}
const aad = (slug, key) => Buffer.from(`${slug}\n${key}`);
async function digestFile(file) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}
async function encryptFile(source, target, key, slug, objectKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(slug, objectKey));
  await fsp.writeFile(target, Buffer.concat([MAGIC, iv]), { mode: 0o600 });
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: 'a', mode: 0o600 }));
  await fsp.appendFile(target, cipher.getAuthTag());
  return digestFile(source);
}
async function decryptFile(source, target, key, slug, objectKey, expected) {
  const stat = await fsp.stat(source);
  if (stat.size < 36) throw new Error('Truncated archive');
  const handle = await fsp.open(source, 'r');
  const header = Buffer.alloc(20), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, 20, 0); await handle.read(tag, 0, 16, stat.size - 16); }
  finally { await handle.close(); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported archive format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(aad(slug, objectKey));
  decipher.setAuthTag(tag);
  // Handle empty plaintext too: createReadStream's end would otherwise be < start.
  const input = stat.size === 36 ? require('node:stream').Readable.from([])
    : fs.createReadStream(source, { start: 20, end: stat.size - 17 });
  try {
    await pipeline(input, decipher, fs.createWriteStream(target, { mode: 0o600 }));
    const actual = await digestFile(target);
    if (expected && (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)) {
      throw new Error('Archive content checksum mismatch');
    }
    return actual;
  } catch (err) { await fsp.rm(target, { force: true }); throw err; }
}
function signManifest(payload, key) {
  return { ...payload, hmac: crypto.createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex') };
}
function verifyManifest(manifest, key, slug, prefix) {
  const { hmac, ...payload } = manifest || {};
  const expected = crypto.createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(hmac || '') ||
      !crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) throw new Error('Archive manifest authentication failed');
  if (payload.version !== 1 || payload.slug !== slug || payload.prefix !== prefix ||
      payload.job_id !== prefix || payload.freeze_id !== payload.job_id ||
      payload.restore_verified !== true || !Array.isArray(payload.files) ||
      payload.files_count !== payload.files.length) throw new Error('Archive manifest identity mismatch');
  const seen = new Set();
  let total = 0;
  for (const item of [payload.database, payload.config, ...payload.files]) {
    if (!item || !item.key.startsWith(prefix + '/') || item.key.includes('..') || seen.has(item.key) ||
        !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      throw new Error('Invalid archive manifest item');
    }
    seen.add(item.key); total += item.bytes;
  }
  if (payload.total_bytes !== total) throw new Error('Archive manifest size mismatch');
  return payload;
}
module.exports = { archiveKey, digestFile, encryptFile, decryptFile, signManifest, verifyManifest };
