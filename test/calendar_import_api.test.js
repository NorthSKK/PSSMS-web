'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, stop } = require('./helpers/api');
const { query } = require('../lib/db');
const { _holidayDates } = require('../functions/attendance');

after(stop);

test('calendar CSV import stores merged exclusive ranges and holidays stop at their final day', async () => {
  const title = 'ทดสอบรวมปฏิทินรายวัน';
  try {
    const result = await ok('importCalendarCSV', [[
      { title, start: '2026-11-03', color: '#dc3545' },
      { title, start: '2026-11-01', color: '#dc3545' },
      { title, start: '2026-11-02', color: '#dc3545' },
      { title, start: '2026-11-05', color: '#dc3545' }
    ]], 'admin');
    assert.equal(result.imported, 2);
    const { rows } = await query(`SELECT to_char(start_date,'YYYY-MM-DD') AS start,
      to_char(end_date,'YYYY-MM-DD') AS end FROM calendar_events WHERE title=$1 ORDER BY start_date`, [title]);
    assert.deepEqual(rows, [
      { start: '2026-11-01', end: '2026-11-04' },
      { start: '2026-11-05', end: '2026-11-06' }
    ]);
    const holidays = await _holidayDates(new Date('2026-11-01T00:00:00Z'), new Date('2026-11-06T00:00:00Z'));
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05']) assert.ok(holidays.has(date));
    assert.ok(!holidays.has('2026-11-04'));
    assert.ok(!holidays.has('2026-11-06'));

    await query(`INSERT INTO calendar_events(title,start_date,end_date,color) VALUES($1,'2026-11-07','2026-11-07','#dc3545')`, [title]);
    const legacy = await _holidayDates(new Date('2026-11-07T00:00:00Z'), new Date('2026-11-08T00:00:00Z'));
    assert.ok(legacy.has('2026-11-07'));
    assert.ok(!legacy.has('2026-11-08'));
  } finally {
    await query('DELETE FROM calendar_events WHERE title=$1', [title]);
    require('../lib/cache').del('calendar_events_all');
  }
});
