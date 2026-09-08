/**
 * คู่มือเริ่มต้นใช้งานที่ `/manual` — หน้าที่ธุรการโรงเรียนได้ลิงก์ไปพร้อมข้อความส่งมอบ
 *
 * เทสที่นี่ทำสองอย่าง: ตัว renderer แปลง markdown ถูกไหม และ **คู่มือจริง**
 * ผ่าน renderer แล้วไม่มีอะไรหลุดออกมาเป็นข้อความดิบ — คู่มือเป็นไฟล์ที่คนแก้บ่อย
 * ใส่ syntax ที่ renderer ไม่รู้จักเมื่อไหร่ ธุรการจะเห็น `**ตัวหนา**` ติดดาวคาหน้าจอ
 */
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const { baseURL, stop } = require('./helpers/api');
const { renderMarkdown, manualPage, DOC } = require('../lib/manual');

after(stop);

const get = async (path, headers = {}) => {
  const base = await baseURL();
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, { headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: data }));
    }).on('error', reject);
  });
};

// ── ตัว renderer ──────────────────────────────────────────────────────────────

test('หัวข้อ ย่อหน้า รายการ เส้นคั่น', () => {
  const { html } = renderMarkdown('# ชื่อ\n\nข้อความ\n\n- ก\n- ข\n\n---\n');
  assert.match(html, /<h1 id="[^"]+">ชื่อ<\/h1>/);
  assert.match(html, /<p>ข้อความ<\/p>/);
  assert.match(html, /<ul>\n<li>ก<\/li>\n<li>ข<\/li>\n<\/ul>/);
  assert.match(html, /<hr>/);
});

test('รายการมีเลขไม่กลายเป็นย่อหน้าที่ขึ้นต้นด้วยเลข', () => {
  const { html } = renderMarkdown('1. หนึ่ง\n2. สอง\n');
  assert.match(html, /<ol>\n<li>หนึ่ง<\/li>\n<li>สอง<\/li>\n<\/ol>/);
});

test('ตารางต้องมีเส้นคั่นถึงจะเป็นตาราง ไม่งั้นเป็นข้อความธรรมดา', () => {
  const withDivider = renderMarkdown('| ก | ข |\n|---|---|\n| 1 | 2 |\n').html;
  assert.match(withDivider, /<th>ก<\/th><th>ข<\/th>/);
  assert.match(withDivider, /<td>1<\/td><td>2<\/td>/);
  // ตารางกว้างต้องเลื่อนในกล่องตัวเอง ไม่ดันทั้งหน้าให้เลื่อนแนวนอน
  assert.match(withDivider, /<div class="tw">/);
});

test('`code` ตีก่อน **ตัวหนา** — ดาวที่อยู่ในโค้ดต้องไม่กลายเป็นตัวหนา', () => {
  const { html } = renderMarkdown('ใช้ `a**b**c` แล้ว **หนา** ด้วย\n');
  assert.match(html, /<code>a\*\*b\*\*c<\/code>/);
  assert.match(html, /<strong>หนา<\/strong>/);
});

test('ตัวเอียงไม่กินตัวหนา', () => {
  const { html } = renderMarkdown('*เอียง* กับ **หนา** ในบรรทัดเดียว\n');
  assert.match(html, /<em>เอียง<\/em>/);
  assert.match(html, /<strong>หนา<\/strong>/);
  assert.doesNotMatch(html, /<em><\/em>/, 'ดาวคู่ถูกกินไปครึ่งหนึ่ง');
});

test('HTML ในคู่มือถูก escape ไม่ใช่เอาไปรันจริง', () => {
  const { html } = renderMarkdown('<script>alert(1)</script>\n');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('ลิงก์นอกเหนือ http/#/ ถูกตัดทิ้ง เหลือแต่ข้อความ', () => {
  assert.match(renderMarkdown('[ก](https://a.test)').html, /<a href="https:\/\/a\.test">ก<\/a>/);
  assert.match(renderMarkdown('[ก](#หัวข้อ)').html, /<a href="#หัวข้อ">ก<\/a>/);
  const bad = renderMarkdown('[กด](javascript:alert(1))').html;
  assert.doesNotMatch(bad, /javascript:/);
  assert.match(bad, /กด/);
});

// ── คู่มือจริง ────────────────────────────────────────────────────────────────

const md = fs.readFileSync(DOC, 'utf8');

test('คู่มือจริงผ่าน renderer แล้วไม่มี markdown หลุดออกมาเป็นข้อความ', () => {
  const { html } = renderMarkdown(md);
  const body = html;
  assert.doesNotMatch(body, /\*\*/, 'ตัวหนายังติดดาวอยู่');
  assert.doesNotMatch(body, /`/, 'โค้ดยังติด backtick อยู่');
  assert.doesNotMatch(body, /^\s*\|/m, 'ตารางยังเป็นเส้นขีดอยู่');
  assert.doesNotMatch(body, /^#{1,6}\s/m, 'หัวข้อยังเป็น # อยู่');
  assert.doesNotMatch(body, /^&gt;\s/m, 'คำพูดอ้างยังเป็น > อยู่');
  assert.doesNotMatch(body, /\[[^\]]+\]\(/, 'ลิงก์ยังเป็น []() อยู่');
});

test('ทุก h2 ในคู่มืออยู่ในสารบัญ และ anchor ชี้ไปที่หัวข้อจริง', () => {
  const { html, toc } = renderMarkdown(md);
  const h2count = (md.match(/^##\s+/gm) || []).length;
  assert.strictEqual(toc.length, h2count, 'จำนวนหัวข้อในสารบัญไม่ตรงกับในคู่มือ');
  for (const item of toc) {
    assert.ok(html.includes(`id="${item.id}"`), `สารบัญชี้ไป #${item.id} ซึ่งไม่มีในหน้า`);
  }
});

test('ลิงก์ข้ามหัวข้อในคู่มือต้องชี้ไปที่หัวข้อที่มีอยู่จริง', () => {
  // เปลี่ยนชื่อหัวข้อแล้วลืมแก้ลิงก์ = กดแล้วไม่ไปไหน ไม่มีอะไรฟ้อง
  const { html } = renderMarkdown(md);
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.has(m[1]), `ลิงก์ชี้ไป #${m[1]} ซึ่งไม่มีหัวข้อนั้น`);
  }
});

test('คู่มือไม่มีค่า env, คีย์ หรือคำสั่งที่แตะข้อมูลได้ — ไฟล์นี้ส่งให้โรงเรียน', () => {
  // ⚠️ เส้นแบ่งกับ docs/setup-new-school.md ซึ่งมีของพวกนี้และห้ามส่ง
  for (const bad of ['DATABASE_URL', 'JWT_SECRET', 'S3_SECRET', 'S3_ACCESS_KEY',
    'railway ', 'psql ', 'DELETE FROM', 'node db/', 'node scripts/']) {
    assert.ok(!md.includes(bad), `คู่มือมี "${bad}" ซึ่งไม่ควรอยู่ในไฟล์ที่ส่งให้โรงเรียน`);
  }
});

// ── หน้าเว็บ ──────────────────────────────────────────────────────────────────

test('/manual เปิดได้โดยไม่ต้องล็อกอิน', async () => {
  const res = await get('/manual');
  assert.strictEqual(res.status, 200);
  assert.match(res.type, /text\/html/);
  assert.match(res.body, /<title>เริ่มต้นใช้งาน PSSMS/);
  assert.match(res.body, /class="toc"/);
});

test('/manual จัดหน้ากระดาษ A4 ไว้ให้ — ธุรการกดพิมพ์แล้วได้ PDF ที่อ่านได้', () => {
  const page = manualPage();
  assert.match(page, /@page \{ size:A4/);
  assert.match(page, /@media print/);
  // สารบัญไม่ควรกินหน้ากระดาษหน้าแรกตอนพิมพ์
  assert.match(page, /\.toc, \.print-hint \{ display:none \}/);
});

test('/manual ไม่ใช่ SPA fallback — path ที่ไม่มีจริงยังต้อง 404 เหมือนเดิม', async () => {
  const res = await get('/manual.pdf');
  assert.strictEqual(res.status, 404, 'ไฟล์ที่ไม่มีต้อง 404 ไม่ใช่คืน HTML');
});
