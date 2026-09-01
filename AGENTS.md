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
| [`docs/adr/`](./docs/adr/) | บันทึกการตัดสินใจเชิงสถาปัตยกรรม |
| [`docs/plan-teacher-progress-board.md`](./docs/plan-teacher-progress-board.md) | แผนกระดานติดตามงานครู — **พร้อมเริ่มเขียน** |
