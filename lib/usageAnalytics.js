'use strict';

const { query } = require('./db');
const { appInfo } = require('./appInfo');
const { schoolDateStr } = require('./schoolDate');

// Adding a write handler elsewhere does not silently start tracking it.
const ATTENDANCE_SAVE_FNS = new Set([
  'saveAttendanceBatch', 'updateAttendanceStatus', 'updateAttendanceBatch',
  'saveMassiveAttendanceGrid', 'saveMorningActivityBatch',
]);
const SCORE_SAVE_FNS = new Set([
  'saveAllInOneScores', 'saveAllInOneWithConfig', 'finalizeGrades',
]);
const TIMETABLE_CHANGE_FNS = new Set([
  'updateTimetableRow', 'deleteTimetableRow', 'importTimetableCSV',
  'swapTimetableTeacher', 'teacherUpdateTimetableRow', 'removeDuplicateTimetableRows',
]);
const COUNTERS = [
  'login_success', 'login_admin', 'login_teacher', 'login_student', 'login_executive',
  'attendance_saved', 'scores_saved', 'timetable_changed',
];
const INGEST_PATH = '/api/analytics/ingest/daily';
const MAX_BACKLOG_DAYS = 400;

let dispatchTimer = null;
let intervalTimer = null;
let dispatching = null;

function counterFor(fnName, result) {
  if (fnName === 'checkLogin') {
    if (!result || result.status !== 'success') return null;
    const role = String(result.role || '').trim().toLowerCase();
    const counter = { login_success: 1 };
    if (['admin', 'teacher', 'student', 'executive'].includes(role)) counter[`login_${role}`] = 1;
    return counter;
  }
  if (ATTENDANCE_SAVE_FNS.has(fnName)) return { attendance_saved: 1 };
  if (SCORE_SAVE_FNS.has(fnName)) return { scores_saved: 1 };
  if (TIMETABLE_CHANGE_FNS.has(fnName)) return { timetable_changed: 1 };
  return null;
}

function ingestConfig() {
  const rawUrl = process.env.PSSMS_ANALYTICS_INGEST_URL || process.env.PSSMS_SUPPORT_INGEST_URL || '';
  const token = String(process.env.PSSMS_ANALYTICS_INGEST_TOKEN || process.env.PSSMS_SUPPORT_INGEST_TOKEN || '').trim();
  const url = String(rawUrl).trim().replace(/\/+$/, '');
  if (!url || !token) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test') return null;
  return { url, token };
}

async function recordSuccessfulCall(fnName, result, now = new Date()) {
  const increments = counterFor(fnName, result);
  if (!increments) return false;
  const values = COUNTERS.map((name) => increments[name] || 0);
  await query(`INSERT INTO usage_analytics_daily
    (activity_date,app_version,last_activity_at,${COUNTERS.join(',')})
    VALUES($1,$2,$3,${COUNTERS.map((_, i) => `$${i + 4}`).join(',')})
    ON CONFLICT(activity_date) DO UPDATE SET
      app_version=EXCLUDED.app_version,
      last_activity_at=GREATEST(usage_analytics_daily.last_activity_at,EXCLUDED.last_activity_at),
      ${COUNTERS.map((name) => `${name}=usage_analytics_daily.${name}+EXCLUDED.${name}`).join(',')},
      updated_at=NOW()`, [schoolDateStr(now), appInfo().version, now.toISOString(), ...values]);
  await query(`DELETE FROM usage_analytics_daily
    WHERE activity_date < ($1::date - INTERVAL '13 months')`, [schoolDateStr(now)]);
  queueDispatch();
  return true;
}

function rowPayload(row) {
  const payload = {
    date: String(row.activity_date).slice(0, 10),
    app_version: String(row.app_version || '').slice(0, 40),
    last_activity_at: new Date(row.last_activity_at).toISOString(),
  };
  for (const name of COUNTERS) payload[name] = Math.max(0, Number(row[name]) || 0);
  return payload;
}

async function sendRow(row, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(config.url + INGEST_PATH, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'X-PSSMS-Analytics-Version': '1',
      },
      body: JSON.stringify(rowPayload(row)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ปลายทางตอบ ${response.status}`);
    // Mark sent only if no counter changed while the request was in flight.
    // Do not compare updated_at: pg converts timestamptz to a JS Date and loses
    // PostgreSQL's microseconds, making an equality check spuriously miss.
    await query(`UPDATE usage_analytics_daily SET last_sent_at=NOW()
      WHERE activity_date=$1 AND ${COUNTERS.map((name, i) => `${name}=$${i + 2}`).join(' AND ')}`,
    [row.activity_date, ...COUNTERS.map((name) => row[name])]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchPending() {
  if (dispatching) return dispatching;
  const config = ingestConfig();
  if (!config) return false;
  dispatching = (async () => {
    const { rows } = await query(`SELECT * FROM usage_analytics_daily
      WHERE last_sent_at IS NULL OR updated_at > last_sent_at
      ORDER BY activity_date DESC LIMIT $1`, [MAX_BACKLOG_DAYS]);
    let sent = 0;
    for (const row of rows.reverse()) {
      try { if (await sendRow(row, config)) sent++; }
      catch (err) {
        console.error('[usage-analytics]', err.name === 'AbortError' ? 'timeout' : err.message);
        break;
      }
    }
    return sent;
  })().catch((err) => {
    console.error('[usage-analytics]', err.message);
    return false;
  }).finally(() => { dispatching = null; });
  return dispatching;
}

function queueDispatch() {
  if (!ingestConfig() || dispatchTimer) return;
  dispatchTimer = setTimeout(() => {
    dispatchTimer = null;
    void dispatchPending();
  }, 1000);
  dispatchTimer.unref?.();
}

function startDispatcher() {
  if (!ingestConfig() || intervalTimer) return;
  queueDispatch();
  intervalTimer = setInterval(() => void dispatchPending(), 15 * 60 * 1000);
  intervalTimer.unref?.();
}

module.exports = {
  ATTENDANCE_SAVE_FNS, SCORE_SAVE_FNS, TIMETABLE_CHANGE_FNS, COUNTERS,
  counterFor, rowPayload, recordSuccessfulCall, dispatchPending, startDispatcher,
};
