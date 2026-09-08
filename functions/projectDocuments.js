'use strict';
const { query } = require('../lib/db');
const { isAdmin } = require('../lib/permissions');
const storage = require('../lib/storage');

const MAX_ATTACH_MB = 100;
const CATEGORIES = ['โครงการ', 'แผนงาน', 'รายงาน', 'เอกสารประกอบ'];
const idOf = user => String(user?.id || '').trim();
function assertOwner(user, row, message) {
  if (!isAdmin(user) && (!row || String(row.owner_id || '') !== idOf(user))) throw new Error(message);
}
function clean(value, max) { return String(value || '').trim().slice(0, max); }

async function getProjectDocuments(_args, user) {
  const { rows } = await query(`SELECT p.id,p.title,p.category,p.description,p.owner_id,p.owner_name,
      to_char(p.updated_at,'YYYY-MM-DD HH24:MI') updated_at,
      COALESCE(json_agg(json_build_object('id',f.id,'name',f.file_name,'size',f.file_size)
        ORDER BY f.id) FILTER (WHERE f.id IS NOT NULL),'[]'::json) files
    FROM project_documents p LEFT JOIN project_files f ON f.project_id=p.id
    GROUP BY p.id ORDER BY p.updated_at DESC,p.id DESC`);
  return rows.map(r => ({ id:r.id, title:r.title, category:r.category || 'โครงการ', description:r.description || '', ownerName:r.owner_name,
    updatedAt:r.updated_at, files:r.files || [], mine:isAdmin(user) || String(r.owner_id) === idOf(user) }));
}

async function saveProjectDocument([data], user) {
  const d = data || {}, title = clean(d.title, 160), description = clean(d.description, 2000), id = Number(d.id);
  const category = CATEGORIES.includes(d.category) ? d.category : 'โครงการ';
  if (!title) throw new Error('กรุณาระบุชื่อเอกสาร');
  if (Number.isInteger(id) && id > 0) {
    const { rows } = await query('SELECT owner_id FROM project_documents WHERE id=$1', [id]);
    if (!rows[0]) throw new Error('ไม่พบเอกสารนี้');
    assertOwner(user, rows[0], 'แก้ไขได้เฉพาะเอกสารของคุณ');
    await query('UPDATE project_documents SET title=$1,category=$2,description=$3,updated_at=NOW() WHERE id=$4', [title,category,description,id]);
    return { status:'success', message:'บันทึกเอกสารแล้ว', id };
  }
  const owner = await query('SELECT full_name FROM users WHERE username=$1', [idOf(user)]);
  const ownerName = String((owner.rows[0] && owner.rows[0].full_name) || user?.name || '');
  const { rows } = await query(`INSERT INTO project_documents(title,category,description,owner_id,owner_name)
    VALUES($1,$2,$3,$4,$5) RETURNING id`, [title,category,description,idOf(user),ownerName]);
  return { status:'success', message:'สร้างเอกสารแล้ว', id:rows[0].id };
}
async function project(id) { return (await query('SELECT id,owner_id FROM project_documents WHERE id=$1',[id])).rows[0]; }

async function attachProjectFile(id, file, user) {
  const projectId = Number(id), row = await project(projectId);
  if (!Number.isInteger(projectId) || !row) throw new Error('ไม่พบเอกสารนี้');
  assertOwner(user,row,'แนบไฟล์ได้เฉพาะเอกสารของคุณ');
  const saved = await storage.put({ buffer:file.buffer, ext:file.detectedExt });
  try {
    await query('INSERT INTO project_files(project_id,file_key,file_name,file_size) VALUES($1,$2,$3,$4)',
      [projectId,saved.key,clean(file.originalname,255) || ('เอกสาร.' + file.detectedExt),saved.size]);
    await query('UPDATE project_documents SET updated_at=NOW() WHERE id=$1',[projectId]);
  } catch (err) { await storage.remove(saved.key).catch(() => {}); throw err; }
  return { status:'success', message:'แนบไฟล์แล้ว' };
}
async function deleteProjectDocument([id], user) {
  const row = await project(Number(id));
  if (!row) throw new Error('ไม่พบเอกสารนี้');
  assertOwner(user,row,'ลบได้เฉพาะเอกสารของคุณ');
  const files = await query('SELECT file_key FROM project_files WHERE project_id=$1',[row.id]);
  for (const file of files.rows) await storage.remove(file.file_key);
  await query('DELETE FROM project_documents WHERE id=$1',[row.id]);
  return { status:'success', message:'ลบเอกสารแล้ว' };
}
async function deleteProjectFile([id], user) {
  const { rows } = await query(`SELECT f.id,f.file_key,f.project_id,p.owner_id FROM project_files f
    JOIN project_documents p ON p.id=f.project_id WHERE f.id=$1`,[Number(id)]);
  const file=rows[0]; if (!file) throw new Error('ไม่พบไฟล์นี้');
  assertOwner(user,file,'ลบไฟล์ได้เฉพาะเอกสารของคุณ');
  await storage.remove(file.file_key); await query('DELETE FROM project_files WHERE id=$1',[file.id]);
  await query('UPDATE project_documents SET updated_at=NOW() WHERE id=$1',[file.project_id]);
  return { status:'success', message:'ลบไฟล์แล้ว' };
}
async function getProjectFileTicket([id], user) {
  const { rows }=await query('SELECT id,file_key,file_name FROM project_files WHERE id=$1',[Number(id)]);
  const file=rows[0]; if (!file) throw new Error('ไม่พบไฟล์นี้');
  return { url:await storage.getFileUrl({kind:'project',id:file.id,key:file.file_key,filename:file.file_name,user}) };
}
module.exports={MAX_ATTACH_MB,CATEGORIES,getProjectDocuments,saveProjectDocument,attachProjectFile,deleteProjectDocument,deleteProjectFile,getProjectFileTicket};
