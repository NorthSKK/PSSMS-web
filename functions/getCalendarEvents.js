const { query } = require('../lib/db');
const cache = require('../lib/cache');

const PERSONAL_COLOR = '#6f42c1';

async function getAllCalendarEvents() {
  const cached = cache.get('calendar_events_all');
  if (cached) return cached;

  const { rows } = await query(
    `SELECT id, title,
            to_char(start_date, 'YYYY-MM-DD') as start,
            to_char(end_date,   'YYYY-MM-DD') as end,
            color, description, created_by
     FROM calendar_events ORDER BY start_date`
  );

  const events = rows.map(r => ({
    id:              r.id || '',
    title:           r.title || '',
    start:           r.start || '',
    end:             r.end || r.start || '',
    color:           r.color || '#3b82f6',
    backgroundColor: r.color || '#3b82f6',
    description:     r.description || '',
    createdBy:       r.created_by || '',
  }));

  cache.set('calendar_events_all', events, 300);
  return events;
}

// teacherId = null/undefined → admin, return all
// teacherId = string → filter out personal events not owned by this teacher
module.exports = async function getCalendarEvents(teacherId) {
  const events = await getAllCalendarEvents();
  if (!teacherId) return events;
  return events.filter(e =>
    e.backgroundColor !== PERSONAL_COLOR ||
    String(e.createdBy || '') === String(teacherId)
  );
};
