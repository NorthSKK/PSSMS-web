const { query } = require('../lib/db');

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

async function saveBudget([data]) {
  const d = data || {};
  await query(
    `INSERT INTO budgets(project_id,project_name,budget_amount,used_amount,status,year)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(project_id) DO UPDATE SET
       project_name=$2, budget_amount=$3, used_amount=$4, status=$5, year=$6`,
    [d.projectId||`proj_${Date.now()}`, d.projectName||'',
     d.budgetAmount||0, d.usedAmount||0, d.status||'active', d.year||'']
  );
  return { status: 'success', message: 'บันทึกงบประมาณสำเร็จ' };
}

module.exports = { getBudgets, saveBudget };
