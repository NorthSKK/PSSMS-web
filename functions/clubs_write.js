const { query } = require('../lib/db');
const cache = require('../lib/cache');

function invalidateClubs(term, year) {
  cache.del(`clubs_${term}_${year}`);
}

// Frontend: createClub(payload) → 1 object. clubId always generated server-side (matches GAS).
async function createClub([payload]) {
  const c = payload || {};
  const clubId = `CLUB${Date.now()}`;
  await query(
    `INSERT INTO clubs(club_id,club_name,description,capacity,term,year,status)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [clubId, String(c.clubName || '').trim(), String(c.description || '').trim(),
     parseInt(c.capacity) || 0, c.term, c.year, c.status || 'open']
  );

  if (Array.isArray(c.advisors) && c.advisors.length > 0) {
    for (const a of c.advisors) {
      await query(
        `INSERT INTO club_advisors(club_id,teacher_id,teacher_name,role,term,year)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [clubId, a.teacherId, a.teacherName || '', a.role || 'หัวหน้า', c.term, c.year]
      );
    }
  }

  invalidateClubs(c.term, c.year);
  return { status: 'success', message: 'สร้างชุมนุมเรียบร้อย', clubId };
}

// Frontend: updateClub(payload) → 1 object, clubId inside payload (matches GAS).
async function updateClub([payload]) {
  const u = payload || {};
  const clubId = String(u.clubId || '').trim();
  if (!clubId) return { status: 'error', message: 'ไม่พบรหัสชุมนุม' };

  // Resolve term/year from clubs row (immutable in GAS — keep DB row authoritative)
  const cur = await query(`SELECT term, year FROM clubs WHERE club_id=$1`, [clubId]);
  if (cur.rows.length === 0) return { status: 'error', message: 'ไม่พบชุมนุม' };
  const term = cur.rows[0].term, year = cur.rows[0].year;

  const sets = [];
  const params = [];
  const push = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };

  if (u.clubName    !== undefined) push('club_name',   String(u.clubName).trim());
  if (u.description !== undefined) push('description', String(u.description).trim());
  if (u.capacity    !== undefined) push('capacity',    parseInt(u.capacity) || 0);
  if (u.status      !== undefined) push('status',      u.status);
  sets.push('updated_at=NOW()');

  if (sets.length > 1) {
    params.push(clubId);
    await query(`UPDATE clubs SET ${sets.join(',')} WHERE club_id=$${params.length}`, params);
  }

  if (Array.isArray(u.advisors)) {
    await query(`DELETE FROM club_advisors WHERE club_id=$1`, [clubId]);
    for (const a of u.advisors) {
      await query(
        `INSERT INTO club_advisors(club_id,teacher_id,teacher_name,role,term,year)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [clubId, a.teacherId, a.teacherName || '', a.role || 'หัวหน้า', term, year]
      );
    }
  }

  invalidateClubs(term, year);
  return { status: 'success', message: 'อัปเดตชุมนุมเรียบร้อย' };
}

async function registerClub([studentId, studentName, className, clubId, term, year, registeredBy]) {
  const existing = await query(
    `SELECT club_id FROM club_members WHERE student_id=$1 AND term=$2 AND year=$3`,
    [studentId, term, year]
  );
  if (existing.rows.length > 0) {
    throw new Error(`นักเรียน ${studentId} ลงทะเบียนชุมนุมอื่นแล้ว`);
  }
  const clubRes = await query(
    `SELECT capacity FROM clubs WHERE club_id=$1`, [clubId]
  );
  if (clubRes.rows.length === 0) throw new Error('ไม่พบชุมนุม');
  const cap = clubRes.rows[0].capacity;
  if (cap > 0) {
    const cnt = await query(
      `SELECT COUNT(*) as n FROM club_members WHERE club_id=$1 AND term=$2 AND year=$3`,
      [clubId, term, year]
    );
    if (parseInt(cnt.rows[0].n) >= cap) throw new Error('ชุมนุมเต็มแล้ว');
  }
  await query(
    `INSERT INTO club_members(club_id,student_id,student_name,class_name,term,year,registered_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [clubId, studentId, studentName || '', className || '', term, year, registeredBy || '']
  );
  invalidateClubs(term, year);
  return { status: 'success', message: 'ลงทะเบียนชุมนุมสำเร็จ' };
}

async function unregisterClub([studentId, term, year]) {
  await query(
    `DELETE FROM club_members WHERE student_id=$1 AND term=$2 AND year=$3`,
    [studentId, term, year]
  );
  invalidateClubs(term, year);
  return { status: 'success', message: 'ยกเลิกลงทะเบียนชุมนุมสำเร็จ' };
}

module.exports = { createClub, updateClub, registerClub, unregisterClub };
