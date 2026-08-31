'use strict';
/**
 * License clock for a school deployment.
 *
 * One school = one deployment = one database, so the licence lives in that
 * school's own `system_settings` and is set once at handover:
 *
 *   node scripts/set-license.js 2026-10-31
 *
 * This is an honest-broker mechanism, not DRM. A school with database access
 * can always move the date. That is fine — the point is that the expiry is
 * visible and deliberate, not that it is unbreakable.
 *
 * States, from `licenseUntil`:
 *   none    — no licence row at all → unlimited (dev, demo, our own school)
 *   active  — more than 30 days left, nobody sees anything
 *   warn    — 30 days or fewer left, banner shown to Admin only
 *   grace   — past the date but within 14 days, banner shown to everyone,
 *             everything still works
 *   locked  — past the grace period, writes are refused by routes/gas.js
 *
 * ⚠️ Printing ปพ.5 and exports are NEVER blocked in any state. They are official
 *    documents a teacher is required to produce; withholding them would put a
 *    teacher's own compliance at the mercy of a billing dispute.
 */
const { query } = require('./db');
const cache = require('./cache');

const WARN_DAYS = 30;
const GRACE_DAYS = 14;
const CACHE_KEY = 'license_status';
const CACHE_TTL = 60;

const DAY_MS = 86400000;

/** Midnight-anchored day difference, so a licence lasts all of its final day. */
function daysBetween(fromISO, to) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((a - b) / DAY_MS);
}

function classify(until, now = new Date()) {
  if (!until) return { state: 'none', until: null, daysLeft: null };
  const daysLeft = daysBetween(until, now);
  let state;
  if (daysLeft >= 0) state = daysLeft <= WARN_DAYS ? 'warn' : 'active';
  else if (daysLeft >= -GRACE_DAYS) state = 'grace';
  else state = 'locked';
  return { state, until, daysLeft };
}

async function read() {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;
  let until = null;
  try {
    const { rows } = await query(
      `SELECT value1 FROM system_settings WHERE key='license' AND subkey='until'`
    );
    until = (rows[0] && rows[0].value1) || null;
  } catch (e) {
    // A database that cannot answer must not lock the school out mid-lesson.
    console.error('[license] read failed, treating as unlimited:', e.message);
    return classify(null);
  }
  const status = classify(until);
  cache.set(CACHE_KEY, status, CACHE_TTL);
  return status;
}

const isLocked = async () => (await read()).state === 'locked';

function invalidate() { cache.del(CACHE_KEY); }

module.exports = { read, isLocked, classify, invalidate, WARN_DAYS, GRACE_DAYS };
