'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('functions/missing.js', 'utf8');
function extract(name) {
  const start = source.indexOf('async function '+name+'(');
  let depth=0;
  for(let i=source.indexOf('{',start);i<source.length;i++) {
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
}
function setup(existing = [{ club_id:'old', term:'1', year:'2568' }], status = 'ปกติ') {
  const inserted=[],deleted=[];
  const ctx={cache:{del:k=>deleted.push(k)},query:async(sql,args)=>{
    if(sql.startsWith('SELECT term'))return {rows:[{term:'2',year:'2569',capacity:0}]};
    if(sql.includes('FROM users'))return {rows:[{username:'01903',full_name:'นักเรียน',department:'ม.1/1',status}]};
    if(sql.includes('FROM club_members')&&sql.startsWith('SELECT'))return {rows:existing.filter(r=>args.length===1||r.term===args[1]&&r.year===args[2])};
    if(sql.includes('INSERT INTO club_members')){inserted.push(args);return {rows:[],rowCount:1};}
    if(sql.startsWith('DELETE'))return {rows:[{term:'2',year:'2569'}],rowCount:1};
    throw Error(sql);
  }};
  vm.createContext(ctx);vm.runInContext(['adminAddMember','adminRemoveMember','deleteClub'].map(extract).join('\n'),ctx);
  return {ctx,inserted,deleted};
}
test('past-term membership does not block adding a student to this term',async()=>{
  const s=setup();const res=await s.ctx.adminAddMember(['new','01903']);
  assert.equal(res.status,'success');assert.equal(s.inserted.length,1);
  assert.deepEqual(Array.from(s.inserted[0]).slice(0,2),['new','01903']);assert.deepEqual(Array.from(s.inserted[0]).slice(4),['2','2569']);
  assert.deepEqual(s.deleted,['clubs_2_2569']);
});
for (const status of ['แขวนลอย', 'จบการศึกษา']) test('cannot add club member with status '+status, async()=>{
  const s=setup([],status);
  await assert.rejects(s.ctx.adminAddMember(['new','01903']),/ไม่สามารถเพิ่มสมาชิก.*สถานะ/);
  assert.equal(s.inserted.length,0);
  assert.deepEqual(s.deleted,[]);
});
test('membership in another club this term is an error, not an already-success response',async()=>{
  const s=setup([{club_id:'other',term:'2',year:'2569'}]);
  await assert.rejects(s.ctx.adminAddMember(['new','01903']),/ชุมนุมอื่น/);assert.equal(s.inserted.length,0);
});
test('same-club membership is idempotent',async()=>{
  const s=setup([{club_id:'new',term:'2',year:'2569'}]);
  assert.equal((await s.ctx.adminAddMember(['new','01903'])).status,'already');assert.equal(s.inserted.length,0);
});
for(const name of ['adminRemoveMember','deleteClub'])test(name+' invalidates the actual club list cache',async()=>{
 const s=setup();await s.ctx[name](['new','01903']);assert.deepEqual(s.deleted,['clubs_2_2569']);
});
