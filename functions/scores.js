const { query } = require('../lib/db');
const { isAdmin, resolveTeacherId, verifyTeacherOwnsSubject } = require('../lib/permissions');

async function getSubjectConfig([subjectCode, className, term, year]) {
  let rows;
  ({ rows } = await query(
    `SELECT subject_id, subject_code, class_name, term, year, score_ratio,
            indicators_json, teacher_id, exam_indicators_json
     FROM subject_config WHERE subject_code=$1 AND class_name=$2 AND term=$3 AND year=$4`,
    [subjectCode, className, term, year]
  ));
  if (rows.length === 0) {
    ({ rows } = await query(
      `SELECT subject_id, subject_code, class_name, term, year, score_ratio,
              indicators_json, teacher_id, exam_indicators_json
       FROM subject_config WHERE subject_code=$1 ORDER BY subject_id DESC LIMIT 1`,
      [subjectCode]
    ));
  }
  if (rows.length === 0) return null;
  const r = rows[0];
  const ratio = r.score_ratio ? String(r.score_ratio).replace(/^'+/, '') : '70:10:20';
  return {
    subjectId: r.subject_id,
    subjectCode: r.subject_code,
    className: r.class_name,
    term: r.term,
    year: r.year,
    ratio,
    scoreRatio: ratio,
    indicators: r.indicators_json || [],
    examIndicators: r.exam_indicators_json || null,
    teacherId: r.teacher_id || '',
  };
}

async function saveSubjectConfig([configData], user) {
  const c = configData || {};
  await verifyTeacherOwnsSubject(user, c.subjectCode, c.className, c.term, c.year);
  const ratio = c.scoreRatio || c.ratio ||
    (c.formative !== undefined ? `${c.formative}:${c.midterm || 0}:${c.final || 0}` : '70:10:20');
  const effectiveTeacherId = resolveTeacherId(user, c.teacherId);
  await query(
    `INSERT INTO subject_config(subject_id,subject_code,class_name,term,year,score_ratio,indicators_json,teacher_id,exam_indicators_json)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(subject_code,class_name,term,year) DO UPDATE SET
       subject_id=$1, score_ratio=$6, indicators_json=$7, teacher_id=$8, exam_indicators_json=$9`,
    [
      c.subjectId || `${c.subjectCode}_${c.className}_${c.term}_${c.year}`,
      c.subjectCode, c.className, c.term, c.year,
      ratio,
      JSON.stringify(c.indicators || []),
      effectiveTeacherId,
      c.examIndicators ? JSON.stringify(c.examIndicators) : null,
    ]
  );
  return { status: 'success', message: 'บันทึกโครงสร้างวิชาสำเร็จ' };
}

function normID(id) {
  const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '');
  return clean || '0';
}

async function getAllInOneScoreGridData([subjectCode, className, term, year], user) {
  await verifyTeacherOwnsSubject(user, subjectCode, className, term, year);
  const isClub = String(subjectCode || '').startsWith('CLUB');
  const students = isClub
    ? await require('./students').getStudentsByClub([subjectCode])
    : await require('./students').getStudentsByClass([className, null]);

  let configObj = await getSubjectConfig([subjectCode, className, term, year]);
  if (!configObj) configObj = { ratio: '70:10:20', indicators: [], examIndicators: null };

  const scoresRes = await query(
    `SELECT student_id, indicator_id, score
     FROM score_database WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [subjectCode, term, year]
  );
  const existingScores = {};
  for (const r of scoresRes.rows) {
    const sid = normID(r.student_id);
    const iid = String(r.indicator_id || '').toLowerCase().trim();
    const val = String(r.score ?? '').trim();
    if (iid === 'remark') {
      if (val === 'ร' || val === 'มส') existingScores[`${sid}_remark`] = val;
      else if (!existingScores[`${sid}_remark`]) existingScores[`${sid}_remark`] = '-';
    } else {
      existingScores[`${sid}_${iid}`] = val;
    }
  }

  const qualRes = await query(
    `SELECT student_id,
            char1, char2, char3, char4, char_total, char_grade,
            read1, read2, read3, read4, read_total, read_grade, comp
     FROM qualitative_assess WHERE subject_code=$1 AND term=$2 AND year=$3`,
    [subjectCode, term, year]
  );
  const existingQuals = {};
  for (const r of qualRes.rows) {
    existingQuals[normID(r.student_id)] = {
      char1: r.char1 || '', char2: r.char2 || '', char3: r.char3 || '', char4: r.char4 || '',
      charTotal: r.char_total || 0, charGrade: r.char_grade || 0,
      read1: r.read1 || '', read2: r.read2 || '', read3: r.read3 || '', read4: r.read4 || '',
      readTotal: r.read_total || 0, readGrade: r.read_grade || 0,
      comp: r.comp || 3,
    };
  }

  const { getSemesterReport } = require('./attendanceReport');
  let attStats = {}, attDetails = {}, attSessions = [];
  try {
    const attReport = await getSemesterReport([subjectCode, className, term, year]);
    attSessions = (attReport.meta && attReport.meta.sessionsList) || [];
    for (const s of attReport.students || []) {
      const nid = normID(s.id);
      attStats[nid] = s.percent;
      attDetails[nid] = { present: s.present, late: s.late, leave: s.leave, absent: s.absent, records: s.records || {} };
    }
  } catch (_) { /* attendance optional — don't fail the whole request */ }

  return {
    config: configObj,
    students,
    existingScores,
    existingQuals,
    attStats,
    attDetails,
    attSessions,
  };
}

async function _writeScoreRows(scoreRows, subjectCode, term, year, auditTeacherId) {
  const filtered = scoreRows.filter(r => r.score !== null && r.score !== undefined && r.score !== '');
  if (!filtered.length) return;

  const uids          = filtered.map(r => `${r.studentId}_${subjectCode}_${r.indicatorId}_${term}_${year}`);
  const studentIds    = filtered.map(r => r.studentId);
  const indicatorIds  = filtered.map(r => r.indicatorId);
  const scores        = filtered.map(r => String(r.score));

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO score_database(uid,student_id,subject_code,indicator_id,score,term,year)
       SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
         AS v(uid,student_id,subject_code,indicator_id,score,term,year)
       ON CONFLICT(student_id,subject_code,indicator_id,term,year) DO UPDATE
         SET score=EXCLUDED.score, uid=EXCLUDED.uid`,
      [uids, studentIds,
       Array(filtered.length).fill(subjectCode),
       indicatorIds, scores,
       Array(filtered.length).fill(term),
       Array(filtered.length).fill(year)]
    );
    await client.query(
      `INSERT INTO score_history(teacher_id,student_id,subject_code,indicator_id,new_score,term,year)
       SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
         AS v(teacher_id,student_id,subject_code,indicator_id,new_score,term,year)`,
      [Array(filtered.length).fill(auditTeacherId),
       studentIds,
       Array(filtered.length).fill(subjectCode),
       indicatorIds, scores,
       Array(filtered.length).fill(term),
       Array(filtered.length).fill(year)]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function saveAllInOneScores([scoreRows, subjectCode, term, year], user) {
  if (!Array.isArray(scoreRows) || scoreRows.length === 0) return { status: 'success', message: 'ไม่มีคะแนนที่ต้องบันทึก' };
  await verifyTeacherOwnsSubject(user, subjectCode, null, term, year);
  await _writeScoreRows(scoreRows, subjectCode, term, year, String(user?.id || ''));
  return { status: 'success', message: `บันทึกสำเร็จ ${scoreRows.length} รายการ` };
}

// Frontend sends: { subjectCode, className, teacherId, term, year,
//   newConfig: { formative, midterm, final, indicators },
//   scoreRecords: [{studentId, indicatorId, score, ...}],
//   qualRecords:  [{studentId, char1-4, charTotal, char(=grade), read1-4, readTotal, read(=grade)}],
//   gradeRecords: [...] }
async function saveAllInOneWithConfig([payload], user) {
  const p = payload || {};
  const { subjectCode, className, term, year, newConfig, scoreRecords, qualRecords } = p;

  await verifyTeacherOwnsSubject(user, subjectCode, className, term, year);
  const effectiveTeacherId = resolveTeacherId(user, p.teacherId);

  if (newConfig) {
    const ratio = `${newConfig.formative || 70}:${newConfig.midterm || 10}:${newConfig.final || 20}`;
    await query(
      `INSERT INTO subject_config(subject_id,subject_code,class_name,term,year,score_ratio,indicators_json,teacher_id,exam_indicators_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(subject_code,class_name,term,year) DO UPDATE SET
         score_ratio=$6, indicators_json=$7, teacher_id=$8`,
      [
        `${subjectCode}_${className}_${term}_${year}`,
        subjectCode, className, term, year,
        ratio,
        JSON.stringify(newConfig.indicators || []),
        effectiveTeacherId,
        newConfig.examIndicators ? JSON.stringify(newConfig.examIndicators) : null,
      ]
    );
  }

  if (Array.isArray(scoreRecords) && scoreRecords.length > 0) {
    await _writeScoreRows(scoreRecords, subjectCode, term, year, String(user?.id || ''));
  }

  if (Array.isArray(qualRecords) && qualRecords.length > 0) {
    const { pool } = require('../lib/db');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const r of qualRecords) {
        await client.query(
          `INSERT INTO qualitative_assess(
             student_id, subject_code, term, year,
             char1, char2, char3, char4, char_total, char_grade,
             read1, read2, read3, read4, read_total, read_grade, comp
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT(student_id,subject_code,term,year) DO UPDATE SET
             char1=$5, char2=$6, char3=$7, char4=$8, char_total=$9, char_grade=$10,
             read1=$11, read2=$12, read3=$13, read4=$14, read_total=$15, read_grade=$16, comp=$17`,
          [
            r.studentId, r.subjectCode || subjectCode, r.term || term, r.year || year,
            r.char1 || '', r.char2 || '', r.char3 || '', r.char4 || '',
            parseInt(r.charTotal) || 0, parseInt(r.char) || 0,
            r.read1 || '', r.read2 || '', r.read3 || '', r.read4 || '',
            parseInt(r.readTotal) || 0, parseInt(r.read) || 0,
            parseInt(r.comp) || 3,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return { status: 'success', message: 'บันทึกสำเร็จ' };
}

module.exports = {
  getSubjectConfig,
  saveSubjectConfig,
  getAllInOneScoreGridData,
  saveAllInOneScores,
  saveAllInOneWithConfig,
};
