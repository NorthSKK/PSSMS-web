# PSSMS Web — Custom Skills

**ตัวจริงอยู่ที่ [`.claude/commands/`](./.claude/commands/)** — แก้ที่นั่น

ไฟล์นี้เคยเก็บเนื้อหา slash command ไว้ซ้ำ แต่ค้างตั้งแต่ 2026-06-05 และ path
ที่เขียนไว้ข้างในชี้ไปโฟลเดอร์ที่ไม่มีอยู่จริงแล้ว
(`/Users/north/.../โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS`)
รันตามจะ error ทันที เก็บไว้เป็นตัวชี้ทางแทน

| command | ทำอะไร |
|---|---|
| `/dev` | kill process บน port 3000 แล้วรัน server ใหม่ |
| `/debug` | ตรวจระบบทั้งชุด แล้วสรุป pass/fail |
| `/migrate` | รัน SQL migration กับ DB |
| `/schema` | ดู column ของตาราง |
| `/test-fn` | ยิง backend function ด้วย admin JWT |

⚠️ command เหล่านี้ทำงานกับ DB ที่ `.env` ชี้อยู่ ซึ่งตอนนี้คือ **dev
(`localhost:5432/pssms_dev`)** ไม่ใช่ production — ดู "Dev DB แยกจาก Production"
ใน [`CLAUDE.md`](./CLAUDE.md)
