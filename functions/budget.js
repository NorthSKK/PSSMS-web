const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');

async function getBudgets([year]) {
  const { rows } = await query(
    `SELECT project_id, project_name, budget_amount, used_amount, balance, status, year
     FROM budgets WHERE year=$1 ORDER BY project_id`,
    [year]
  );
  return rows.map(r => ({
    projectId: r.project_id,
    projectName: r.project_name,
    budgetAmount: parseFloat(r.budget_amount || 0),
    usedAmount: parseFloat(r.used_amount || 0),
    balance: parseFloat(r.balance || 0),
    status: r.status || 'active',
    year: r.year,
  }));
}

// saveBudget เป็น upsert ตาม project_id — ถ้าไม่เช็คเจ้าของ ครูคนไหนก็ทับโครงการคนอื่นได้
// แถวที่ created_by ว่าง (ข้อมูลก่อนเพิ่มคอลัมน์) ให้เฉพาะ Admin แก้
async function saveBudget([data], user) {
  const d = data || {};
  const me = String(user?.id || '');
  const projectId = d.projectId || `proj_${Date.now()}`;

  const { rows } = await query(`SELECT created_by FROM budgets WHERE project_id=$1`, [projectId]);
  if (rows.length && !isAdmin(user)) {
    const owner = String(rows[0].created_by || '').trim();
    if (owner.toLowerCase() !== me.toLowerCase()) {
      throw new Error(owner ? 'ไม่มีสิทธิ์แก้โครงการนี้' : 'โครงการนี้ไม่มีเจ้าของบันทึกไว้ ต้องให้ผู้ดูแลระบบแก้');
    }
  }
  // แถวเดิมเก็บ created_by ไว้เหมือนเดิม แถวใหม่ผูกกับคนที่สร้าง
  const createdBy = rows.length ? (rows[0].created_by || me) : me;

  await query(
    `INSERT INTO budgets(project_id,project_name,budget_amount,used_amount,status,year,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(project_id) DO UPDATE SET
       project_name=$2, budget_amount=$3, used_amount=$4, status=$5, year=$6, created_by=$7`,
    [projectId, d.projectName||'',
     d.budgetAmount||0, d.usedAmount||0, d.status||'active', d.year||'', createdBy]
  );
  return { status: 'success', message: 'บันทึกงบประมาณสำเร็จ' };
}

module.exports = { getBudgets, saveBudget };
