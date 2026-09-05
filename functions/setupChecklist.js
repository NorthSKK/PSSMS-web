'use strict';
/**
 * รายการตั้งค่าเริ่มต้นของโรงเรียนใหม่ — อ่านสถานะจริงจาก DB ทุกครั้ง
 *
 * 1 โรงเรียน = 1 deployment แปลว่าทุกโรงเรียนที่ซื้อไปต้องเดินเส้นทางนี้เอง
 * ก่อนหน้านี้ไม่มีอะไรบอกว่าต้องทำอะไรบ้าง — login ครั้งแรกเจอหน้าเปล่า
 *
 * ⚠️ **ไม่บล็อกอะไรทั้งสิ้น** เป็นแค่การ์ดบอกทาง คนที่รู้งานข้ามไปทำอะไรก่อนก็ได้
 * เหตุผลที่ไม่ทำเป็น wizard บังคับทีละขั้น: โรงเรียนที่อยากดูก่อนตัดสินใจจะอึดอัด
 * และ wizard ต้องเก็บ state ว่าไปถึงขั้นไหนแล้ว ซึ่งเป็นของที่ต้องดูแลเพิ่มโดยไม่จำเป็น
 * — สถานะจริงอ่านจาก DB ได้อยู่แล้วทุกเมื่อ
 *
 * ⚠️ ลำดับใน `items` คือลำดับที่ต้องทำจริง ไม่ใช่แค่ลำดับที่แสดง — นำเข้าตารางสอน
 * ก่อนนำเข้าครูจะถูกปฏิเสธทั้งไฟล์ (importTimetableCSV ตรวจว่าครูมีตัวตนก่อน)
 * และตั้งครูที่ปรึกษาก่อนนำเข้านักเรียนจะไม่มีรายชื่อห้องให้เลือก
 */

const { query } = require('../lib/db');
const getSystemConfig = require('./getSystemConfig');
const adminIssued = require('../db/adminIssued');

const DEFAULT_ADMIN_PASSWORD = '1234';

/**
 * รหัส admin ยังเป็นใบที่ได้มาตอนติดตั้งอยู่ไหม
 *
 * มีสองที่มา: `'1234'` ของโรงเรียนยุคแรก กับรหัสสุ่มที่ระบบหลังบ้านออกให้
 * ซึ่งจดลายนิ้วมือไว้ตอน boot (`db/adminIssued.js`) · เทียบใน node ไม่ใช่ใน SQL
 * เพราะ pgcrypto ไม่ได้เปิดทุก deployment
 *
 * ⚠️ คืนแค่ true/false ห้ามให้รหัสหรือลายนิ้วมือหลุดออกไปกับผลลัพธ์
 */
async function stillUsingIssuedPassword() {
  const { rows } = await query("SELECT password FROM users WHERE username = 'admin'");
  if (!rows.length) return false;            // ลบบัญชี admin ทิ้งแล้วใช้บัญชีอื่น = ไม่ต้องเตือน
  const current = String(rows[0].password || '');
  if (current === DEFAULT_ADMIN_PASSWORD) return true;
  const issued = await adminIssued.read();
  return !!issued && adminIssued.fingerprint(current) === issued;
}

async function getSetupChecklist() {
  const cfg = await getSystemConfig();

  const { rows: counts } = await query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE UPPER(role)='TEACHER')                       AS teachers,
      (SELECT count(*)::int FROM users WHERE UPPER(role)='STUDENT' AND status='ปกติ')      AS students,
      (SELECT count(*)::int FROM timetable WHERE term=$1 AND year=$2 AND subject_code<>'HR') AS lessons,
      (SELECT count(DISTINCT teacher_id)::int FROM timetable
         WHERE term=$1 AND year=$2 AND subject_code='HR')                                 AS homeroom,
      -- หัวกระดาษ ปพ.5 ของเทอมที่ใช้อยู่ — ต้องมีที่ตั้งและชื่อ ผอ. ถึงจะพิมพ์ส่งเขตได้
      -- ⚠️ ไม่ดู school_name เพราะ getPrintConfigData เติมให้จาก schoolName อยู่แล้ว
      --    ข้อนี้จะติ๊กเองทันทีที่ตั้งชื่อโรงเรียน ทั้งที่หัวกระดาษยังว่างครึ่งใบ
      (SELECT count(*)::int FROM print_config
         WHERE term=$1 AND year=$2
           AND coalesce(sys_data->>'school_address','')<>''
           AND coalesce(sys_data->>'principal_name','')<>'')                               AS pp5head,
      -- ต้องนับแถวเอง ห้ามดูจาก cfg.term/cfg.year (ดูคอมเมนต์เหนือข้อ term ข้างล่าง)
      (SELECT count(*)::int FROM system_settings
         WHERE key='Active' AND subkey='Term'
           AND coalesce(value1,'')<>'' AND coalesce(value2,'')<>'')                        AS activeterm
  `, [String(cfg.term), String(cfg.year)]);
  const c = counts[0];
  const issuedPassword = await stillUsingIssuedPassword();

  const items = [
    { key: 'schoolName', label: 'ตั้งชื่อโรงเรียน', page: 'Page_Admin_Settings',
      done: !!String(cfg.schoolName || '').trim(),
      hint: 'ชื่อนี้ขึ้นบนหัวเว็บและบนเอกสาร ปพ.5 ที่พิมพ์ออกมา' },

    { key: 'schoolLogo', label: 'อัปโหลดโลโก้โรงเรียน', page: 'Page_Admin_Settings',
      done: !!String(cfg.schoolLogo || '').trim(),
      hint: 'ไม่ตั้งก็ใช้งานได้ แต่หัวเว็บจะเป็นไอคอนเปล่า' },

    // ⚠️ ตัดสินจากแถว `Active/Term` ใน DB **ห้ามดูจาก `cfg.term`/`cfg.year`** —
    // `getSystemConfig` ใส่ default `'1'`/`'2568'` ให้เมื่อไม่มีแถวนี้ เชื่อค่านั้น
    // แล้วข้อนี้จะติ๊ก ✓ เสมอแม้แต่ DB เปล่า ซึ่งเป็นสถานการณ์เดียวที่การ์ดนี้มีไว้เพื่อ
    // แล้วโรงเรียนใหม่จะนำเข้านักเรียนทั้งรุ่นเข้าปี 2568 โดยไม่มีอะไรเตือน
    { key: 'term', label: 'เลือกภาคเรียนและปีการศึกษาที่ใช้งาน', page: 'Page_Admin_Settings',
      done: c.activeterm > 0,
      hint: 'ค่านี้เป็นตัวกำหนดว่าข้อมูลที่นำเข้าจะเข้าเทอมและปีไหน ยังไม่ตั้ง = เข้าปี 2568' },

    { key: 'termDates', label: 'กำหนดวันเปิด-ปิดภาคเรียน', page: 'Page_Admin_Settings',
      done: !!cfg.termStart && !!cfg.termEnd,
      // ไม่ใช่ของประดับ — massive grid ใช้ช่วงนี้เติมคาบย้อนหลังให้ครูเช็คชื่อ
      // และแถบความคืบหน้าภาคเรียนซ่อนตัวเองทั้งแถบถ้าไม่มี
      hint: 'ขาดข้อนี้ ครูจะเช็คชื่อย้อนหลังไม่ได้ และแถบความคืบหน้าภาคเรียนจะไม่ขึ้น' },

    { key: 'teachers', label: 'นำเข้าข้อมูลครู', page: 'Page_Admin_Users',
      done: c.teachers > 0, count: c.teachers,
      hint: 'ต้องทำก่อนนำเข้าตารางสอน — ตารางสอนอ้างชื่อผู้ใช้ครูที่ต้องมีอยู่แล้ว' },

    { key: 'students', label: 'นำเข้าข้อมูลนักเรียน', page: 'Page_Admin_Users',
      done: c.students > 0, count: c.students,
      hint: 'รายชื่อห้องเรียนทั้งหมดในระบบมาจากข้อมูลนักเรียนชุดนี้' },

    { key: 'timetable', label: 'นำเข้าตารางสอน', page: 'Page_Admin_Timetable',
      done: c.lessons > 0, count: c.lessons,
      hint: 'ครูจะเห็นคาบสอนของตัวเองและเช็คชื่อได้ก็ต่อเมื่อมีตารางสอน' },

    // ตัวแก้จริงอยู่ในแท็บ "ครูที่ปรึกษาประจำชั้น" ของหน้าจัดการผู้ใช้งาน
    // ไม่ใช่หน้าตารางสอน แม้ข้อมูลจะลงตาราง `timetable` ก็ตาม
    { key: 'homeroom', label: 'ตั้งครูที่ปรึกษาประจำชั้น', page: 'Page_Admin_Users',
      done: c.homeroom > 0, count: c.homeroom,
      hint: 'ขาดข้อนี้ จะไม่มีโฮมรูมและกิจกรรมหน้าเสาธง' },

    { key: 'pp5Header', label: 'กรอกหัวกระดาษ ปพ.5', page: 'Page_Score_Entry',
      done: c.pp5head > 0,
      hint: 'ที่ตั้งโรงเรียนและชื่อ ผอ. — ขึ้นบนเอกสารที่พิมพ์ส่งเขตจริง' },

    { key: 'adminPassword', label: 'เปลี่ยนรหัสผ่านผู้ดูแลระบบ', page: 'Page_Admin_Users',
      done: !issuedPassword,
      hint: 'ยังเป็นรหัสที่ได้มาตอนติดตั้ง ซึ่งเดินผ่านมือคนอื่นมาแล้ว' },
  ];

  return {
    done: items.filter((i) => i.done).length,
    total: items.length,
    items,
  };
}

module.exports = { getSetupChecklist };
