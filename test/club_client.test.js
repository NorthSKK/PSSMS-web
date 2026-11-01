'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const admin=fs.readFileSync('src/Scripts_Admin.html','utf8'),teacher=fs.readFileSync('src/Scripts_Teacher.html','utf8');
function fn(s,n){let a=s.indexOf('function '+n+'('),depth=0;assert.ok(a>=0,n);for(let i=s.indexOf('{',a);i<s.length;i++){if(s[i]==='{')depth++;if(s[i]==='}'&&--depth===0)return s.slice(a,i+1);}throw Error(n);}
function state(names){const elements={},calls=[],alerts=[];const element=id=>elements[id]||(elements[id]={value:'',innerHTML:'',textContent:'',disabled:false});let closed=0,reloads=0;
const ctx={allUsers:[],_clubTeacherList:[],_clubSelectedAdvisors:{},_currentClubForMembers:null,_clubMembersCache:[],_clubList:[],_clubUsersLoading:false,_clubUsersLoaded:false,_clubTeachersLoading:false,_clubTeachersLoaded:false,localStorage:{getItem:()=>JSON.stringify({currentTerm:'2',currentYear:'2569'})},document:{getElementById:element},escapeHtmlSafe:s=>s,showAlert:m=>alerts.push(m),_skelCards:()=>'',loadClubMembersData(){},loadMembersStudentList(){},loadClubList(){reloads++;},bootstrap:{Modal:class{show(){}static getInstance(){return{hide(){closed++;}}}}},google:{script:{get run(){let success,failure;const chain={withSuccessHandler(f){success=f;return this;},withFailureHandler(f){failure=f;return this;}};for(const action of ['getAllUsers','getTeacherListForClubDropdown','createClub','updateClub'])chain[action]=payload=>calls.push({action,payload,success,failure});return chain;}}}};vm.createContext(ctx);vm.runInContext(['isEligibleClubMember',...names].map(n=>fn(admin,n)).join('\n'),ctx);return{ctx,element,calls,alerts,closed:()=>closed,reloads:()=>reloads};}
test('members opened before user API completes receive classroom choices; failed loads can retry',()=>{const s=state(['openClubMembers','loadClubUsers','renderClubMemberClasses']);s.ctx.openClubMembers('C','ชุมนุม','2','2569');assert.equal(s.element('clubMembersClassFilter').disabled,true);s.calls[0].failure({message:'offline'});assert.match(s.element('clubMembersStudentList').innerHTML,/ลองใหม่/);s.ctx.loadClubUsers();s.calls[1].success([['01903','','เด็ก','Student','ม.1/1']]);assert.equal(s.element('clubMembersClassFilter').disabled,false);assert.match(s.element('clubMembersClassFilter').innerHTML,/ม.1\/1/);s.element('clubMembersClassFilter').value='ม.1/1';s.ctx.renderClubMemberClasses();assert.equal(s.element('clubMembersClassFilter').value,'ม.1/1');});
test('advisor response rerenders an already open form and retains selected advisors',()=>{const s=state(['loadTeacherListForClubs','renderAdvisorList']);s.ctx._clubSelectedAdvisors={teacher1:true};s.ctx.loadTeacherListForClubs();s.calls[0].success([{id:'teacher1',name:'ครูหนึ่ง'}]);assert.match(s.element('clubFormAdvisors').innerHTML,/checked/);});
test('save failure restores button and values, retry sends once and closes only on success',()=>{const s=state(['submitClubForm']);s.element('clubFormName').value='ดนตรี';s.element('clubFormCapacity').value='30';s.element('clubFormStatus').value='open';s.ctx.submitClubForm();s.ctx.submitClubForm();assert.equal(s.calls.length,1);assert.equal(typeof s.calls[0].failure,'function');s.calls[0].failure({message:'offline'});assert.equal(s.element('clubFormSubmit').disabled,false);assert.equal(s.element('clubFormName').value,'ดนตรี');assert.equal(s.closed(),0);s.ctx.submitClubForm();s.calls[1].success({status:'success'});assert.equal(s.closed(),1);assert.equal(s.reloads(),1);});
test('teacher multiple club selector resolves lexical club state when clicked',()=>{const sel={innerHTML:'',classList:{remove(){}}};let chosen;const ctx={window:{},document:{getElementById:()=>sel},_tcEsc:s=>s,_tcSelectClub:c=>chosen=c};vm.createContext(ctx);vm.runInContext('let _tcMyClubs=[{clubName:"หนึ่ง"},{clubName:"สอง"}];'+fn(teacher,'_tcRenderSelector')+';_tcRenderSelector(_tcMyClubs);',ctx);const handlers=[...sel.innerHTML.matchAll(/onclick="([^"]+)"/g)].map(m=>m[1]);vm.runInContext(handlers[1],ctx);assert.equal(chosen.clubName,'สอง');});

test('club member choices exclude suspended/graduated students without hiding existing members',()=>{
  const s=state(['renderClubMemberClasses','loadMembersStudentList','renderClubMembersList']);
  s.ctx.escapeAttr=s=>s;
  const row=(id,name,cls,status)=>[id,'',name,'Student',cls,'','2569',status];
  s.ctx.allUsers=[row('01903','ปกติ','ม.1/1','ปกติ'),row('01904','แขวน','ม.1/1',' แขวนลอย '),row('01905','จบ','ม.1/1','จบการศึกษา'),row('01906','เดิม','ม.1/1',''),row('01907','อื่น','ม.1/1','ย้ายออก'),row('01908','แขวนล้วน','ม.2/1','แขวนลอย'),row('01909','จบล้วน','ม.3/1','จบการศึกษา'),['teacher1','','ครู','Teacher','ม.4/1']];
  s.ctx._clubMembersCache=[{studentId:'01905',studentName:'จบเดิม',className:'ม.1/1'}];
  s.ctx.renderClubMemberClasses();
  assert.match(s.element('clubMembersClassFilter').innerHTML,/ม.1\/1/);
  for(const cls of ['ม.2/1','ม.3/1','ม.4/1'])assert.equal(s.element('clubMembersClassFilter').innerHTML.includes(cls),false);
  s.element('clubMembersClassFilter').value='ม.1/1';s.ctx.loadMembersStudentList();
  const html=s.element('clubMembersStudentList').innerHTML;
  for(const id of ['01903','01906','01907'])assert.ok(html.includes(id),id);
  for(const id of ['01904','01905'])assert.equal(html.includes(id),false,id);
  s.ctx.renderClubMembersList(s.ctx._clubMembersCache);
  assert.match(s.element('clubMembersList').innerHTML,/01905/);
  assert.equal(s.ctx._clubMembersCache.length,1);
});
