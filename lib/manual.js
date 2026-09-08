'use strict';
/**
 * คู่มือเริ่มต้นใช้งานสำหรับโรงเรียน — เสิร์ฟเป็นหน้าเว็บที่ `/manual`
 *
 * **แหล่งความจริงคือ `docs/school-onboarding.md` ไฟล์เดียว** ไม่มีสำเนา HTML
 * ที่ commit ไว้ ไม่มี PDF ที่ต้อง build ใหม่ทุกครั้งที่ปุ่มขยับ — เพราะคู่มือเล่มนี้
 * อธิบายว่า "กดปุ่มชื่ออะไร" ซึ่งเปลี่ยนไปพร้อมโค้ด สำเนาที่หลุดออกไปอยู่ในไลน์
 * จะบอกให้คนหาปุ่มที่ไม่มีอยู่จริง โดยไม่มีทางเรียกกลับ
 *
 * เสิร์ฟจากแอปของโรงเรียนเอง (`<ชื่อย่อ>.pssms.app/manual`) ไม่ใช่จากเว็บขาย —
 * คู่มือจึงตรงกับเวอร์ชันที่โรงเรียนนั้นใช้อยู่จริงเสมอ และไม่ต้องก๊อป `.md`
 * ข้าม repo ไปให้ drift แบบที่ `lib/subjectGroup.js` เคยเจอ
 *
 * ⚠️ **หน้านี้เปิดสาธารณะ ไม่ต้องล็อกอิน** โดยตั้งใจ — ธุรการต้องอ่านได้ตั้งแต่ก่อน
 * เข้าระบบครั้งแรก และเนื้อหาไม่มีข้อมูลของใครเลย · ถ้าวันหนึ่งเพิ่มเนื้อหาที่อ้าง
 * ข้อมูลจริงของโรงเรียน ต้องย้ายไปหลัง auth ก่อน
 *
 * ไม่แตะ DB · ไม่มี dependency เพิ่ม · ธุรการกด Ctrl+P ได้ PDF เองถ้าอยากได้ไฟล์
 */

const fs = require('fs');
const path = require('path');

const DOC = path.join(__dirname, '../docs/school-onboarding.md');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * inline: `code` → **bold** → [link](url)
 *
 * ⚠️ **โค้ดต้องถูกยกออกไปก่อน ไม่ใช่แค่แปลงก่อน** — แปลงเป็น `<code>…</code>` เฉย ๆ
 * แล้วปล่อยให้กติกาถัดไปไล่ทับทั้งสตริง `**` ที่อยู่ในโค้ดก็ยังกลายเป็นตัวหนาอยู่ดี
 * (`a**b**c` ในโค้ดคือตัวอย่างที่ครูเขียนได้จริงเวลาอธิบายรูปแบบข้อมูล)
 *
 * escape ต้องเกิดก่อนทุกอย่าง ไม่งั้น `<` ในเนื้อหากลายเป็นแท็กจริง
 */
function inline(text) {
  const codes = [];
  return esc(text)
    .replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // ตัวเอียงต้องมาหลังตัวหนา ไม่งั้น `*` เดี่ยวกิน `**` ไปครึ่งหนึ่ง
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      /^https?:\/\//.test(href) || href.startsWith('/') || href.startsWith('#')
        ? `<a href="${href}">${label}</a>`
        : label)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/** id สำหรับสารบัญ — ภาษาไทยใช้เป็น id ได้ แต่ต้องไม่มีช่องว่าง */
const slug = (text) => 'h-' + String(text).trim()
  .replace(/[^\wก-๙฀-๿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const isTableRow = (l) => l.startsWith('|') && l.endsWith('|');
const cells = (l) => l.slice(1, -1).split('|').map((c) => c.trim());
const isDivider = (l) => isTableRow(l) && cells(l).every((c) => /^:?-{2,}:?$/.test(c));

/**
 * markdown ชุดย่อยเท่าที่คู่มือใช้ — หัวข้อ ย่อหน้า รายการ ตาราง คำพูดอ้าง เส้นคั่น
 * รองรับรายการแบบมีเลขด้วย เพราะคู่มือแบบทำตามขั้นตอนมักโตไปทางนั้น
 * คืน `{ html, toc }` — toc คือหัวข้อ h2 ไว้ทำสารบัญ
 */
function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const toc = [];
  let para = [];
  let list = null;   // 'ul' | 'ol'
  let quote = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { flushAll(); continue; }

    if (/^-{3,}$/.test(t)) { flushAll(); out.push('<hr>'); continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      const id = slug(h[2]);
      if (level === 2) toc.push({ id, text: h[2].replace(/[*`]/g, '') });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      continue;
    }

    if (t.startsWith('> ') || t === '>') {
      flushPara(); flushList();
      quote.push(t.replace(/^>\s?/, ''));
      continue;
    }
    flushQuote();

    // ตาราง: หัวตาราง + เส้นคั่น + แถวข้อมูล — ต้องมีเส้นคั่นถึงจะนับเป็นตาราง
    if (isTableRow(t) && isTableRow((lines[i + 1] || '').trim()) && isDivider(lines[i + 1].trim())) {
      flushAll();
      const head = cells(t);
      const body = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i].trim())) { body.push(cells(lines[i].trim())); i++; }
      i--;
      out.push('<div class="tw"><table><thead><tr>' +
        head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    const bullet = t.match(/^[-*]\s+(.*)$/);
    const numbered = t.match(/^\d+\.\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const want = bullet ? 'ul' : 'ol';
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
      continue;
    }
    flushList();

    para.push(t);
  }
  flushAll();
  return { html: out.join('\n'), toc };
}

const STYLE = `
:root { --ink:#1f2933; --muted:#5b6a78; --line:#e3e8ee; --accent:#0f766e;
        --warn-bg:#fff8e6; --warn-line:#f0b429; --bg:#fff; }
* { box-sizing:border-box }
body { margin:0; background:var(--bg); color:var(--ink); line-height:1.75;
       font-family:"Sarabun","Noto Sans Thai","Helvetica Neue",Arial,sans-serif; }
.wrap { max-width:820px; margin:0 auto; padding:32px 20px 96px }
h1 { font-size:1.9rem; line-height:1.35; margin:0 0 8px }
h2 { font-size:1.35rem; margin:2.4rem 0 .6rem; padding-top:.4rem; border-top:1px solid var(--line) }
h3 { font-size:1.08rem; margin:1.6rem 0 .4rem; color:var(--accent) }
p, li { font-size:1rem }
ul, ol { padding-left:1.4rem }
li { margin:.25rem 0 }
hr { border:0; border-top:1px solid var(--line); margin:2rem 0 }
code { background:#f1f5f9; padding:.1em .38em; border-radius:5px;
       font-family:ui-monospace,Menlo,Consolas,monospace; font-size:.92em }
blockquote { margin:1rem 0; padding:.7rem 1rem; background:var(--warn-bg);
             border-left:4px solid var(--warn-line); border-radius:0 8px 8px 0 }
blockquote p { margin:.2rem 0 }
.tw { overflow-x:auto; margin:1rem 0 }
table { border-collapse:collapse; width:100%; font-size:.95rem }
th, td { border:1px solid var(--line); padding:.5rem .7rem; text-align:left; vertical-align:top }
th { background:#f8fafc; font-weight:600 }
a { color:var(--accent) }
.lead { color:var(--muted); margin:0 0 24px }
.toc { background:#f8fafc; border:1px solid var(--line); border-radius:10px;
       padding:14px 18px; margin:0 0 32px }
.toc b { display:block; margin-bottom:6px; font-size:.95rem }
.toc ol { margin:0; padding-left:1.3rem; columns:2; column-gap:28px }
.toc li { margin:.15rem 0; break-inside:avoid }
.toc a { text-decoration:none }
.toc a:hover { text-decoration:underline }
.print-hint { margin-top:10px; font-size:.85rem; color:var(--muted) }

@media (max-width:640px) { .toc ol { columns:1 } .wrap { padding:20px 16px 64px } }

@media print {
  @page { size:A4; margin:16mm 14mm }
  .toc, .print-hint { display:none }
  body { font-size:11.5pt }
  h2 { break-after:avoid }
  h3 { break-after:avoid }
  table, blockquote, li { break-inside:avoid }
  .wrap { max-width:none; padding:0 }
}
`;

let _cached = null;

/**
 * หน้าคู่มือเต็ม — render ครั้งเดียวแล้วเก็บไว้ (ไฟล์เปลี่ยนได้ก็ต่อเมื่อ deploy ใหม่
 * ซึ่ง process ก็เริ่มใหม่อยู่แล้ว) · ส่ง `{ fresh:true }` เพื่อบังคับอ่านใหม่ตอนเทส
 */
function manualPage(opts) {
  if (_cached && !(opts && opts.fresh)) return _cached;
  const md = fs.readFileSync(DOC, 'utf8');
  const { html, toc } = renderMarkdown(md);
  const title = (md.match(/^#\s+(.*)$/m) || [, 'คู่มือเริ่มต้นใช้งาน'])[1];

  // สารบัญวางใต้ชื่อเรื่อง ไม่ใช่เหนือ — เปิดมาต้องเห็นก่อนว่านี่คือคู่มืออะไร
  const nav = `<nav class="toc"><b>หัวข้อในคู่มือ</b><ol>${
    toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')
  }</ol><p class="print-hint">อยากได้เป็นไฟล์ PDF — กด Ctrl+P (Mac: \u2318+P) แล้วเลือก
  "บันทึกเป็น PDF" หน้านี้จัดหน้ากระดาษ A4 ไว้ให้แล้ว</p></nav>`;
  const cut = html.indexOf('</h1>');
  const body = cut === -1 ? nav + html
    : html.slice(0, cut + 5) + '\n' + nav + html.slice(cut + 5);

  const page = `<!DOCTYPE html>
<html lang="th"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap">
<style>${STYLE}</style>
</head><body><div class="wrap">
${body}
</div></body></html>`;

  _cached = page;
  return page;
}

module.exports = { renderMarkdown, manualPage, DOC };
