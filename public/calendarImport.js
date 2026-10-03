(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CalendarImport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dayNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    var timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return NaN;
    return timestamp / 86400000;
  }

  // CSV and preview use inclusive end dates; storage uses FullCalendar's exclusive end.
  function mergeConsecutiveEvents(rows) {
    var groups = new Map();
    var result = [];
    rows.forEach(function (row) {
      if (!row.title || !row.start) return;
      var event = Object.assign({}, row, {
        end: row.end || row.start,
        color: row.color || '#0d6efd',
        description: row.description || ''
      });
      var start = dayNumber(event.start);
      var end = dayNumber(event.end);
      // Leave invalid dates unchanged so server validation still rejects them.
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        result.push(event);
        return;
      }
      var key = JSON.stringify([event.title, event.description, event.color]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ event: event, start: start, end: end });
    });
    groups.forEach(function (events) {
      events.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
      var current;
      events.forEach(function (item) {
        if (current && item.start <= current.end + 1) {
          if (item.end > current.end) {
            current.end = item.end;
            current.event.end = item.event.end;
          }
        } else {
          current = item;
          result.push(current.event);
        }
      });
    });
    return result.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
  }

  function toExclusiveEnd(value) {
    var day = dayNumber(value);
    return Number.isFinite(day) ? new Date((day + 1) * 86400000).toISOString().slice(0, 10) : value;
  }

  return { mergeConsecutiveEvents: mergeConsecutiveEvents, toExclusiveEnd: toExclusiveEnd };
});
