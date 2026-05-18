const { query } = require('../lib/db');
const cache = require('../lib/cache');

module.exports = async function getCalendarEvents() {
  const cached = cache.get('calendar_events');
  if (cached) return cached;

  const { rows } = await query(
    `SELECT id, title,
            to_char(start_date, 'YYYY-MM-DD') as start,
            to_char(end_date,   'YYYY-MM-DD') as end,
            color, description
     FROM calendar_events ORDER BY start_date`
  );

  const events = rows.map(r => ({
    id:          r.id || '',
    title:       r.title || '',
    start:       r.start || '',
    end:         r.end || r.start || '',
    color:           r.color || '#3b82f6',
    backgroundColor: r.color || '#3b82f6',
    description: r.description || '',
  }));

  cache.set('calendar_events', events, 300);
  return events;
};
