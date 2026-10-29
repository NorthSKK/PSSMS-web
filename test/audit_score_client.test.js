'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('src/Scripts_Score.html','utf8');
function fn(name){const a=source.indexOf('function '+name+'(');if(a<0)return '';let depth=0;for(let i=source.indexOf('{',a);i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(a,i+1);}throw Error(name);}
function harness(){const els={};for(const id of ['scoreClassSelect','scoreGridCard','btnSaveScores','scoreGridTitle','scoreTableBody','scoreTabs','edit-ratio-f','edit-ratio-m','edit-ratio-e','scoreRatioBadge'])els[id]={value:'',innerText:'',innerHTML:'',disabled:false,classList:{add(){},remove(){}}};
const calls=[],renders=[];let confirmation;const user={id:'teacher1',currentTerm:'2',currentYear:'2569'};let comp='0';
const c={console,document:{getElementById:id=>els[id]||null,querySelector:s=>s.includes('.qual-comp')?{value:comp}:null,querySelectorAll:()=>[]},getSessionUser:()=>user,normID:id=>String(id).replace(/^0+/,''),currentScoreConfig:null,currentScoreStudents:[],currentAttStats:{},currentAutoMs:{},currentAttDetails:{},currentAttSessions:[],isSavingScores:false,isHeaderEditMode:false,_scoreGridRequest:0,_scoreGridReadyKey:null,autoSaveTimer:null,retrySaveTimer:null,clearTimeout(){},setTimeout(){},showAlert(){},showToast(){},renderSkeletonTable(){},renderEvalTable(){},renderAllInOneTable(rows){renders.push(rows[0][0]);},Swal:{fire(){return{then(fn){confirmation=fn;}}}},safeRun(){let success,failure;return{withSuccessHandler(f){success=f;return this;},withFailureHandler(f){failure=f;return this;},getAllInOneScoreGridData(...args){calls.push({type:'load',args,success,failure});},saveSubjectConfig(payload){calls.push({type:'config',payload,success,failure});},saveAllInOneWithConfig(payload){calls.push({type:'save',payload,success,failure});}}}};
vm.createContext(c);vm.runInContext(['scoreGridContextKey','isCurrentScoreGrid','resetScoreGridState','scoreRatioPart','loadScoreGrid','saveAllInOneScores'].map(fn).join('\n'),c);
els['edit-ratio-f'].innerText='100';els['edit-ratio-m'].innerText='0';els['edit-ratio-e'].innerText='0';
return{c,els,calls,renders,user,choose(subject){els.scoreClassSelect.value=JSON.stringify([subject,'วิชา','ม.1/1']);c.loadScoreGrid();},reply(call,id){call.success({config:{ratio:'100:0:0',indicators:[]},students:[[id]],existingScores:{},existingQuals:{}});},confirm(){confirmation({isConfirmed:true});},comp(v){comp=String(v);}};}
test('late A reply never replaces B roster or saves A students into B',()=>{const h=harness();h.choose('A');h.choose('B');h.reply(h.calls[1],'01903');h.reply(h.calls[0],'01904');h.c.saveAllInOneScores();assert.deepEqual(h.renders,['01903']);const p=h.calls.find(c=>c.type==='save').payload;assert.equal(p.subjectCode,'B');assert.deepEqual(Array.from(p.qualRecords,r=>r.studentId),['01903']);});
test('loading and failed grids cannot submit previous roster',()=>{const h=harness();h.choose('A');h.reply(h.calls[0],'01903');h.choose('B');h.c.saveAllInOneScores();h.calls[1].failure({message:'offline'});h.c.saveAllInOneScores();assert.equal(h.calls.filter(c=>c.type==='save').length,0);assert.equal(h.els.btnSaveScores.disabled,true);});
test('old save response cannot enable save while new class is loading',()=>{const h=harness();h.choose('A');h.reply(h.calls[0],'01903');h.c.saveAllInOneScores();const save=h.calls[1];h.choose('B');save.success({status:'success'});assert.equal(h.els.btnSaveScores.disabled,true);});
test('confirmation after switching subject does not save old roster',()=>{const h=harness();h.choose('A');h.reply(h.calls[0],'01903');h.els['edit-ratio-f'].innerText='80';h.c.saveAllInOneScores();h.choose('B');h.reply(h.calls[1],'01904');h.confirm();assert.equal(h.calls.filter(c=>c.type==='save').length,0);});
test('all competency selections including zero are sent on save',()=>{for(const comp of [0,1,2,3]){const h=harness();h.choose('A');h.reply(h.calls[0],'01903');h.comp(comp);h.c.saveAllInOneScores();assert.equal(Number(h.calls[1].payload.qualRecords[0].comp),comp);}});
test('empty selection and page reset invalidate a pending response',()=>{const h=harness();h.choose('A');h.els.scoreClassSelect.value='';h.c.loadScoreGrid();h.reply(h.calls[0],'01903');assert.equal(h.renders.length,0);h.choose('B');if(h.c.resetScoreGridState)h.c.resetScoreGridState();h.reply(h.calls[1],'01904');assert.equal(h.renders.length,0);});

test('indicator modal preserves 100:0:0 and ignores response after switching class',()=>{
 const h=harness();h.choose('A');h.reply(h.calls[0],'01903');
 h.c.currentScoreConfig.indicators=[{description:''}];h.c.window={};h.c.bootstrap={Modal:{getInstance:()=>({hide(){}})}};
 h.els.editIndIdx={value:'0'};h.els.editIndDesc={value:'รายละเอียด'};
 const start=source.indexOf('window.saveIndicatorDetail = function() {');const end=source.indexOf('// ==========================================\n// 🚀 SMART',start);
 vm.runInContext(source.slice(start,end),h.c);h.c.window.saveIndicatorDetail();
 const call=h.calls[1];assert.deepEqual([call.payload.formative,call.payload.midterm,call.payload.final],[100,0,0]);
 let refreshed=false;h.c.refreshTableOnly=()=>refreshed=true;h.choose('B');call.success({status:'success'});assert.equal(refreshed,false);
});

test('refresh after editing headers retains leading-zero student scores and competency selection',()=>{
 const h=harness();h.els.scoreClassSelect.value=JSON.stringify(['A','วิชา','ม.1/1']);
 h.els.scoreTableHeader={innerHTML:''};
 h.c.currentScoreConfig={ratio:'70:10:20',indicators:[{name:'งาน',score:70}]};
 h.c.currentScoreStudents=[['01903','','นักเรียน','Student','ม.1/1','','2569','ปกติ',1]];
 h.c.sgsColumnStates={};h.c.isQualVisible=true;h.c.reCalcAllRows=()=>{};
 h.c.compareStudentRows=()=>0;h.c.studentNoLabel=r=>r[8];
 const values={'.midterm-std-1903':'17','.midterm-re-std-1903':'0','.final-std-1903':'19','.remark-select[data-safeid="1903"]':'ร','.qual-read[data-safeid="1903"]':'1','.qual-char[data-safeid="1903"]':'2','.qual-comp[data-safeid="1903"]':'0'};
 h.c.document.querySelector=selector=>Object.hasOwn(values,selector)?{value:values[selector]}:null;
 h.c.document.querySelectorAll=selector=>selector==='.formative-std-1903'?[{value:'23'}]:[];
 vm.runInContext(fn('refreshTableOnly')+'\n'+fn('renderAllInOneTable'),h.c);h.c.refreshTableOnly();
 const html=h.els.scoreTableBody.innerHTML;
 for(const [cls,value] of [['formative-std-1903','23'],['midterm-std-1903','17'],['midterm-re-std-1903','0'],['final-std-1903','19']]){
   const input=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).find(tag=>tag.includes(cls));assert.ok(input,cls);assert.ok(input.includes('value="'+value+'"'),input);
 }
 assert.match(html,/01903/);
 const comp=html.match(/<select class="qual-select qual-comp[\s\S]*?<\/select>/)[0];assert.match(comp,/value="0" selected/);
 assert.match(html,/<option value="ร" selected/);
});
