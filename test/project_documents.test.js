'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop, token } = require('./helpers/api');
const { query } = require('../lib/db');

after(async () => { await query("DELETE FROM project_documents WHERE title LIKE 'โครงการทดสอบ%'"); await stop(); });

test('คลังเอกสารโรงเรียนดูร่วมกันได้ แต่ครูแก้ได้เฉพาะของตัวเองและ Admin แก้ได้', async () => {
  const created = await ok('saveProjectDocument', [{ title: 'โครงการทดสอบสิทธิ์', description: 'รายละเอียด' }], 'teacher1');
  assert.ok(created.id);
  const list = await ok('getProjectDocuments', [], 'teacher2');
  const row = list.find(p => p.id === created.id);
  assert.ok(row, 'ครูคนอื่นต้องเห็นเอกสารในคลังร่วมกัน');
  assert.equal(row.mine, false, 'ครูคนอื่นต้องไม่มีสิทธิ์แก้');
  await assert.rejects(() => ok('saveProjectDocument', [{ id: created.id, title: 'แก้ไม่ได้' }], 'teacher2'), /เฉพาะเอกสารของคุณ/);
  await ok('saveProjectDocument', [{ id: created.id, title: 'Admin แก้ได้' }], 'admin');
  const { rows } = await query('SELECT title FROM project_documents WHERE id=$1', [created.id]);
  assert.equal(rows[0].title, 'Admin แก้ได้');
});

test('นักเรียนเปิดคลังเอกสารโรงเรียนไม่ได้', async () => {
  await denied('getProjectDocuments', [], token({ id: '02001', role: 'Student' }));
});
