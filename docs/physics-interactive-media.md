# สื่อฟิสิกส์โต้ตอบบนโดเมน PSSMS

สื่อที่ตรวจทานแล้วอยู่ใน `teaching-media/` และเปิดผ่าน router `routes/teachingMedia.js`:

| บท | URL บนโรงเรียนภูพระบาทวิทยา |
|---|---|
| สมดุลกล | https://pw.pssms.app/teaching-media/equilibrium |
| เสียง | https://pw.pssms.app/teaching-media/sound |
| คลื่นแม่เหล็กไฟฟ้า | https://pw.pssms.app/teaching-media/electromagnetic-waves |

แต่ละไฟล์เป็น HTML สำเร็จรูป รวม CSS/JavaScript ไม่มี dependency ภายนอก ไม่ต้องใช้ Vercel
หรือเซิร์ฟเวอร์ localhost. ไม่มีการเปลี่ยนระบบอัปโหลด: ยังไม่รับ HTML ที่ผู้ใช้ส่งเข้ามาเอง.

## การแยกสิทธิ์จากระบบโรงเรียน

Router ตั้ง CSP `sandbox allow-scripts` โดยไม่ให้ `allow-same-origin`:
สื่อจึงทำงานใน opaque origin และอ่าน JWT ใน localStorage ของระบบไม่ได้.
ปิด network requests, form submission, base URL และ popup ด้วย CSP; รับเฉพาะชื่อบทใน allowlist.
ไฟล์อยู่นอก `public/` เพื่อไม่ให้ express.static เสิร์ฟข้าม header เหล่านี้.
ไม่ใส่ข้อมูลนักเรียนหรือข้อมูลครูในสื่อ. URL ของบทเปิดโดยไม่ล็อกอินได้
รวมถึงแบบทดสอบ/เฉลยที่อยู่ใน HTML; การซ่อนการ์ดจากนักเรียนไม่ใช่การป้องกัน URL ของบท.
ใช้ข้อสอบจริงหรือข้อมูลที่ต้องเก็บเป็นความลับในระบบไฟล์ที่ตรวจสิทธิ์ตามเดิม.

## เพิ่มการ์ดให้ teacher12 เฉพาะภูพระบาทวิทยา

หลัง deploy และตรวจสาม URL แล้ว รัน `scripts/import-pw-physics-media.js` โดยตั้ง
`DATABASE_URL` ของโรงเรียนเป้าหมายผ่านช่องทางที่มีอยู่. สคริปต์ไม่โหลด `.env.prod` เอง.

```sh
node scripts/import-pw-physics-media.js          # ตรวจเป้าหมายและแสดงรายการ ยังไม่เขียน
node scripts/import-pw-physics-media.js --apply  # เพิ่มการ์ดที่ยังไม่มี
```

สคริปต์ปฏิเสธฐานข้อมูลเดโม โรงเรียนที่ชื่อไม่ใช่ภูพระบาทวิทยา และบัญชี teacher12
ที่ไม่ใช่ครู. ใช้ `saveMediaCard` เดิมและ owner `teacher12`; ไม่ปักหมุด ไม่แก้การ์ดเดิม
และไม่กู้การ์ดที่ครูลบ. การ์ดเริ่มต้น `visible_levels=[]` (ครูเท่านั้น) เพราะสื่อมีเฉลย.
ครูปรับระดับชั้นจากหน้าเพิ่ม/แก้การ์ดได้เอง. ไม่รันสคริปต์นี้อัตโนมัติใน migration/boot
จึงไม่เพิ่มการ์ดของครูคนนี้ให้โรงเรียนอื่น.

## ตรวจงาน

```sh
node --test test/teaching_media.test.js test/physics_media_import.test.js
```

HTTP tests ตรวจสามบท/CSP/404/traversal; import tests ตรวจ school guard, dry-run,
owner/visibility และการรันซ้ำโดยไม่แตะฐานข้อมูลจริง.
ตรวจในเบราว์เซอร์เพิ่ม: ปรับตัวควบคุม ทำแบบทดสอบ หมุนภาพสามมิติ และกดฟังเสียง
โดยไม่มี script errors หรือ network requests ภายนอก.
