require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings — avoids UTC-offset date shift
types.setTypeParser(1082, val => val);

// Postgres ในเครื่อง (dev) ไม่ได้เปิด SSL — บังคับ ssl จะต่อไม่ติด
// remote (Railway) ต้องใช้ SSL เสมอ
let isLocal = false;
try {
  const h = new URL(process.env.DATABASE_URL || '').hostname;
  isLocal = h === 'localhost' || h === '127.0.0.1';
} catch (_) { /* URL อ่านไม่ได้ → ถือว่า remote ไว้ก่อน ปลอดภัยกว่า */ }

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[DB] Unexpected pool error', err.message));

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
