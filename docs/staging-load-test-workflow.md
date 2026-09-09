# Workflow ทดสอบความจุบน staging

คู่มือนี้ทำให้การทดสอบความจุเกิดบน Railway staging ที่แยกทั้ง service และ PostgreSQL
ออกจากเดโมและโรงเรียนจริงโดยเด็ดขาด. ผลทดสอบจะเป็น GitHub Actions artifact และใช้เป็น
หลักฐานก่อนตัดสินใจขึ้น `production`.

## ขอบเขต

สถานการณ์คือจังหวะเช้าที่หนักที่สุด: ครูทั้งโรงเรียนเช็คชื่อ เปิดสมุดเช็คชื่อ และเปิด
แดชบอร์ดพร้อมกัน. โปรไฟล์มาตรฐานคือ 20/500, 50/1,500 และ 100/3,500
(ครู/นักเรียน). รายละเอียดผล baseline บนเครื่องอยู่ที่
[`load-test-2026-09-08.md`](./load-test-2026-09-08.md).

สคริปต์สร้างบัญชี ห้อง ตาราง และแถวเช็คชื่อที่ชื่อขึ้นต้น `PERF_` แล้วลบทั้งหมดก่อนจบ
รวมถึงตอนเกิดข้อผิดพลาด. มันไม่รับ remote mode ถ้าไม่มีด่านความปลอดภัยครบ.

## ตั้ง staging หนึ่งครั้ง

1. สร้าง Railway service และ PostgreSQL ใหม่สำหรับ staging เท่านั้น; ห้าม share database,
   R2 bucket หรือ custom domain กับเดโม/โรงเรียนจริง
2. ให้ service นั้น deploy branch ที่ต้องการทดสอบ และกำหนด URL HTTPS เช่น
   `https://pssms-load-test-staging.up.railway.app`
   ถ้า PostgreSQL เชื่อมจาก private network แบบไม่รองรับ SSL ให้ตั้ง Railway variable
   `DATABASE_SSL=false` **เฉพาะ service staging**; ค่า default ของทุก remote database
   ในแอปยังเป็น SSL.
3. รัน migrations แล้วตั้ง marker ต่อไปนี้ใน **ฐานข้อมูล staging เท่านั้น**:

   ```sql
   INSERT INTO system_settings(key, subkey, value1)
   VALUES ('Instance', 'Environment', 'staging')
   ON CONFLICT (key, subkey) DO UPDATE SET value1 = 'staging';
   ```

   หาก marker นี้ไม่อยู่ สคริปต์จะหยุดก่อนเขียนข้อมูล. ห้ามตั้ง marker นี้ใน DB โรงเรียนจริง
4. ใน GitHub สร้าง Environment ชื่อ `load-test-staging`, ตั้ง required reviewers อย่างน้อย
   1 คน, แล้วเพิ่ม secrets ต่อไปนี้ใน Environment (ไม่ใช่ repository secrets):

   | Secret | ค่า |
   | --- | --- |
   | `PSSMS_LOAD_TEST_URL` | HTTPS URL ของ Railway staging |
   | `PSSMS_LOAD_TEST_DATABASE_URL` | PostgreSQL URL ของ staging เท่านั้น |
   | `PSSMS_LOAD_TEST_JWT_SECRET` | `JWT_SECRET` ของ staging เท่านั้น |

   Action ใช้ชื่อ env แยกจาก `DATABASE_URL`/`JWT_SECRET` ปกติ และเปิด remote mode ได้เฉพาะ
   เมื่อตั้ง `PSSMS_LOAD_TEST_CONFIRM=STAGING_ONLY` ใน workflow แล้วเท่านั้น.
   TCP proxy ของ Railway staging ชุดนี้เป็น plain PostgreSQL จึงตั้ง
   `PSSMS_LOAD_TEST_DATABASE_SSL=false` ไว้ใน workflow โดยตรง; ไม่มี secret และใช้เฉพาะ job นี้.

## รันจริง

1. เปิด GitHub Actions → **Staging load test** → **Run workflow**
2. เลือก `all` สำหรับทั้งสามขนาด หรือ `large` เมื่อต้องการตรวจกรณีใหญ่สุดอย่างเดียว
3. reviewer ของ Environment อนุมัติให้ job เข้าถึง secrets
4. ดาวน์โหลด artifact `staging-load-test-<run id>` แล้วเปิด `load-test-result.json`

ห้ามรัน `--remote` จากเครื่องด้วย credentials ที่ชี้ production; marker เป็นด่านสำคัญ
แต่การเก็บ secrets ไว้เฉพาะ Environment คือด่านหลัก.

## เกณฑ์ตัดสินก่อนขึ้นโรงเรียนจริง

- ทุก scenario ต้อง `failed = 0`
- p95 ของเช็คชื่อและสมุดเช็คชื่อต้องไม่เกิน 2 วินาที
- p95 ของแดชบอร์ดครูต้องไม่เกิน 5 วินาที
- ตรวจ Railway metrics ช่วง run: CPU/RAM ไม่ชนเพดาน, PostgreSQL connections ไม่ใกล้ limit,
  ไม่มี restart และไม่มี 5xx
- ถ้าค่าแย่กว่า baseline หรือเกณฑ์นี้ ให้แก้และรันทดสอบใหม่ก่อน merge `main` ไป `production`

ตอนนี้การขึ้นโรงเรียนจริงยังใช้ `git merge main` ตามคู่มือเดิม จึงไม่สามารถบังคับ workflow
นี้เป็น technical gate ได้โดยลำพัง. หากต้องการ gate แบบบังคับ ต้องเปลี่ยนการ promote เป็น
pull request `main` → `production` แล้วตั้ง branch protection ให้ check นี้เป็น required.
