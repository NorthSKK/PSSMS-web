const path = require('path');
const fs = require('fs').promises;

const TEMPLATE_PATH = path.join(__dirname, '../src/Template_PP5.html');

function _normID(id) {
  return String(id || '').replace(/[^a-zA-Z0-9]/g, '').replace(/^0+/, '') || '0';
}

function _esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Compile GAS-style template (<? code ?>, <?= expr ?>, <?!= raw ?>) to a JS function.
// HTML segments are emitted via __out; code blocks are executed directly.
function compileTemplate(src) {
  const parts = src.split(/(<\?(?:!=|=)?[\s\S]*?\?>)/);
  let body = 'let __out = "";\n';

  for (const part of parts) {
    if (part.startsWith('<?!=')) {
      const expr = part.slice(4, -2).trim();
      body += `__out += (()=>{ try { const _v = ${expr}; return _v == null ? '' : String(_v); } catch(e){ return ''; } })();\n`;
    } else if (part.startsWith('<?=')) {
      const expr = part.slice(3, -2).trim();
      body += `__out += _esc(${expr});\n`;
    } else if (part.startsWith('<?')) {
      body += part.slice(2, -2) + '\n';
    } else {
      // Raw HTML — escape backticks and template-literal interpolation markers
      const escaped = part
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
      body += `__out += \`${escaped}\`;\n`;
    }
  }

  body += 'return __out;';
  // eslint-disable-next-line no-new-func
  return new Function('data', '_esc', body);
}

let _cached = null;
let _cachedMtime = null;

async function generatePP5Template([payload]) {
  const stat = await fs.stat(TEMPLATE_PATH);
  if (!_cached || stat.mtimeMs !== _cachedMtime) {
    const src = await fs.readFile(TEMPLATE_PATH, 'utf8');
    _cached = compileTemplate(src);
    _cachedMtime = stat.mtimeMs;
  }

  // Fetch fresh attendance data server-side so ปพ.5 always reflects latest saves
  let finalPayload = payload;
  try {
    const { getSemesterReport } = require('./attendanceReport');
    const subCode = payload.subCode;
    const className = payload.className;
    const term = payload.user?.currentTerm;
    const year = payload.user?.currentYear;
    if (subCode && className && term && year) {
      const attReport = await getSemesterReport([subCode, className, term, year]);
      const freshSessions = (attReport.meta && attReport.meta.sessionsList) || [];
      const attMap = {};
      for (const s of attReport.students || []) {
        attMap[_normID(s.id)] = {
          percent: s.percent, present: s.present, late: s.late,
          leave: s.leave, absent: s.absent, records: s.records || {},
        };
      }
      const updatedStudents = (payload.students || []).map(s => {
        const att = attMap[_normID(s.id)] || {};
        return {
          ...s,
          attPct:     att.percent !== undefined ? att.percent : '-',
          attPresent: att.present !== undefined ? att.present : '-',
          attLate:    att.late    !== undefined ? att.late    : '-',
          attLeave:   att.leave   !== undefined ? att.leave   : '-',
          attAbsent:  att.absent  !== undefined ? att.absent  : '-',
          attRecords: att.records || {},
        };
      });
      finalPayload = { ...payload, attSessions: freshSessions, students: updatedStudents };
    }
  } catch (_) { /* attendance optional — render with whatever frontend sent */ }

  return _cached(finalPayload, _esc);
}

module.exports = { generatePP5Template };
