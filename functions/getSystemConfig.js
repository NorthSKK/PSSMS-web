const { query } = require('../lib/db');
const cache = require('../lib/cache');

module.exports = async function getSystemConfig() {
  const cached = cache.get('system_config');
  if (cached) return cached;

  const { rows } = await query('SELECT key, subkey, value1, value2 FROM system_settings');
  // ⚠️ schoolName ว่างเป็นค่าเริ่มต้นโดยตั้งใจ — ห้ามใส่ชื่อโรงเรียนใดเป็น default
  // 1 โรงเรียน = 1 DB ค่า default จึงเป็นชื่อโรงเรียนอื่นเสมอสำหรับทุกคนที่ไม่ใช่เจ้าของชื่อนั้น
  // ชื่อว่างทำให้เห็นว่ายังไม่ได้ตั้ง ส่วนชื่อผิดกลมกลืนจนไม่มีใครสังเกต (เคยหลุดถึง ปพ.5)
  const config = {
    term: '1', year: '2568',
    schoolName: '',
    schoolLogo: '', termStart: '', termEnd: '',
  };

  for (const r of rows) {
    if (r.key === 'Active' && r.subkey === 'Term') {
      config.term = r.value1 || '1';
      config.year = r.value2 || '2568';
    }
    if (r.key === 'schoolName' || r.key === 'school_name') config.schoolName = r.value1 || config.schoolName;
    if (r.key === 'schoolLogo' || r.key === 'school_logo') config.schoolLogo = r.value1 || '';
  }

  for (const r of rows) {
    if (r.key === 'TermData' && r.subkey === `${config.term}_${config.year}`) {
      config.termStart = r.value1 || '';
      config.termEnd = r.value2 || '';
    }
  }

  cache.set('system_config', config, 300);
  return config;
};
