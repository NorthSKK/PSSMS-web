const { query } = require('../lib/db');
const { verifyLessonRecordOwner } = require('../lib/permissions');

async function getDetailedLessonRecords([, term, year], user) {
  // Ignore payload teacherId; always query by JWT user.id
  const teacherId = String(user?.id || '');
  const { rows } = await query(
    `SELECT id, to_char(timestamp,'YYYY-MM-DD HH24:MI') as ts,
            to_char(date,'YYYY-MM-DD') as date,
            term, year, subject_code, subject_name, class, period,
            topic, outcomes, problems, solutions,
            dpa_indicators, skills_3r8c, student_results,
            work_file_url, atmosphere_url, session_id
     FROM detailed_lesson_records
     WHERE teacher_id=$1 AND term=$2 AND year=$3
     ORDER BY date DESC, id DESC`,
    [teacherId, term, year]
  );
  return rows.map(r => ({
    // Use id as timestamp key so deleteDetailedLessonRecord can match by String(i.timestamp)
    timestamp: String(r.id),
    date: r.date || '',
    term: r.term || '',
    year: r.year || '',
    subjectCode: r.subject_code || '',
    subjectName: r.subject_name || '',
    className: r.class || '',
    period: r.period || '',
    topic: r.topic || '',
    outcomes: r.outcomes || '',
    problems: r.problems || '',
    solutions: r.solutions || '',
    dpaIndicators: r.dpa_indicators || [],
    skills3r8c: r.skills_3r8c || [],
    studentResults: r.student_results || '',
    workFileUrl: r.work_file_url || '',
    atmosphereUrl: r.atmosphere_url || '',
    sessionId: r.session_id || '',
  }));
}

async function saveDetailedLessonRecord([record], user) {
  const r = record || {};
  // Use JWT user.id; ignore payload teacherId
  const teacherId = String(user?.id || '');
  await query(
    `INSERT INTO detailed_lesson_records
     (date,term,year,subject_code,subject_name,class,period,topic,outcomes,problems,solutions,
      dpa_indicators,skills_3r8c,student_results,work_file_url,atmosphere_url,teacher_id,session_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      r.date, r.term, r.year, r.subjectCode, r.subjectName,
      r.className, r.period, r.topic || '',
      r.outcomes || '', r.problems || '', r.solutions || '',
      JSON.stringify(r.dpaIndicators || []),
      JSON.stringify(r.skills3r8c || []),
      r.studentResults || '',
      r.workFileUrl || '', r.atmosphereUrl || '',
      teacherId, r.sessionId || '',
    ]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

async function deleteDetailedLessonRecord([ts], user) {
  // ts = String(id) from getDetailedLessonRecords
  const id = parseInt(ts);
  if (isNaN(id)) throw new Error('Invalid record id');
  await verifyLessonRecordOwner(user, id);
  await query(`DELETE FROM detailed_lesson_records WHERE id=$1`, [id]);
  return { status: 'success', message: 'ลบสำเร็จ' };
}

async function updateDetailedLessonRecord([ts, record], user) {
  const id = parseInt(ts);
  if (isNaN(id)) throw new Error('Invalid record id');
  await verifyLessonRecordOwner(user, id);
  const r = record || {};
  await query(
    `UPDATE detailed_lesson_records SET
       date=$1, subject_code=$2, subject_name=$3, class=$4, period=$5,
       topic=$6, outcomes=$7, problems=$8, solutions=$9,
       dpa_indicators=$10, skills_3r8c=$11, student_results=$12,
       work_file_url=$13, atmosphere_url=$14
     WHERE id=$15`,
    [
      r.date, r.subjectCode, r.subjectName, r.className, r.period,
      r.topic || '', r.outcomes || '', r.problems || '', r.solutions || '',
      JSON.stringify(r.dpaIndicators || []),
      JSON.stringify(r.skills3r8c || []),
      r.studentResults || '',
      r.workFileUrl || '', r.atmosphereUrl || '',
      id,
    ]
  );
  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

module.exports = {
  getDetailedLessonRecords,
  saveDetailedLessonRecord,
  deleteDetailedLessonRecord,
  updateDetailedLessonRecord,
};
