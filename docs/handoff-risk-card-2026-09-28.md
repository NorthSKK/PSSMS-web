# Handoff — การ์ด "นักเรียนกลุ่มเสี่ยง (0, ร, มส.)" → เอาขึ้นโรงเรียนอื่น

วันที่ 2026-09-28 · repo `NorthSKK/PSSMS-web` (โฟลเดอร์ `web_PSSMS`)

## งานถัดไป

เอา commit ชุดนี้ขึ้น **ทุกโรงเรียนที่เปิดใช้งาน** แล้วตรวจทีละโดเมนว่ารันโค้ดใหม่จริง
ตอนนี้ขึ้นแล้วแค่ `pw.pssms.app` กับ `demo.pssms.app`

อ่าน `CLAUDE.md` ก่อนทำอะไร โดยเฉพาะหัวข้อ "สามชั้น: dev → demo → โรงเรียนจริง" และ
"ข้อตกลงการสั่งงาน" (สั่ง "ขึ้นเว็บโรงเรียน" = ทุกโรงเรียนที่เปิดใช้งาน ตรวจจากทะเบียนลูกค้า)

## Commit ชุดนี้ (ต่อจาก `faeedaa`) — อ่านรายละเอียดจาก commit message

```
47c2937 feat: mid-term early warning on the at-risk students card
c3c5bd7 feat: finalize term grades from the at-risk students card
f330761 feat: choose which subjects go into the at-risk print report
0e48086 fix: keep watch chips for passing grades after finalizing
74d5c22 fix: show attendance to date on the watch chip, not the whole-term %
0c0a950 feat: click the 0/ร/มส tiles to list the students
```

`git log faeedaa..0c0a950` / `git show <sha>` · เอกสารอยู่ใน `CLAUDE.md` หัวข้อ
"ป้ายเฝ้าระวังกลางเทอม — `functions/riskWatch.js`" และ "สรุปเกรดส่งรายงาน — `functions/finalGrades.js`"

สรุปสั้นสำหรับเช็คบนหน้าเว็บ:
- การ์ดมีหัวข้อ **เฝ้าระวัง** (ขาดงาน / คะแนนเก็บ / เวลาเรียนนับจากคาบที่สอนไปแล้ว)
- ยุบการ์ด "กระดานแจ้งเตือนกลุ่มเสี่ยง" แยกใบเดิมเข้ามาแล้ว — หายไปจากแดชบอร์ดโดยตั้งใจ
- ปุ่ม **สรุปเกรดส่งรายงาน** · ปุ่ม **พิมพ์แบบรายงาน** มีหน้าต่างเลือกวิชา · กดกล่อง 0/ร/มส ได้

## สิ่งที่ต้องรู้ก่อน deploy

- **ไม่มี migration ใหม่** — ใช้คอลัมน์ `grade_summary.ms_source` ที่มีอยู่แล้ว (เพิ่มค่า `'final'`)
  โรงเรียนที่ยังไม่ถึง `faeedaa` จะได้ migration `2026-09-16-grade-summary-ms-source.sql`
  ไปด้วย ซึ่ง `db/migrate.js` รันเองตอน boot
- `production` = `main` = `0c0a950` แล้ว (fast-forward ทุกครั้ง)
- **ยังไม่รู้ว่าโรงเรียนอื่นดึง branch ไหน / อยู่ service ไหนบน Railway** — ต้องดูเอง
  ถ้า trigger ชี้ `production` อยู่แล้ว อาจขึ้นไปแล้วตั้งแต่ push แค่ต้องตรวจ
  ⚠️ เปลี่ยน branch ของ service ต้องให้ปลายทางชี้ commit เดียวกับที่รันอยู่ก่อน (ดู CLAUDE.md)
- ทะเบียนลูกค้า `https://pssms.app/admin/customers` อยู่หลัง Cloudflare Access — agent รอบก่อน
  เข้าไม่ได้ **ต้องขอรายชื่อโดเมนจากผู้ใช้** · ใน repo `../pssms-site` เจอ `test1.pssms.app`
  กับ `satit.pssms.app` แต่ทั้งคู่ไม่ตอบ (curl `000`) อาจยังไม่เปิดใช้ · `ops.pssms.app` เป็นหลังบ้าน ไม่ใช่แอป
- **ห้ามอ่าน/แตะ DB production** — ถูก permission บล็อกไว้ และ CLAUDE.md ห้ามเอาข้อมูลจริงลง dev

## วิธีตรวจแต่ละโดเมน (ไม่ต้องล็อกอิน)

```bash
D=<ชื่อย่อ>.pssms.app
curl -s https://$D/api/app-info                          # build ต้องขึ้นต้น 0c0a950
curl -s https://$D/api/assets/script/Scripts_Teacher | grep -c openRiskTypeList   # ≥ 1
curl -s -X POST -H 'content-type: application/json' -d '{"args":[]}' \
  https://$D/api/gas/getFinalGradePreview                # ต้องได้ Unauthorized ไม่ใช่ "not implemented"
```

## สถานะเทส

`npm test` / `TZ=UTC npm test`: ผ่าน 452 · **แดง 7 ใน `test/student_watch.test.js`
แดงอยู่แล้วบน main ก่อนงานนี้** (ยืนยันด้วย stash) ไม่เกี่ยวกับชุดนี้ ยังไม่มีใครไล่ต้นเหตุ

## ค้าง / ยังไม่ได้ยืนยัน

- ยังไม่มีใครเปิดหน้าเว็บจริงกดดู (Chrome extension ไม่ได้ต่อ) — โดยเฉพาะ**โหมดมืด**
  ของป้าย `rw-*` และหน้าต่างรายชื่อ
- ปัญหาต้นเรื่องบน `pw`: การ์ดขึ้นติด 0 แค่คนเดียวทั้งที่จริงหลายคน — แก้ด้วยปุ่มสรุปเกรด
  แต่ยังไม่ได้ยืนยันกับข้อมูลจริงว่าครูกดแล้วรายชื่อครบ
- ถ้าทางโหลดสำรองของแดชบอร์ด (`loadTeacherDashboardLegacy`) ทำงาน จะไม่มีป้ายเฝ้าระวัง (ตั้งใจ ไม่มี RPC แยก)

## ย้อนกลับ

`git checkout production && git revert <sha> && git push origin production`
แถวที่ครูกดสรุปไปแล้ว (`ms_source='final'`) จะค้างใน `grade_summary` ไม่ถูกลบตาม

## Suggested skills

- `secretary` (`.agents/skills/secretary/SKILL.md`) — CLAUDE.md บังคับให้ผ่านทุก request
  งานนี้เป็น deploy/ตรวจ ไม่แก้ไฟล์ → read-only pipeline
- `diagnose` — ถ้าโดเมนไหนขึ้นแล้ว build ไม่ตรงหรือหน้าเว็บพัง
