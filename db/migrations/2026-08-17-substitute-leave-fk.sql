-- ลบใบลาที่มีคาบสอนแทนผูกอยู่เคยพังทั้งคำสั่ง เพราะ FK ไม่มี ON DELETE
-- deleteLeave จัดการเคสปกติเองแล้ว (ลบคาบ 'รอจัด', ตั้ง 'ยกเลิก' ให้คาบที่จัดไปแล้ว)
-- อันนี้เป็นตาข่ายรองรับ path อื่น เช่น ลบตรงจาก psql
ALTER TABLE substitute_assignments DROP CONSTRAINT IF EXISTS substitute_assignments_leave_id_fkey;
ALTER TABLE substitute_assignments
  ADD CONSTRAINT substitute_assignments_leave_id_fkey
  FOREIGN KEY (leave_id) REFERENCES leave_records(id) ON DELETE SET NULL;
