'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { ok, denied, stop, TOKENS, baseURL } = require('./helpers/api');
const { query } = require('../lib/db');
const storage = require('../lib/storage');
const Y='2581', T='2', SID='0099796', SUB='ว99996', CLS='ม.1/96', DAY='2038-06-01', MARK='LAST_COVERAGE_TEST';
let assignmentId;
async function clean() {
  if (assignmentId) await query('DELETE FROM substitute_assignments WHERE id=$1',[assignmentId]);
  await query('DELETE FROM substitute_assignments WHERE subject_code=$1',[SUB]);
  await query('DELETE FROM leave_records WHERE reason=$1',[MARK]);
  for (const table of ['attendance','academic_records','score_database','score_history','timetable']) await query(`DELETE FROM ${table} WHERE subject_code=$1`,[SUB]);
  const files=await query(`SELECT f.file_key FROM project_files f JOIN project_documents p ON p.id=f.project_id WHERE p.title=$1
    UNION ALL SELECT f.file_key FROM professional_development_attachments f JOIN professional_development_activities a ON a.id=f.activity_id WHERE a.title=$1`,[MARK]);
  for(const f of files.rows) await storage.remove(f.file_key);
  await query('DELETE FROM project_documents WHERE title=$1',[MARK]);
  await query('DELETE FROM professional_development_activities WHERE title=$1',[MARK]);
  await query('DELETE FROM clubs WHERE club_name=$1',[MARK]);
  await query('DELETE FROM users WHERE username=$1',[SID]);
}
before(async()=>{
  await clean();
  await query(`INSERT INTO users(username,password,full_name,role,department,year,status) VALUES($1,'test',$2,'Student',$3,$4,'ปกติ')`,[SID,MARK,CLS,Y]);
  await query(`INSERT INTO timetable(subject_code,subject_name,level,room,teacher_id,day,period,term,year)
    VALUES($1,$2,'ม.1','96','teacher1','จันทร์','1',$3,$4)`,[SUB,MARK,T,Y]);
});
after(async()=>{await clean();await stop();});
async function upload(kind,id,as='teacher1') {
  const form=new FormData();form.append('file',new Blob(['%PDF-1.4\nlocal audit file\n%%EOF'],{type:'application/pdf'}),'audit.pdf');
  const response=await fetch(`${await baseURL()}/api/media/${kind}/${id}`,{method:'POST',headers:{Authorization:`Bearer ${TOKENS[as]}`},body:form});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.__result,result.__error);return result.__result;
}
async function readTicket(ticket) {
  const response=await fetch(new URL(ticket.url,await baseURL()));
  assert.equal(response.status,200);assert.match(await response.text(),/^%PDF-/);
}

test('school project attachments upload, serve through a ticket and enforce deletion ownership',async()=>{
  const doc=await ok('saveProjectDocument',[{title:MARK,category:'รายงาน'}],'teacher1');
  await upload('project',doc.id);
  let listed=(await ok('getProjectDocuments',[],'teacher2')).find(r=>r.id===doc.id);
  assert.equal(listed.files.length,1);const fileId=listed.files[0].id;
  await readTicket(await ok('getProjectFileTicket',[fileId],'teacher2'));
  await denied('deleteProjectFile',[fileId],'teacher2');
  await ok('deleteProjectFile',[fileId],'teacher1');
  listed=(await ok('getProjectDocuments',[],'teacher1')).find(r=>r.id===doc.id);assert.equal(listed.files.length,0);
  await upload('project',doc.id);
  await denied('deleteProjectDocument',[doc.id],'teacher2');
  await ok('deleteProjectDocument',[doc.id],'teacher1');
  assert.equal((await query('SELECT id FROM project_files WHERE project_id=$1',[doc.id])).rows.length,0);
});

test('personal development file deletion and notification reads remain owner-scoped',async()=>{
  const activity=await ok('saveProfessionalDevelopmentActivity',[{title:MARK,type:'อบรม',startsAt:'2020-01-01T09:00',status:'ร่าง'}],'teacher1');
  const file=await upload('professional-development',activity.id);
  await denied('deleteProfessionalDevelopmentFile',[file.id],'teacher2');
  await readTicket(await ok('getProfessionalDevelopmentFileTicket',[file.id],'teacher1'));
  await ok('deleteProfessionalDevelopmentFile',[file.id],'teacher1');
  assert.equal((await query('SELECT id FROM professional_development_attachments WHERE id=$1',[file.id])).rows.length,0);
  const notification=(await ok('getProfessionalDevelopmentNotifications',[],'teacher1')).find(r=>r.activityId===activity.id);assert.ok(notification);
  await ok('markProfessionalDevelopmentNotificationRead',[notification.id],'teacher2');
  assert.equal((await query('SELECT read_at FROM professional_development_notifications WHERE id=$1',[notification.id])).rows[0].read_at,null);
  await ok('markProfessionalDevelopmentNotificationRead',[notification.id],'teacher1');
  assert.ok((await query('SELECT read_at FROM professional_development_notifications WHERE id=$1',[notification.id])).rows[0].read_at);
});

test('simple lesson and attendance history writes retain teacher identity and raw student IDs',async()=>{
  const session=`${DAY}|${SUB}|${CLS}|1`;
  await ok('saveLessonRecord',[{date:DAY,term:T,year:Y,subjectCode:SUB,subjectName:MARK,className:CLS,period:'1',topic:MARK,present:1,sessionId:session,teacherId:'teacher2'}],'teacher1');
  assert.equal((await query('SELECT teacher_id FROM academic_records WHERE subject_code=$1',[SUB])).rows[0].teacher_id,'teacher1');
  await ok('saveAttendanceBatch',[[{date:DAY,term:T,year:Y,subjectCode:SUB,subjectName:MARK,className:CLS,period:'1',studentId:SID,studentName:MARK,status:'มา'}]],'teacher1');
  const history=await ok('getTodayAttendanceHistory',[DAY,SUB,CLS],'teacher1');
  assert.equal(history[0].studentId,SID);assert.equal(history[0].status,'มา');
  const result=await ok('saveStudentRemarkDirectly',[SID,SUB,T,Y,'ร'],'teacher1');assert.equal(result.val,'ร');
  assert.equal((await query(`SELECT score FROM score_database WHERE student_id=$1 AND subject_code=$2 AND indicator_id='remark'`,[SID,SUB])).rows[0].score,'ร');
  await ok('saveStudentRemarkDirectly',[SID,SUB,T,Y,''],'teacher1');
  assert.equal((await query(`SELECT score FROM score_database WHERE student_id=$1 AND subject_code=$2 AND indicator_id='remark'`,[SID,SUB])).rows[0].score,'-');
});

test('review and assign/unassign/delete substitute actions update the real assignment lifecycle',async()=>{
  const leave=await ok('saveLeaveRequest',[{staffName:MARK,type:'ลาป่วย',startDate:DAY,endDate:DAY,year:Y,reason:MARK}],'teacher1');
  await ok('reviewLeave',[leave.id,'อนุมัติ','ตรวจแล้ว'],'admin');
  assert.equal((await query('SELECT status FROM leave_records WHERE id=$1',[leave.id])).rows[0].status,'อนุมัติ');
  assignmentId=(await query(`INSERT INTO substitute_assignments(leave_id,date,period,day_of_week,original_teacher_id,subject_code,class,status,note)
    VALUES($1,$2,'99','จันทร์','teacher1',$3,$4,'รอจัด',$5) RETURNING id`,[leave.id,DAY,SUB,CLS,MARK])).rows[0].id;
  await ok('assignSubstitute',[assignmentId,'teacher2',MARK,'forged'],'admin');
  let row=(await query('SELECT sub_teacher_id,status,assigned_by FROM substitute_assignments WHERE id=$1',[assignmentId])).rows[0];
  assert.deepEqual(row,{sub_teacher_id:'teacher2',status:'จัดแล้ว',assigned_by:'admin'});
  await denied('deleteSubstituteAssignment',[assignmentId],'admin');
  await ok('unassignSubstitute',[assignmentId],'admin');
  row=(await query('SELECT sub_teacher_id,status FROM substitute_assignments WHERE id=$1',[assignmentId])).rows[0];
  assert.deepEqual(row,{sub_teacher_id:null,status:'รอจัด'});
  await ok('deleteSubstituteAssignment',[assignmentId],'admin');
  assert.equal((await query('SELECT id FROM substitute_assignments WHERE id=$1',[assignmentId])).rows.length,0);
});

test('teacher club getters include their own club and assigned raw student member',async()=>{
  const club=await ok('createClub',[{clubName:MARK,term:T,year:Y,capacity:10,advisors:[{teacherId:'teacher1',teacherName:MARK}]}],'admin');
  await ok('adminAddMember',[club.clubId,SID],'admin');
  const clubs=await ok('getMyClubs',['teacher1',T,Y],'teacher1');
  assert.equal(clubs.find(r=>r.clubId===club.clubId).memberCount,1);
  const members=await ok('getClubMembersForTeacher',['teacher1',T,Y],'teacher1');
  assert.equal(members.find(r=>r.clubId===club.clubId).studentId,SID);
});

test('teacher page/menu reads return actual page markup and teacher options',async()=>{
  const page=await ok('getPage',['Page_Score_Entry'],'teacher1');assert.match(page,/scoreClassSelect/);
  const teacherName=(await query('SELECT full_name FROM users WHERE username=$1',['teacher1'])).rows[0].full_name;
  assert.ok((await ok('getTeacherListForDropdown',[],'admin')).includes(teacherName));
  assert.ok(Array.isArray(await ok('getTeacherTimetable',['teacher1'],'teacher1')));
});

test('school display-name setting updates without overwriting the prior setting after the test',async()=>{
  const old=(await query(`SELECT value1 FROM system_settings WHERE key='school_name' AND subkey=''`)).rows[0];
  try {
    await ok('saveSchoolInfo',[MARK,null,''],'admin');
    assert.equal((await query(`SELECT value1 FROM system_settings WHERE key='school_name' AND subkey=''`)).rows[0].value1,MARK);
  } finally {
    if(old)await query(`UPDATE system_settings SET value1=$1 WHERE key='school_name' AND subkey=''`,[old.value1]);
    else await query(`DELETE FROM system_settings WHERE key='school_name' AND subkey=''`);
    require('../lib/cache').del('system_config');
  }
});
