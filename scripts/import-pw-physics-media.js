#!/usr/bin/env node
'use strict';

// Explicit one-school content import; never run as a migration or during boot.
const BASE = 'https://pw.pssms.app/teaching-media/';
const LESSONS = [
  { slug: 'equilibrium', title: 'สมดุลกล — สื่อโต้ตอบ', desc: 'ทดลองแรง สมดุล และโมเมนต์ด้วยภาพจำลอง พร้อมตัวอย่างในชีวิตประจำวัน' },
  { slug: 'sound', title: 'เสียง — สื่อโต้ตอบ', desc: 'ทดลองสมบัติของเสียง การแทรกสอด บีต และดอปเพลอร์ พร้อมแบบทดสอบ' },
  { slug: 'electromagnetic-waves', title: 'คลื่นแม่เหล็กไฟฟ้า — สื่อโต้ตอบ', desc: 'สนามไฟฟ้าและสนามแม่เหล็กสามมิติ สเปกตรัม เสาอากาศ และการส่งสัญญาณ' },
];

async function importMedia({ query, saveMediaCard }, apply = false) {
  const { rows: settings } = await query(
    `SELECT key, subkey, value1 FROM system_settings
     WHERE key IN ('schoolName','school_name','instance')`
  );
  if (settings.some(r => r.key === 'instance' && r.subkey === '' && r.value1 === 'demo')) {
    throw new Error('ปฏิเสธการเพิ่มสื่อโรงเรียนจริงลงฐานข้อมูลเดโม');
  }
  const names = settings.filter(r => ['schoolName', 'school_name'].includes(r.key))
    .map(r => String(r.value1 || '').replace(/\s/g, '').replace(/^โรงเรียน/, ''));
  if (!names.length || names.some(name => name !== 'ภูพระบาทวิทยา')) {
    throw new Error('ฐานข้อมูลนี้ไม่ใช่โรงเรียนภูพระบาทวิทยา');
  }
  const { rows: users } = await query(`SELECT username, role FROM users WHERE username=$1`, ['teacher12']);
  if (users.length !== 1 || String(users[0].role).toUpperCase() !== 'TEACHER') {
    throw new Error('ไม่พบบัญชีครู teacher12 ที่ถูกต้อง');
  }
  const result = [];
  for (const lesson of LESSONS) {
    const url = BASE + lesson.slug;
    // Include deleted cards: a teacher's deletion must not be undone by rerunning import.
    const { rows } = await query(`SELECT id, deleted_at FROM media_cards WHERE created_by=$1 AND url=$2`, ['teacher12', url]);
    if (rows.length) {
      result.push({ slug: lesson.slug, status: 'exists', id: rows[0].id });
      continue;
    }
    if (!apply) {
      result.push({ slug: lesson.slug, status: 'would-create' });
      continue;
    }
    const saved = await saveMediaCard([{
      title: lesson.title, desc: lesson.desc, url, cardType: 'link',
      group: 'วิทยาศาสตร์และเทคโนโลยี', icon: 'fa-atom', color: '#1565c0',
      meta: 'ฟิสิกส์ • สื่อโต้ตอบ', visibleLevels: [], isFeatured: false,
    }], { id: 'teacher12', role: 'Teacher' });
    result.push({ slug: lesson.slug, status: 'created', id: saved.id });
  }
  return result;
}

if (require.main === module) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) {
    console.error('ใช้: node scripts/import-pw-physics-media.js [--apply]');
    process.exitCode = 1;
  } else {
    const { query, pool } = require('../lib/db');
    const { saveMediaCard } = require('../functions/mediaCards');
    // Serialize this one-off importer across terminals without changing the schema.
    async function run() {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [8_151_029]);
        return await importMedia({ query, saveMediaCard }, process.argv.includes('--apply'));
      } finally {
        try { await client.query('SELECT pg_advisory_unlock($1)', [8_151_029]); }
        finally { client.release(); }
      }
    }
    run()
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(err => { console.error(err.message); process.exitCode = 1; })
      .finally(() => pool.end());
  }
}

module.exports = { importMedia };
