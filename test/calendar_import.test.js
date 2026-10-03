'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeConsecutiveEvents, toExclusiveEnd } = require('../public/calendarImport');
const row = (start, extra = {}) => ({ title: 'กิจกรรม', start, ...extra });

test('daily activities merge independently of ordering and retain gaps', () => {
  const input = [row('2027-01-02'), row('2026-12-31'), row('2027-01-05'), row('2027-01-01')];
  const before = JSON.stringify(input);
  assert.deepEqual(mergeConsecutiveEvents(input).map(e => [e.start, e.end]), [
    ['2026-12-31', '2027-01-02'], ['2027-01-05', '2027-01-05']
  ]);
  assert.equal(JSON.stringify(input), before);
});

test('title, description and effective color must all match', () => {
  const merged = mergeConsecutiveEvents([
    row('2026-11-01'), row('2026-11-02', { color: '#0d6efd', description: '' }),
    row('2026-11-03', { description: 'ต่าง' }),
    row('2026-11-04', { color: '#dc3545' }),
    row('2026-11-05', { title: 'กิจกรรมอื่น' })
  ]);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].end, '2026-11-02');
});

test('duplicates and overlapping existing ranges form one inclusive range', () => {
  const merged = mergeConsecutiveEvents([
    row('2026-11-03', { end: '2026-11-06' }),
    row('2026-11-01', { end: '2026-11-04' }),
    row('2026-11-03'), row('2026-11-07')
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual([merged[0].start, merged[0].end], ['2026-11-01', '2026-11-07']);
  assert.deepEqual(mergeConsecutiveEvents(merged), merged);
});

test('date arithmetic handles leap days and exclusive final day independently of timezone', () => {
  assert.equal(mergeConsecutiveEvents([row('2028-02-28'), row('2028-02-29'), row('2028-03-01')])[0].end, '2028-03-01');
  assert.equal(toExclusiveEnd('2028-02-29'), '2028-03-01');
  assert.equal(toExclusiveEnd('2026-12-31'), '2027-01-01');
  assert.equal(toExclusiveEnd('2026-11-01'), '2026-11-02');
});

test('invalid dates cannot join ranges or bypass downstream validation', () => {
  const merged = mergeConsecutiveEvents([row('2026-02-28'), row('2026-02-30'), row('2026-03-01')]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(e => e.start === '2026-02-30').end, '2026-02-30');
  assert.equal(toExclusiveEnd('2026-02-30'), '2026-02-30');
});
