const { query } = require('../lib/db');
const cache = require('../lib/cache');

module.exports = async function getClubList([term, year]) {
  const key = `clubs_${term}_${year}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const [clubsRes, advisorsRes, membersRes] = await Promise.all([
    query(`SELECT * FROM clubs WHERE term=$1 AND year=$2 ORDER BY club_id`, [term, year]),
    query(`SELECT * FROM club_advisors WHERE term=$1 AND year=$2`, [term, year]),
    query(`SELECT club_id, COUNT(*) as cnt FROM club_members WHERE term=$1 AND year=$2 GROUP BY club_id`, [term, year]),
  ]);

  const advisorMap = {};
  for (const r of advisorsRes.rows) {
    if (!advisorMap[r.club_id]) advisorMap[r.club_id] = [];
    advisorMap[r.club_id].push({ teacherId: r.teacher_id, teacherName: r.teacher_name, role: r.role });
  }
  const memberCount = {};
  for (const r of membersRes.rows) memberCount[r.club_id] = parseInt(r.cnt);

  const result = clubsRes.rows.map(r => {
    const mc = memberCount[r.club_id] || 0;
    const capacity = r.capacity || 0;
    return {
      clubId: r.club_id, clubName: r.club_name, description: r.description,
      capacity, term: r.term, year: r.year, status: r.status,
      memberCount: mc, seatsLeft: Math.max(capacity - mc, 0),
      full: capacity > 0 && mc >= capacity,
      advisors: advisorMap[r.club_id] || [],
    };
  });

  cache.set(key, result, 300);
  return result;
};
