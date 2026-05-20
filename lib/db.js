require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings — avoids UTC-offset date shift
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[DB] Unexpected pool error', err.message));

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
