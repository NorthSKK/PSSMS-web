"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(opts={}) {
 let state={club:opts.club||null,advisors:['old'],members:[]},snapshot;
 const deleted=[],calls=[];
 const query=async(sql,args=[])=>{
  calls.push(sql);
  if(sql==='BEGIN'){snapshot=structuredClone(state);return {rows:[]};}
  if(sql==='ROLLBACK'){state=snapshot;return {rows:[]};}
  if(sql==='COMMIT')return {rows:[]};
  if(sql.startsWith('SELECT term'))return {rows:state.club?[state.club]:[]};
  if(sql.includes('SELECT capacity'))return {rows:state.club?[state.club]:[]};
  if(sql.includes('SELECT club_id FROM club_members'))return {rows:[]};
  if(sql.includes('SELECT COUNT'))return {rows:[{n:state.members.length}]};
  if(sql.startsWith('INSERT INTO clubs')){state.club={term:args[4],year:args[5],status:args[6],capacity:args[3]};return {rows:[]};}
  if(sql.startsWith('UPDATE clubs'))return {rows:[]};
  if(sql.startsWith('DELETE FROM club_advisors')){state.advisors=[];return {rows:[]};}
  if(sql.includes('INSERT INTO club_advisors')){if(opts.failAdvisor)throw Error('advisor write failed');state.advisors.push(args[1]);return {rows:[]};}
  if(sql.includes('INSERT INTO club_members')){state.members.push(args[1]);return {rows:[]};}
  throw Error(sql);
 };
 const context={module:{exports:{}},require(name){
  if(name==='../lib/db')return{query,pool:{connect:async()=>({query,release(){}})}};
  if(name==='../lib/cache')return{del:key=>deleted.push(key)};
  if(name==='../lib/permissions')return{verifyTeacherOwnsSubject:async()=>{}};
  throw Error(name);
 }};
 vm.runInNewContext(fs.readFileSync('functions/clubs_write.js','utf8'),context);
 return{api:context.module.exports,state:()=>state,deleted,calls};
}
const club={term:'2',year:'2569',status:'open',capacity:10};
test('creating a club rolls back its row when saving an advisor fails',async()=>{
 const s=setup({failAdvisor:true});await assert.rejects(s.api.createClub([{clubName:'ทดสอบ',term:'2',year:'2569',advisors:[{teacherId:'teacher1'}]}]),/advisor write failed/);
 assert.equal(s.state().club,null);assert.deepEqual(s.deleted,[]);
});
test('updating advisors preserves the previous assignment on save failure',async()=>{
 const s=setup({club,failAdvisor:true});await assert.rejects(s.api.updateClub([{clubId:'C1',advisors:[{teacherId:'new'}]}],{}),/advisor write failed/);
 assert.deepEqual(s.state().advisors,['old']);assert.deepEqual(s.deleted,[]);
});
test('open club registration preserves raw student ID and invalidates its term cache',async()=>{
 const s=setup({club});await s.api.registerClub(['01903','ชื่อ','ม.1/1','C1','2','2569','01903']);assert.deepEqual(s.state().members,['01903']);assert.deepEqual(s.deleted,['clubs_2_2569']);
});
