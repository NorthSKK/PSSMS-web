const { query, pool } = require('../lib/db');

// Normalize student ID: strip non-alphanumeric, drop leading zeros
const normID = (id) => String(id || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '') || '0';

// ── saveSavingsTransaction ─────────────────────────────────────────────────
// args: [rows, term, year]
//   rows: [{ studentId, studentName, class, type, amount, note }]
// Returns { status, saved, message }
async function saveSavingsTransaction([rows, term, year], user) {
  if (!Array.isArray(rows) || rows.length === 0)
    return { status: 'success', saved: 0, message: 'ไม่มีข้อมูลที่บันทึก' };

  const date = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let saved = 0;
    for (const r of rows) {
      const type = String(r.type || '').trim();
      const amount = parseFloat(r.amount);
      if (!['deposit', 'withdraw'].includes(type) || !(amount > 0)) continue;
      await client.query(
        `INSERT INTO savings_transactions
           (student_id, student_name, class, type, amount, recorded_by, note, date, term, year)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          normID(r.studentId),
          String(r.studentName || '').trim(),
          String(r.class || '').trim(),
          type,
          amount,
          String(user.id).trim(),
          String(r.note || '').trim(),
          date,
          String(term).trim(),
          String(year).trim(),
        ]
      );
      saved++;
    }
    await client.query('COMMIT');
    return { status: 'success', saved, message: `บันทึกสำเร็จ ${saved} รายการ` };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── getSavingsBalance ──────────────────────────────────────────────────────
// args: [studentId]
// Returns { studentId, balance }  (cumulative across all terms)
async function getSavingsBalance([studentId]) {
  const sid = normID(studentId);
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN type='deposit'  THEN amount ELSE 0 END), 0) AS total_deposit,
       COALESCE(SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END), 0) AS total_withdraw
     FROM savings_transactions WHERE student_id=$1`,
    [sid]
  );
  const dep = parseFloat(rows[0].total_deposit);
  const wit = parseFloat(rows[0].total_withdraw);
  return { studentId: sid, balance: dep - wit };
}

// ── getSavingsSummary ──────────────────────────────────────────────────────
// args: [className]
// Returns { students: [{ studentId, studentName, totalDeposit, totalWithdraw, balance }], classTotal }
// Balance = cumulative across all terms/years (no term filter)
async function getSavingsSummary([className]) {
  // Get current student roster for this class
  const { rows: roster } = await query(
    `SELECT username, full_name FROM users
     WHERE UPPER(role)='STUDENT' AND department=$1 AND status='ปกติ'
     ORDER BY full_name`,
    [String(className).trim()]
  );

  if (roster.length === 0) return { students: [], classTotal: { totalDeposit: 0, totalWithdraw: 0, balance: 0 } };

  const ids = roster.map(r => normID(r.username));

  const { rows: sums } = await query(
    `SELECT student_id,
       COALESCE(SUM(CASE WHEN type='deposit'  THEN amount ELSE 0 END), 0) AS total_deposit,
       COALESCE(SUM(CASE WHEN type='withdraw' THEN amount ELSE 0 END), 0) AS total_withdraw
     FROM savings_transactions
     WHERE student_id = ANY($1)
     GROUP BY student_id`,
    [ids]
  );

  const sumMap = {};
  for (const s of sums) sumMap[s.student_id] = s;

  let classDeposit = 0, classWithdraw = 0;
  const students = roster.map(r => {
    const sid = normID(r.username);
    const s = sumMap[sid] || { total_deposit: 0, total_withdraw: 0 };
    const dep = parseFloat(s.total_deposit);
    const wit = parseFloat(s.total_withdraw);
    classDeposit += dep;
    classWithdraw += wit;
    return {
      studentId: sid,
      studentName: r.full_name,
      totalDeposit: dep,
      totalWithdraw: wit,
      balance: dep - wit,
    };
  });

  return {
    students,
    classTotal: {
      totalDeposit: classDeposit,
      totalWithdraw: classWithdraw,
      balance: classDeposit - classWithdraw,
    },
  };
}

// ── getSavingsHistory ──────────────────────────────────────────────────────
// args: [studentId]
// Returns [{ id, type, amount, date, term, year, recordedBy, note, createdAt }]
async function getSavingsHistory([studentId]) {
  const { rows } = await query(
    `SELECT id, type, amount, date, term, year, recorded_by, note, created_at
     FROM savings_transactions
     WHERE student_id=$1
     ORDER BY date DESC, created_at DESC`,
    [normID(studentId)]
  );
  return rows.map(r => ({
    id: r.id,
    type: r.type,
    amount: parseFloat(r.amount),
    date: r.date,
    term: r.term,
    year: r.year,
    recordedBy: r.recorded_by,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// ── deleteSavingsTransaction ───────────────────────────────────────────────
// args: [id]   — Admin only (enforced in gas.js)
async function deleteSavingsTransaction([id]) {
  const { rowCount } = await query(
    `DELETE FROM savings_transactions WHERE id=$1`,
    [parseInt(id, 10)]
  );
  if (rowCount === 0) throw new Error('ไม่พบรายการที่ต้องการลบ');
  return { status: 'success', message: 'ลบรายการสำเร็จ' };
}

// ── importSavingsCSV ───────────────────────────────────────────────────────
// args: [csvText, term, year]   — Admin only
// CSV header: timestamp,student_id,student_name,type,amount,balance_after,teacher_name
// Skips duplicates via (student_id, type, amount, date)
async function importSavingsCSV([csvText, term, year]) {
  const lines = String(csvText).split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('ไฟล์ CSV ว่างหรือไม่มีข้อมูล');

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const col = (row, name) => {
    const i = header.indexOf(name);
    return i >= 0 ? String(row[i] || '').trim().replace(/^["']|["']$/g, '') : '';
  };

  // Lookup class by student_id from users table
  const { rows: userRows } = await query(
    `SELECT username, department FROM users WHERE UPPER(role)='STUDENT'`
  );
  const classMap = {};
  for (const u of userRows) classMap[normID(u.username)] = u.department || '';

  const typeMap = { ฝาก: 'deposit', deposit: 'deposit', ถอน: 'withdraw', withdraw: 'withdraw' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0, skipped = 0, errors = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].split(',');
      const rawId   = col(row, 'student_id');
      const rawName = col(row, 'student_name');
      const rawType = col(row, 'type').toLowerCase();
      const rawAmt  = col(row, 'amount');
      const rawTs   = col(row, 'timestamp') || col(row, 'date');

      const sid    = normID(rawId);
      const type   = typeMap[rawType];
      const amount = parseFloat(rawAmt);

      // Parse date from timestamp (take date part only)
      const dateStr = rawTs ? rawTs.slice(0, 10) : null;

      if (!sid || !type || !(amount > 0) || !dateStr) { errors++; continue; }

      // Skip duplicate
      const { rows: dup } = await client.query(
        `SELECT 1 FROM savings_transactions
         WHERE student_id=$1 AND type=$2 AND amount=$3 AND date=$4 LIMIT 1`,
        [sid, type, amount, dateStr]
      );
      if (dup.length > 0) { skipped++; continue; }

      const cls = classMap[sid] || '';
      await client.query(
        `INSERT INTO savings_transactions
           (student_id, student_name, class, type, amount, recorded_by, note, date, term, year)
         VALUES ($1,$2,$3,$4,$5,'import',$6,$7,$8,$9)`,
        [sid, rawName, cls, type, amount, '', dateStr, String(term).trim(), String(year).trim()]
      );
      inserted++;
    }

    await client.query('COMMIT');
    return {
      status: 'success',
      message: `นำเข้าสำเร็จ ${inserted} รายการ (ข้าม ${skipped} ซ้ำ, ข้อมูลผิด ${errors} แถว)`,
      inserted, skipped, errors,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ── getClassListForSavings ─────────────────────────────────────────────────
// args: []
// Returns distinct classes that have students (status=ปกติ)
async function getClassListForSavings() {
  const { rows } = await query(
    `SELECT DISTINCT department AS class FROM users
     WHERE UPPER(role)='STUDENT' AND status='ปกติ' AND department IS NOT NULL AND department != ''
     ORDER BY department`
  );
  return rows.map(r => r.class);
}

module.exports = {
  saveSavingsTransaction,
  getSavingsBalance,
  getSavingsSummary,
  getSavingsHistory,
  deleteSavingsTransaction,
  importSavingsCSV,
  getClassListForSavings,
};
