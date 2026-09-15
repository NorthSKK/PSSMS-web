'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ok, denied, stop, TOKENS, baseURL } = require('./helpers/api');
const { query } = require('../lib/db');
const storage = require('../lib/storage');

after(async () => { await query("DELETE FROM professional_development_activities WHERE title LIKE 'อบรมทดสอบ%'"); await stop(); });

const PDF = Buffer.from('%PDF-1.4\nprofessional development proof\n%%EOF', 'utf8');

async function uploadProof(activityId, filename) {
  const boundary = '----pssms-pd-' + Date.now() + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'),
    PDF,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const base = await baseURL();
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/media/professional-development/${activityId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKENS.teacher1}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: JSON.parse(raw) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('ตัวเลือกหลักฐานบอกสถานะ storage และ allowlist ชุดเดียวกับจุดอัปโหลด', async () => {
  const options = await ok('getProfessionalDevelopmentOptions', [], 'teacher1');
  assert.equal(options.uploadEnabled, true);
  assert.equal(options.uploadDisabledReason, '');
  assert.equal(options.maxUploadMB, 25);
  assert.equal(options.maxFilesPerActivity, 20);
  assert.deepEqual(options.allowedExts, ['pdf', 'jpg', 'png', 'webp', 'docx']);
  assert.match(options.allowedLabel, /PDF/);
});

test('ไม่รับไฟล์เมื่อ storage ไม่ได้ตั้งค่า และส่งเหตุผลชุดเดียวให้หน้าเว็บ', async t => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบ storage ปิด', type: 'อบรม', startsAt: '2026-09-14T09:00', status: 'ร่าง',
  }], 'teacher1');
  t.mock.method(storage, 'isConfigured', () => false);

  const options = await ok('getProfessionalDevelopmentOptions', [], 'teacher1');
  assert.equal(options.uploadEnabled, false);
  assert.match(options.uploadDisabledReason, /ยังไม่เปิดให้อัปโหลดไฟล์/);

  const uploaded = await uploadProof(created.id, 'หลักฐาน.pdf');
  assert.equal(uploaded.status, 503);
  assert.equal(uploaded.body.__error, options.uploadDisabledReason);
  const activity = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(activity.attachments.length, 0);
});

test('กิจกรรมสถานะร่างแนบหลักฐานหลายไฟล์ที่มีชื่อไทยและเว้นวรรคได้', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบแนบหลายไฟล์', type: 'อบรม', startsAt: '2026-09-14T09:00', status: 'ร่าง',
  }], 'teacher1');
  const names = ['11คลื่นกล 5.pdf', 'หลักฐาน ใบที่ 2.pdf'];
  for (const name of names) {
    const uploaded = await uploadProof(created.id, name);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.__result.status, 'success');
  }
  const activity = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(activity.status, 'ร่าง');
  assert.deepEqual(activity.attachments.map(file => file.name), names);
});

test('พัฒนาวิชาชีพเป็นข้อมูลส่วนตัวครูและ snapshot ผู้ร่วมกิจกรรม', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบสิทธิ์', type: 'อบรม', startsAt: '2026-09-14T09:00:00+07:00',
    endsAt: '2026-09-14T16:00:00+07:00', participants: [
      { kind: 'teacher', referenceId: 'teacher2', role: 'วิทยากร' },
      { kind: 'student', referenceId: '01901' }, { kind: 'external', label: 'นายภายนอก' },
    ],
  }], 'teacher1');
  const mine = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(mine.participants.length, 3);
  assert.match(await denied('getProfessionalDevelopmentActivity', [created.id], 'teacher2'), /ไม่พบกิจกรรม/);
  assert.match(await denied('getProfessionalDevelopmentActivities', [], 'admin'), /เฉพาะครู/);
});

test('ถังขยะและ ICS อยู่ในขอบเขตเจ้าของ', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{ title: 'อบรมทดสอบ ICS', type: 'สัมมนา', startsAt: '2026-09-14T09:00:00+07:00' }], 'teacher1');
  const exported = await ok('getProfessionalDevelopmentExport', [created.id], 'teacher1');
  assert.match(exported.ics, /BEGIN:VCALENDAR/);
  await ok('deleteProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.ok((await ok('getDeletedProfessionalDevelopmentActivities', [], 'teacher1')).some(x => x.id === created.id));
  await ok('restoreProfessionalDevelopmentActivity', [created.id], 'teacher1');
});

test('datetime-local ที่ไม่มี timezone ถูกตีความเป็นเวลาไทยเสมอ', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบเวลาไทย', type: 'อบรม', startsAt: '2026-09-14T09:00',
  }], 'teacher1');
  const activity = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(new Date(activity.startsAt).toISOString(), '2026-09-14T02:00:00.000Z');
});

test('คำนวณจำนวนชั่วโมงจากช่วงเวลาเมื่อเว้นว่าง และเก็บค่าที่ครูกรอกเองเพื่อหักเวลาพัก', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบคำนวณชั่วโมง', type: 'อบรม', startsAt: '2026-09-14T09:00',
    endsAt: '2026-09-14T09:35:00Z', hours: '',
  }], 'teacher1');
  const calculated = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(calculated.hours, 7.58);

  await ok('saveProfessionalDevelopmentActivity', [{
    id: created.id, title: calculated.title, type: calculated.type,
    startsAt: calculated.startsAt, endsAt: calculated.endsAt, hours: 6.5,
  }], 'teacher1');
  const overridden = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(overridden.hours, 6.5);
});

test('แก้กิจกรรมและผู้ร่วมเป็น atomic เมื่อผู้ร่วมไม่ถูกต้อง', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบ atomic', type: 'อบรม', startsAt: '2026-09-14T09:00',
    participants: [{ kind: 'external', label: 'ผู้ร่วมเดิม' }],
  }], 'teacher1');
  await denied('saveProfessionalDevelopmentActivity', [{
    id: created.id, title: 'ชื่อที่ห้ามติด', type: 'อบรม', startsAt: '2026-09-14T10:00',
    participants: [{ kind: 'student', referenceId: 'student-does-not-exist' }],
  }], 'teacher1');
  const unchanged = await ok('getProfessionalDevelopmentActivity', [created.id], 'teacher1');
  assert.equal(unchanged.title, 'อบรมทดสอบ atomic');
  assert.deepEqual(unchanged.participants.map(p => p.label), ['ผู้ร่วมเดิม']);
});

test('รายการกิจกรรมมียอดผู้ร่วม/ไฟล์ และ selector ได้ห้องนักเรียนที่ใช้งานอยู่', async () => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบตัวนับ', type: 'สัมมนา', startsAt: '2026-09-14T09:00',
    participants: [{ kind: 'student', referenceId: '01901' }],
  }], 'teacher1');
  const card = (await ok('getProfessionalDevelopmentActivities', [], 'teacher1')).find(x => x.id === created.id);
  assert.equal(card.participantCount, 1);
  assert.equal(card.attachmentCount, 0);
  const people = await ok('getProfessionalDevelopmentPeople', [[]], 'teacher1');
  assert.ok(people.classes.includes('ม.6/1'));
  assert.ok(people.classes.includes('ม.2/1'));
});

test('เตือนหลังกิจกรรมเฉพาะรายการที่ยังต้องติดตาม', async () => {
  const make = (title, status, details) => ok('saveProfessionalDevelopmentActivity', [{
    title, type: 'อบรม', startsAt: '2020-01-01T23:30', status, details,
  }], 'teacher1');
  const draft = await make('อบรมทดสอบเตือนร่าง', 'ร่าง', '');
  const incomplete = await make('อบรมทดสอบเตือนขาดผล', 'เสร็จสิ้น', '');
  const complete = await make('อบรมทดสอบเตือนครบ', 'เสร็จสิ้น', 'สรุปผลแล้ว');
  const cancelled = await make('อบรมทดสอบเตือนยกเลิก', 'ยกเลิก', '');
  const ids = new Set((await ok('getProfessionalDevelopmentNotifications', [], 'teacher1')).map(n => n.activityId));
  assert.equal(ids.has(draft.id), true);
  assert.equal(ids.has(incomplete.id), true);
  assert.equal(ids.has(complete.id), false);
  assert.equal(ids.has(cancelled.id), false);
});

test('ล้างถังขยะเก็บแถว DB ไว้ลองใหม่ถ้าลบ storage ล้ม และห้ามกู้คืนเกิน 30 วัน', async t => {
  const created = await ok('saveProfessionalDevelopmentActivity', [{
    title: 'อบรมทดสอบ purge', type: 'อบรม', startsAt: '2020-01-01T09:00',
  }], 'teacher1');
  await query("UPDATE professional_development_activities SET deleted_at=NOW()-INTERVAL '31 days' WHERE id=$1", [created.id]);
  await query(`INSERT INTO professional_development_attachments(activity_id,file_key,file_name,file_size)
    VALUES($1,$2,'proof.pdf',10)`, [created.id, 'a'.repeat(32) + '.pdf']);
  t.mock.method(storage, 'remove', async () => { throw new Error('ที่เก็บไฟล์ล้ม'); });
  await ok('getDeletedProfessionalDevelopmentActivities', [], 'teacher1');
  assert.equal((await query('SELECT count(*)::int n FROM professional_development_activities WHERE id=$1', [created.id])).rows[0].n, 1);
  assert.match(await denied('restoreProfessionalDevelopmentActivity', [created.id], 'teacher1'), /30 วัน/);
});
