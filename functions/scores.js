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

  // Auto-add new indicators to curriculum library (skip duplicates and empty codes)
  const newIndicators = (c.indicators || []).filter(ind => String(ind.code || '').trim());
  if (newIndicators.length > 0) {
    for (const ind of newIndicators) {
      await query(
        `INSERT INTO curriculum(subject_code, subject_type, standard_code, description, eval_type)
         VALUES($1, '', $2, $3, '')
         ON CONFLICT(subject_code, standard_code) DO NOTHING`,
        [c.subjectCode, String(ind.code).trim(), String(ind.description || '').trim()]
      );
    }
  }

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
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
  const filtered = scoreRows.filter(r => !isBlank(r.score));
  // ช่องที่ครูล้างค่าต้อง "ลบแถว" ไม่ใช่ข้าม — เดิมกรองทิ้งเฉย ๆ ทำให้ค่าเก่าค้างใน DB
  // ครูเห็นช่องว่างบนจอ แต่ refresh แล้วคะแนนเดิมกลับมา
  const cleared = scoreRows.filter(r => isBlank(r.score));
  if (!filtered.length && !cleared.length) return;

  const uids          = filtered.map(r => `${r.studentId}_${subjectCode}_${r.indicatorId}_${term}_${year}`);
  const studentIds    = filtered.map(r => r.studentId);
  const indicatorIds  = filtered.map(r => r.indicatorId);
  const scores        = filtered.map(r => String(r.score));

  const { pool } = require('../lib/db');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (filtered.length) {
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
    }

    if (cleared.length) {
      const { rowCount } = await client.query(
        `DELETE FROM score_database
          WHERE subject_code=$1 AND term=$2 AND year=$3
            AND (student_id, indicator_id) IN (
              SELECT * FROM unnest($4::text[], $5::text[])
            )`,
        [subjectCode, String(term), String(year),
         cleared.map(r => String(r.studentId)),
         cleared.map(r => String(r.indicatorId))]
      );
      // บันทึกการล้างค่าไว้ใน audit log เฉพาะเมื่อมีแถวถูกลบจริง
      if (rowCount > 0) {
        await client.query(
          `INSERT INTO score_history(teacher_id,student_id,subject_code,indicator_id,new_score,term,year)
           SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::text[])
             AS v(teacher_id,student_id,subject_code,indicator_id,new_score,term,year)`,
          [Array(cleared.length).fill(auditTeacherId),
           cleared.map(r => String(r.studentId)),
           Array(cleared.length).fill(subjectCode),
           cleared.map(r => String(r.indicatorId)),
           Array(cleared.length).fill(''),
           Array(cleared.length).fill(String(term)),
           Array(cleared.length).fill(String(year))]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// True if a student's assessment is done: explicit remark ('ร'/'มส') always counts
// (means "work missing" by definition), otherwise every formative indicator plus
// midterm/final (only when the ratio actually uses them) must have a real score.
// Without this gate, autosave (3s after any single-cell edit) would persist
// grade=0 for every ungraded student the instant a teacher touches one cell.
function _isGradeRowComplete(studentId, scoreRecords, formativeCount, midtermRatio, finalRatio) {
  const rows = (scoreRecords || []).filter(r => String(r.studentId).trim() === String(studentId).trim());
  const has = (id) => rows.some(r => r.indicatorId === id && r.score !== '' && r.score !== null && r.score !== undefined);
  const remarkRow = rows.find(r => r.indicatorId === 'remark');
  const remarkVal = remarkRow ? String(remarkRow.score || '').trim() : '';
  if (remarkVal === 'ร' || remarkVal === 'มส') return true;
  for (let i = 0; i < formativeCount; i++) {
    if (!has(`formative_${i}`)) return false;
  }
  if (midtermRatio > 0 && !has('midterm')) return false;
  if (finalRatio > 0 && !has('final')) return false;
  return true;
}

// Persists the per-student grade roll-up that the ปพ.5 grid already computed
// client-side (calcRow / calculateGrade in Scripts_Score.html).
// `grade` already carries the remark ('ร' / 'มส') when one is set — see calcRow.
// Caller must pre-filter to complete rows only — see _isGradeRowComplete.
async function _writeGradeRows(gradeRows, subjectCode, term, year) {
  const filtered = (gradeRows || []).filter(r => r && r.studentId !== undefined && r.studentId !== null && String(r.studentId).trim() !== '');
  if (!filtered.length) return 0;

  const n = filtered.length;
  const toNum = (v) => { const x = parseFloat(v); return isNaN(x) ? null : x; };
  const toStr = (v) => String(v === undefined || v === null ? '' : v).trim();

  await query(
    `INSERT INTO grade_summary(student_id,subject_code,total_score,grade,remedial_status,term,year)
     SELECT * FROM unnest($1::text[],$2::text[],$3::numeric[],$4::text[],$5::text[],$6::text[],$7::text[])
       AS v(student_id,subject_code,total_score,grade,remedial_status,term,year)
     ON CONFLICT(student_id,subject_code,term,year) DO UPDATE
       SET total_score=EXCLUDED.total_score,
           grade=EXCLUDED.grade,
           remedial_status=EXCLUDED.remedial_status`,
    [
      filtered.map(r => toStr(r.studentId)),
      Array(n).fill(subjectCode),
      filtered.map(r => toNum(r.totalScore)),
      filtered.map(r => toStr(r.grade)),
      filtered.map(r => toStr(r.remark)),
      Array(n).fill(term),
      Array(n).fill(year),
    ]
  );
  return n;
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
  const { subjectCode, className, term, year, newConfig, scoreRecords, qualRecords, gradeRecords } = p;

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

  if (Array.isArray(gradeRecords) && gradeRecords.length > 0) {
    const formativeCount = (newConfig && Array.isArray(newConfig.indicators)) ? newConfig.indicators.length : 0;
    const midtermRatio = newConfig ? (parseFloat(newConfig.midterm) || 0) : 0;
    const finalRatio = newConfig ? (parseFloat(newConfig.final) || 0) : 0;
    const completeRecords = [], incompleteIds = [];
    for (const r of gradeRecords) {
      if (_isGradeRowComplete(r.studentId, scoreRecords, formativeCount, midtermRatio, finalRatio)) completeRecords.push(r);
      else incompleteIds.push(String(r.studentId).trim());
    }
    if (completeRecords.length > 0) {
      await _writeGradeRows(completeRecords, subjectCode, term, year);
    }
    // A student whose grade is no longer determinable must not keep an old row:
    // clearing a ร/มส remark used to leave the stale grade behind forever, so the
    // risk card kept reporting a student the teacher had already un-flagged.
    if (incompleteIds.length > 0) {
      await query(
        `DELETE FROM grade_summary
          WHERE subject_code=$1 AND term=$2 AND year=$3 AND student_id = ANY($4)`,
        [subjectCode, String(term), String(year), incompleteIds]
      );
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
