# PSSMS Web — Agent Instructions

**คู่มือฉบับจริงอยู่ที่ [`CLAUDE.md`](./CLAUDE.md)** — อ่านไฟล์นั้น

ไฟล์นี้เคยเป็นสำเนาของ `CLAUDE.md` แต่หยุดอัปเดตไปตั้งแต่ 2026-06-05 แล้วค้างอยู่
2 เดือนจนข้อมูลผิด (เช่นยังอ้าง `verifyTeacherPermission` ที่เปลี่ยนชื่อเป็น
`verifyTeacherOwnsSubject` ไปแล้ว) เก็บไว้เป็นตัวชี้ทางแทน เพราะบาง tool มองหา
ชื่อไฟล์ `AGENTS.md` โดยเฉพาะ — จะได้ไม่ต้องคอย sync 2 ไฟล์ให้ตรงกันอีก

เอกสารอื่น:

| ไฟล์ | เนื้อหา |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | architecture, schema, convention, กติกาการทำงาน — **แหล่งอ้างอิงหลัก** |
| [`WEB_DEV.md`](./WEB_DEV.md) | คู่มือ onboarding — setup, เพิ่ม endpoint/หน้าใหม่, deploy, pitfalls |
| [`.claude/commands/`](./.claude/commands/) | slash command (`/dev`, `/debug`, `/migrate`, `/schema`, `/test-fn`) |
| [`docs/agents/`](./docs/agents/) | issue tracker, triage labels, domain docs |
| [`CONTEXT.md`](./CONTEXT.md) | อภิธานศัพท์โดเมน — บทบาท, กลุ่มสาระ vs วิชาเอก, กับดัก `department` |
| [`docs/adr/`](./docs/adr/) | บันทึกการตัดสินใจเชิงสถาปัตยกรรม — 0001 ขอบเขตของ Executive · 0002 ห้ามคำนวณ % เวลาเรียนซ้ำ |
| [`docs/plan-teacher-progress-board.md`](./docs/plan-teacher-progress-board.md) | แผนกระดานติดตามงานครู — **เขียนเสร็จแล้ว แต่พักไว้ ติดป้ายกำลังพัฒนา** |

## สถานะงานล่าสุด (2 ก.ย. 2569)

| งาน | สถานะ |
|---|---|
| **ติดตามนักเรียนรายวัน** (`Page_Student_Watch`) | ใช้งานจริงแล้วบน `pw.pssms.app` · แท็บรายวัน + แท็บสะสม |
| สถานะ `โดด` ในหน้าเช็คชื่อ | ใช้งานจริงแล้ว — นับเป็น `ขาด` เต็มจำนวน ปพ.5 ใช้ `ข` |
| **กระดานติดตามงานครู** (`Page_Teacher_Progress`) | **พักไว้** โค้ดครบ เทสเขียว แต่ยังไม่ตัดสินว่าจะติดตามอะไรบ้าง — ถอดป้าย "กำลังพัฒนา" เมื่อทบทวนเสร็จ |
| แพ็กเกจครูคนเดียว / `pssms-teacher` | **ยกเลิก** ลบเอกสารทิ้งแล้ว |

**ที่ยังไม่ได้ทำและรู้ตัวอยู่**

- หน้าติดตามนักเรียน**แม่นเท่าที่ครูเช็คชื่อครบ** — คาบที่ไม่มีแถวแยกไม่ออกระหว่าง
  "เด็กอยู่ในคาบ" กับ "ครูไม่ได้เช็ค" · กระดานติดตามงานครูคือตัววัดข้อนี้ ควรดูก่อนเชื่อตัวเลข
- `getAvailableSubstitutes` (`functions/missing.js`) ยังใช้กติกาเก่า — นับภาระ lifetime,
  ไม่เช็คใบลา, จับกลุ่มสาระจาก `users.department` · เถียงกับ `substituteAuto.js`
