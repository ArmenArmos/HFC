/** Real nurse view and scroll hooks; synthetic records and action IO. No auth, secrets or DB. */
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(resolve('package.json'));
const {webpack}=require('next/dist/compiled/webpack/webpack');
export async function startNurseChatFixture(){
 const root=resolve('.'),directory=mkdtempSync(join(tmpdir(),'noreon-nurse-chat-v2-'));
 const actions=join(root,'e2e/nurse-chat-v2/actions.ts');
 await new Promise((done,reject)=>webpack({
  mode:'development',devtool:false,context:root,entry:join(root,'e2e/nurse-chat-v2/entry.tsx'),output:{path:directory,filename:'chat.js'},
  resolve:{extensions:['.tsx','.ts','.js'],alias:{...Object.fromEntries(['@/lib/care-alerts/actions','@/lib/staff/chat-member-identity-actions','@/lib/staff/real-coordination/actions','@/lib/nurse-chat/actions','@/lib/nurse-chat/handoff-actions','@/lib/nurse-chat/cohort-actions','@/lib/nurse-chat/today-actions','@/lib/nurse-chat/v2-actions','@/lib/nurse-chat/v2-zoe-actions','@/lib/nurse-chat/v2-notes-actions','@/lib/nurse-visit/actions','@/lib/staff/staff-locale-actions','@/lib/staff/nurse-actions','@/lib/patient-care/clinical-actions'].map(name=>[name+'$',actions])),'next/link$':join(root,'e2e/nurse-chat-v2/inline.tsx'),'@/components/patient-care/common$':join(root,'e2e/nurse-chat-v2/inline.tsx'),'@':root}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(root,'e2e/nurse-chat-v2/loader.cjs')}]},
 },(error,stats)=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true,moduleTrace:true}))):done()));
 let state='',long=false,items=[],version=1,stale=false,thrown=false,reads=0;
 const requests=[],saved=new Map(),handoffRequests=[],handoffs=[],savedHandoffs=new Map();
 let handoffReadFails=false,keepNextOpen=false;
 const taskRequests=[],taskReads=[],taskPageRequests=[],tasks=new Map();
 const noteRequests=[],notes=[],zoeQuestionRequests=[],zoeOpenRequests=[],zoeHistoryRequests=[];
 let noteRevision=1,noteThrown=false,noteStale=false;
 const id=n=>`aa220000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 function incoming(){version++;items.push({id:id(items.length+1),senderRole:'member',senderName:'Ani Example',text:'A new member message',at:new Date().toISOString()});}
 function handoff(request,taskId,at){return {messageId:request.messageId,messageText:items.find(i=>i.id===request.messageId)?.text??'',topic:request.topic,observation:request.observation,nurseName:'Narine Example',task:{id:taskId,caseId:request.memberId,memberName:'Ani Example',kind:'doctor-referral',title:'Handoff',instructions:'Review',dueAt:null,creatorId:id(2000),ownerId:id(2001),ownerName:'Doctor Example',status:'awaiting-doctor',revision:1,createdAt:at,updatedAt:at,needsReassignment:false,eligibleOwners:[],events:[]}};}
 const member={id:'aa110000-0000-4000-8000-000000000001',name:'Ani Example',birthYear:1986,birthDate:'1986-01-01',phoneLast4:'1234'};
 const taskId=id(3000),visitId=id(4000),deviceId=id(4001),earlierVisitId=id(4002),futureVisitId=id(4003),completedVisitId=id(4004);
 const visitRequests=[],visitReads=[],visitSaved=new Map();
 let visitDetail;
 const check=(checkId,section,en)=>({key:`check:${checkId}`,kind:'check',checkId,section,version:'protocol-draft-1',label:{en,hy:en},source:'Laboratory protocol v2, section 1',mark:null});
 function counts(){
  const samples=visitDetail.items.filter(item=>item.kind==='sample');
  return {samplesPlanned:samples.length,samplesTaken:samples.filter(item=>item.mark?.done).length,bpTaken:!!visitDetail.items.find(item=>item.key==='measure:bp')?.mark?.done,deviceDone:!!visitDetail.items.find(item=>item.kind==='device')?.mark?.done,openItems:visitDetail.items.filter(item=>!item.mark?.done).map(item=>item.key)};
 }
 function seedVisit(){
  const visit={id:visitId,source:'appointment',memberId:member.id,memberName:member.name,startsAt:'2026-11-01T09:00:00Z',endsAt:'2026-11-01T10:00:00Z',mode:'home',location:'Example address',bookingStatus:'confirmed',completion:null};
  visitDetail={version:'nurse-visit-v1',enabled:true,visit,items:[
   {key:`device:${deviceId}`,kind:'device',assignmentId:deviceId,serial:'DEMO-101',model:'Example BP monitor',mark:null},
   {key:'measure:bp',kind:'measurement',field:'bp',mark:null},
   check('bp-validated-device','bp','Use a validated upper-arm blood pressure monitor and check that it works.'),
   {key:'sample:hba1c-glucose',kind:'sample',testId:'hba1c-glucose',title:'Fasting glucose',mark:null},
   check('urgent-symptoms','safety','Ask about chest pain, severe breathlessness, new neurological symptoms, confusion or sudden worsening of vision. If any is present, get urgent medical help now (call 103). Do not wait for tests or the app.'),
   {key:'measure:weight',kind:'measurement',field:'weight',mark:null},
   check('fasting-8h','sampling','Fasting glucose is ordered: confirm the member has had no food with calories for at least 8 hours.'),
   {key:'measure:waist',kind:'measurement',field:'waist',mark:null},
  ],steps:[],checklistVersion:'protocol-draft-1',caseRevision:1,today:'2026-11-01',completion:null};
  if(state==='visit-to-weight'){
   visitDetail.steps=[{step:'confirmed',at:'2026-11-01T08:05:00Z',by:'Narine Example'},{step:'started',at:'2026-11-01T09:00:00Z',by:'Narine Example'},{step:'samples-collected',at:'2026-11-01T09:02:00Z',by:'Narine Example'},{step:'samples-at-lab',at:'2026-11-01T09:03:00Z',by:'Narine Example'}];
   visitDetail.items.forEach((item,i)=>{if(item.key!=='measure:weight'&&item.key!=='measure:waist'&&item.kind!=='device')item.mark={done:true,note:null,values:item.key==='measure:bp'?{systolic:120,diastolic:80,pulse:65}:null,recordedAt:new Date(Date.UTC(2026,10,1,9,i)).toISOString(),nurseName:'Narine Example'};});
  }
  if(state==='visit-saved'){
   visitDetail.steps=[{step:'confirmed',at:'2026-11-01T08:05:00Z',by:'Narine Example'},{step:'started',at:'2026-11-01T09:00:00Z',by:'Narine Example'}];
   visitDetail.items.find(item=>item.key==='measure:weight').mark={done:true,note:'Latest saved weight',values:{value:72},recordedAt:'2026-11-01T09:05:00Z',nurseName:'Narine Example'};
   visitDetail.items.find(item=>item.key==='check:urgent-symptoms').mark={done:true,note:'Safety checked',values:null,recordedAt:'2026-11-01T09:01:00Z',nurseName:'Narine Example'};
  }
  if(state==='visit-all-done'){
   visitDetail.items.forEach((item,i)=>{item.mark={done:true,note:null,values:item.kind==='measurement'?(item.field==='bp'?{systolic:120,diastolic:80,pulse:65}:{value:item.field==='weight'?72:85}):null,recordedAt:new Date(Date.UTC(2026,10,1,9,i)).toISOString(),nurseName:'Narine Example'};});
   visitDetail.steps=['confirmed','started','samples-collected','samples-at-lab'].map((step,i)=>({step,at:new Date(Date.UTC(2026,10,1,8,i)).toISOString(),by:'Narine Example'}));
  }
  visitDetail.counts=counts();
 }
 function visitRow(){return {...visitDetail.visit,samplesPlanned:visitDetail.counts.samplesPlanned,samplesTaken:visitDetail.counts.samplesTaken,openItems:visitDetail.counts.openItems.length,steps:visitDetail.steps,nurseName:'Narine Example'};}

 function seedTasks(){
  const base={caseId:member.id,memberName:member.name,kind:'contact-followup',instructions:'Contact the member and record the outcome.',dueAt:'2026-11-01T09:00:00Z',creatorId:id(2000),ownerId:id(2001),ownerName:'Narine Example',status:'open',revision:1,createdAt:'2026-10-30T08:00:00Z',updatedAt:'2026-10-30T08:00:00Z',needsReassignment:false,eligibleOwners:[],events:[]};
  [
   {id:taskId,title:'Confirm the visit time'},
   {id:id(3001),title:'Future task',dueAt:'2026-11-03T09:00:00Z'},
   {id:id(3002),title:'Completed task',status:'completed'},
   {id:id(3003),title:'Collect home readings',status:'awaiting-member',kind:'evidence-collection',dueAt:'2026-10-30T09:00:00Z'},
   {id:id(3004),title:'Doctor review requested',status:'awaiting-doctor',kind:'doctor-referral'},
   {id:id(3005),title:'Referral still open',kind:'doctor-referral'},
   {id:id(3006),title:'Assign a new nurse',needsReassignment:true},
   {id:id(3007),title:'Awaiting doctor task',status:'awaiting-doctor',revision:2,events:[{id:1,revision:2,request_id:id(4001),actor_id:id(2001),actor_name:'Narine Example',actor_role:'nurse',operation:'contact',old_status:'open',new_status:'awaiting-doctor',old_owner_id:id(2001),new_owner_id:id(2001),note:'Left a voicemail',care_note_id:null,detail:{input:{outcome:'unreachable'}},created_at:'2026-10-31T09:00:00Z'}]},
   {id:id(3008),title:'Cancelled task',status:'cancelled'},
  ].forEach(task=>{
   const doctor=task.kind==='doctor-referral';
   const owner={id:doctor?id(2002):base.ownerId,name:doctor?'Doctor Example':base.ownerName,role:doctor?'doctor':'nurse'};
   tasks.set(task.id,{...base,...task,ownerId:owner.id,ownerName:owner.name,eligibleOwners:task.needsReassignment?[]:[owner]});
  });
 }
 const today=()=>({ok:true,identities:state==='identity-failed'?[]:[member],asOf:'2026-11-01T08:00:00Z',alerts:state==='urgent'?{kind:'ready',total:1,alerts:[{id:'ad440000-0000-4000-8000-000000000001',memberId:member.id,memberName:'Test Patient',source:'zoe',priority:'urgent',reason:'zoe_self_harm',redFlags:[],state:'open',stateSeq:0,occurrences:1,createdAt:'2026-11-01T07:00:00Z',lastSeenAt:'2026-11-01T07:00:00Z',acknowledgedAt:null}]}:state==='alerts-failed'?{kind:'unavailable'}:{kind:'off'},page:{tasks:state==='empty'?[]:[...tasks.values()].filter(task=>state!=='task-only'||task.id===taskId),nextCursor:null},visits:state==='partial'?null:state==='visits-off'?{enabled:false,visits:[]}:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:state==='empty'?[]:[
  {...visitRow(),id:id(4002),memberName:'Older Example',startsAt:'2026-10-30T09:00:00Z'},
  visitRow(),
  {...visitRow(),id:futureVisitId,memberName:'Future Example',startsAt:'2026-11-04T09:00:00Z',endsAt:'2026-11-04T10:00:00Z',completion:null,steps:[]},
  {...visitRow(),id:completedVisitId,memberName:'Completed Example',startsAt:'2026-10-31T09:00:00Z',bookingStatus:'completed',completion:{completedAt:'2026-10-31T10:00:00Z',nurseName:'Narine Example',summary:visitDetail.counts},steps:[]},
 ]}});
 function completeTask(request){
  let task=tasks.get(request.taskId);
  if(!task&&request.operation==='create'){
   task={...tasks.get(taskId),id:request.taskId,caseId:request.caseId,...request.input,status:'open',revision:0,createdAt:'2026-11-02T09:01:00Z',events:[]};
   tasks.set(task.id,task);
  }
  if(!task||task.events.some(event=>event.request_id===request.requestId))return task;
  const previous=task.status,oldOwner=task.ownerId;
  const statuses={complete:'completed',resolve:'completed',cancel:'cancelled',refer:'awaiting-doctor','await-member':'awaiting-member',reopen:'open'};
  task.status=statuses[request.operation]??task.status;
  if(request.operation==='edit')Object.assign(task,request.input);
  if(request.operation==='reassign'){task.ownerId=request.input.ownerId;task.needsReassignment=false;task.ownerName='Reassigned nurse';}
  task.revision++;task.updatedAt='2026-11-02T09:01:00Z';
  task.events.push({id:task.events.length+1,revision:task.revision,request_id:request.requestId,actor_id:id(2001),actor_name:'Narine Example',actor_role:'nurse',operation:request.operation,old_status:previous,new_status:task.status,old_owner_id:oldOwner,new_owner_id:task.ownerId,note:request.input.note??'',care_note_id:null,detail:{input:request.input},created_at:task.updatedAt});
  return task;
 }
 const respond=async(address,method='GET',body='')=>{
  const url=new URL(address),result=(body,contentType='application/json')=>({status:200,body:typeof body==='string'?body:JSON.stringify(body),contentType});
  if(url.pathname==='/chat.js')return result(readFileSync(join(directory,'chat.js'),'utf8'),'text/javascript');
  if(url.pathname==='/chat.css')return result(readFileSync(join(root,'components/chat-v2/chat.css'),'utf8')+'\n'+readFileSync(join(root,'components/nurse-chat-v2/nurse-chat.css'),'utf8'),'text/css');
  if(method==='POST'){
   if(url.pathname==='/fixture/zoe-question'){
    const request=JSON.parse(body);zoeQuestionRequests.push(request);
    if(state.startsWith('zoe-question-'))return result({kind:state.slice('zoe-question-'.length)});
    if(request.question.includes('Ani Example'))return result({kind:'member',memberId:member.id,memberName:member.name});
    if(request.question.includes('Ani'))return result({kind:'choose',rows:[member,{id:id(9999),name:'Ani Other'}]});
    return result({kind:request.current?'keep':'none'});
   }
   if(url.pathname==='/fixture/zoe-open'){
    const request=JSON.parse(body);zoeOpenRequests.push(request);
    if(state==='zoe-open-refused')return result({kind:'refused'});
    if(state==='zoe-open-failed')return result({ok:false});
    return result({ok:true,conversationId:id(request.memberId===member.id?8000:8001)});
   }
   if(url.pathname==='/fixture/zoe-history'){
    zoeHistoryRequests.push(JSON.parse(body));
    if(state==='zoe-history-failed')return result({kind:'unavailable'});
    const target={conversationId:id(8000),memberId:member.id,memberName:member.name,savedAt:'2026-11-02T08:00:00Z'};
    return result({kind:'history',conversations:state==='zoe-history'?[target]:[],target:state==='zoe-history'?target:null,turns:state==='zoe-history'?[{...target,key:'saved-question',seq:1,role:'staff',text:'Earlier nurse question',content:null}]:[]});
   }
   if(url.pathname==='/fixture/task-page'){
    const request=JSON.parse(body);taskPageRequests.push(request);
    if(state==='task-page-failed')return result({ok:false,error:'Current tasks could not load. Check your access and try again.'});
    let rows=state==='empty'?[]:[...tasks.values()].filter(task=>(!request.caseId||task.caseId===request.caseId)&&(request.filter==='all'?true:request.filter==='active'?!['completed','cancelled'].includes(task.status):request.filter==='reassign'?task.needsReassignment:task.status===request.filter));
    rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    if(request.cursor)rows=rows.filter(task=>task.createdAt<request.cursor.createdAt||task.createdAt===request.cursor.createdAt&&task.id<request.cursor.id);
    const page=rows.slice(0,3),last=page.at(-1);
    return result({ok:true,page:{tasks:page,nextCursor:rows.length>3?{createdAt:last.createdAt,id:last.id}:null}});
   }
   if(url.pathname==='/fixture/visits'){
    if(state==='visits-failed')return result({status:'unavailable'});
    if(state==='visits-denied'||state==='visits-off')return result({status:'refused'});
    const data=today().visits;return result(data?.enabled?{status:'ready',data}:{status:'refused'});
   }
   if(url.pathname==='/fixture/notes'){
    const {memberId}=JSON.parse(body);
    if(state==='notes-failed'||state==='note-read-failed')return result({kind:'unavailable'});
    if(state==='notes-denied'||state==='note-denied'||memberId!==member.id)return result({kind:'denied'});
    if(state==='notes-off')return result({kind:'off'});
    return result({kind:'ready',card:'notes',memberId,revision:noteRevision,notes});
   }
   if(url.pathname==='/fixture/care-note'){
    const request=JSON.parse(body);noteRequests.push(request);
    await new Promise(done=>setTimeout(done,150));
    const refusal={ok:false,error:'This case or assignment changed. Refresh and check your access before trying again.'};
    if(request.id!==member.id||request.op!=='note'||!['evidence','contact-attempted','reached','unreachable','refer-doctor'].includes(request.kind)||typeof request.note!=='string'||!request.note.trim()||request.note.length>2000)return result({ok:false,error:'Check the measurement or note details.'});
    if(state==='note-refused'||state==='note-denied')return result(refusal);
    if(state==='note-stale'&&!noteStale){noteStale=true;noteRevision++;return result(refusal);}
    if(request.revision!==noteRevision)return result(refusal);
    if(state==='note-unknown-unsaved'&&!noteThrown){noteThrown=true;return result({ok:false,uncertain:true,error:'The note result is unavailable.'});}
    notes.unshift({id:id(7000+notes.length),actor_name:'Narine Example',actor_role:'nurse',kind:request.kind,note:request.note.trim(),created_at:new Date().toISOString()});noteRevision++;
    if(['note-unknown-saved','note-thrown-saved'].includes(state)&&!noteThrown){noteThrown=true;if(state==='note-thrown-saved')return {status:500,body:'Response lost after commit'};return result({ok:false,uncertain:true,error:'The note result is unavailable.'});}
    return result({ok:true,revision:noteRevision});
   }
   if(url.pathname==='/fixture/visit'){
    const request=JSON.parse(body);visitReads.push(request);visitDetail.counts=counts();
    if(state==='visit-read-failed')return result('unavailable');
    if(state==='visit-read-denied')return result(null);
    if(request.memberId!==member.id||request.source!=='appointment')return result(null);
    if(request.visitId===visitId)return result(visitDetail);
    const selected=today().visits?.visits.find(row=>row.id===request.visitId);
    if(!selected)return result(null);
    const detail=structuredClone(visitDetail);detail.visit=selected;detail.steps=selected.steps;
    detail.completion=selected.completion?{...selected.completion,reason:'Earlier visit completed',visitId:completedVisitId}:null;
    return result(detail);
   }
   if(['/fixture/visit-mark','/fixture/visit-step','/fixture/visit-complete'].includes(url.pathname)){
    const request=JSON.parse(body),kind=url.pathname.slice('/fixture/visit-'.length);visitRequests.push({kind,request});
    await new Promise(done=>setTimeout(done,100));
    if(visitSaved.has(request.submissionId))return result({...visitSaved.get(request.submissionId),replayed:true});
    if(state==='visit-booking-stale'&&kind==='complete')return result({status:'booking-stale'});
    if(state==='visit-unknown-unsaved'&&!thrown){thrown=true;return result({status:'outcome-unknown'});}
    const at=new Date(Date.UTC(2026,10,1,10,visitRequests.length)).toISOString();
    let response;
    if(kind==='mark'){
     const item=visitDetail.items.find(item=>item.key===request.item);if(!item)return result({status:'stale'});
     item.mark={done:request.done,note:request.note,values:request.values,recordedAt:at,nurseName:'Narine Example'};
     response={status:'saved',markId:id(5000+visitRequests.length),submissionId:request.submissionId,replayed:false};
    }else if(kind==='step'){
     const existing=visitDetail.steps.find(step=>step.step===request.step);
     if(existing)return result({status:'already-recorded',occurredAt:existing.at});
     visitDetail.steps.push({step:request.step,at,by:'Narine Example'});
     response={status:'saved',eventId:id(6000+visitRequests.length),submissionId:request.submissionId,occurredAt:at,replayed:false};
    }else{
     const summary=counts();
     if(summary.openItems.length&&(!request.reason||request.reason.trim().length<3))return result({status:'reason-required',openItems:summary.openItems});
     visitDetail.completion={completedAt:at,nurseName:'Narine Example',reason:request.reason,summary,visitId:request.visitId};
     visitDetail.visit.completion={completedAt:at,nurseName:'Narine Example',summary};visitDetail.visit.bookingStatus='completed';
     response={status:'saved',submissionId:request.submissionId,visitId:request.visitId,summary,replayed:false};
    }
    visitDetail.counts=counts();visitSaved.set(request.submissionId,response);
    if(state==='visit-unknown-saved'&&!thrown){thrown=true;return result({status:'outcome-unknown'});}
    return result(response);
   }
   if(url.pathname==='/fixture/task-refresh'){
    const {taskId}=JSON.parse(body);taskReads.push(taskId);
    return result(state==='task-unreadable'?{ok:false,error:'Current task could not load. Your entries are retained. Check your assignment and try again.'}:{ok:true,task:tasks.get(taskId)});
   }
   if(url.pathname==='/fixture/task-command'){
    const request=JSON.parse(body);taskRequests.push(request);
    await new Promise(done=>setTimeout(done,150));
    const task=tasks.get(request.taskId);
    if(state==='task-changed'&&!stale){stale=true;task.revision++;task.title='Arrange Thursday appointment';task.instructions='Thursday only';return result({ok:false,error:'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'});}
    if(state==='task-stale'&&!stale){stale=true;task.revision++;return result({ok:false,error:'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'});}
    if(state==='task-finished'){task.status='completed';task.revision++;return result({ok:false,error:'This task was completed by another nurse.'});}
    if(state==='task-unreadable')return result({ok:false,error:'Current task access is required.'});
    if(['task-unknown-saved','task-thrown-saved','task-unknown-unsaved'].includes(state)&&!thrown){
     thrown=true;if(state!=='task-unknown-unsaved')completeTask(request);
     if(state==='task-thrown-saved')return {status:500,body:'Response lost after commit'};
     return result({ok:false,uncertain:true,error:'The command result is unavailable.'});
    }
    if(!task&&request.operation!=='create')return result({ok:false,error:'Current task access is required.'});
    if(!(task?.events.some(event=>event.request_id===request.requestId))&&request.revision!==(task?.revision??0))return result({ok:false,error:'The task revision changed.'});
    const completed=completeTask(request);return result(completed?{ok:true,id:completed.id,revision:completed.revision,status:completed.status}:{ok:false,error:'Current task access is required.'});
   }
   if(url.pathname==='/fixture/incoming'){incoming();return result({ok:true});}
   if(url.pathname==='/fixture/handoff-facts')return result({asOf:'2026-11-04T05:30:00Z',bp:[{systolic:150,diastolic:95,pulse:78,measuredAt:'2026-11-03T04:10:00Z',source:'manual'}],tasks:[],medicines:[],medicinesFrom:'2026-10-29',medicinesTo:'2026-11-04'});
   if(url.pathname==='/fixture/adherence')return result({kind:'adherence',rows:[{member:{id:member.id,name:member.name,birthDate:'1986-01-01',birthYear:1986,phoneLast4:'1234',shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}},medicines:[{name:'Atorvastatin',dose:'20 mg',source:'plan',expected:7,taken:3,skipped:1,noReport:3}]}],from:'2026-10-29',to:'2026-11-04',days:7,checked:1,unknown:0,truncated:false});
   if(url.pathname==='/fixture/missing-bp')return result({kind:'missing-bp',rows:[{id:member.id,name:member.name,birthDate:'1986-01-01',birthYear:1986,phoneLast4:'1234',shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}}],from:'2026-11-02',to:'2026-11-04',unknown:0,checked:1,truncated:false});
   if(url.pathname==='/fixture/handoffs')return result(handoffReadFails?null:{items:handoffs,hasMore:false});
   if(url.pathname==='/fixture/handoff'){
    const request=JSON.parse(body);handoffRequests.push(request);
    await new Promise(done=>setTimeout(done,150));
    if(state==='handoff-stale'&&!stale){stale=true;incoming();return result({ok:false,code:'stale_context'});}
    if(state==='handoff-denied'||state==='handoff-off')return result({ok:false,code:state.slice(8)});
    if(state==='handoff-refused')return result({ok:false,code:'unavailable'});
    if(state==='handoff-exists')return result({ok:false,code:'already_exists'});
    if(!savedHandoffs.has(request.requestId)&&request.expectedVersion!==version)return result({ok:false,code:'stale_context'});
    if(!savedHandoffs.has(request.requestId)){
     const taskId=id(1000+handoffs.length);savedHandoffs.set(request.requestId,taskId);
     handoffs.push(handoff(request,taskId,new Date().toISOString()));
    }
    if(state==='handoff-thrown'&&!thrown){thrown=true;return {status:500,body:'Response lost after commit'};}
    if(state==='handoff-read-fails')handoffReadFails=true;
    return result({ok:true,taskId:savedHandoffs.get(request.requestId),replayed:handoffRequests.filter(r=>r.requestId===request.requestId).length>1});
   }
   if(url.pathname==='/fixture/recover-handoffs'){handoffReadFails=false;return result({ok:true});}
   if(url.pathname==='/fixture/conversation'){
    reads++;
    if(state==='read-throws')return {status:500,body:'Response unavailable'};
    if(['denied','off','unavailable'].includes(state))return result({ok:false,code:state});
    return result({ok:true,memberId:JSON.parse(body).memberId,memberName:member.name,doctorName:'Doctor Example',version,canSend:state!=='read-only',unsupportedMedia:state==='media',unsavedOverLimit:state==='over-limit',items});
   }
   if(url.pathname==='/fixture/reply'){
    const request=JSON.parse(body);requests.push(request);
    await new Promise(done=>setTimeout(done,150));
    if(state==='stale-once'&&!stale){stale=true;incoming();return result({ok:false,code:'stale_context'});}
    if(state==='refused')return result({ok:false,code:'unavailable'});
    if(!saved.has(request.requestId)&&request.expectedVersion!==version)return result({ok:false,code:'stale_context'});
    if(state==='send-denied'||state==='send-off')return result({ok:false,code:state.slice(5)});
    if(!saved.has(request.requestId)){
     const replyId=id(items.length+1);saved.set(request.requestId,replyId);
     items.push({id:replyId,text:request.body,senderRole:'nurse',senderName:'Narine Example',at:new Date().toISOString()});
    }
    if(state==='thrown-once'&&!thrown){thrown=true;return {status:500,body:'Response lost after commit'};}
    if(state==='saved-read-fails')state='read-throws';
    return result({ok:true,replyId:saved.get(request.requestId),replayed:requests.filter(r=>r.requestId===request.requestId).length>1});
   }
   if(url.pathname==='/fixture/today'){
    if(long)await new Promise(done=>setTimeout(done,800));
    return result(state==='failed'?{ok:false,code:'unavailable'}:today());
   }
   if(url.pathname==='/fixture/search')return result(state==='search-failed'?{ok:false,reason:'unavailable'}:{ok:true,page:{rows:JSON.parse(body).query==='Ani'?[member]:[],hasMore:false,nextCursor:null}});
  }
  if(url.pathname!=='/staff/real/nurse-chat-v2')return {status:404,body:''};
  if(!keepNextOpen){
  state=url.searchParams.get('state')??'';long=url.searchParams.has('history');
  stale=false;thrown=false;version=1;reads=0;requests.length=0;saved.clear();handoffRequests.length=0;handoffs.length=0;savedHandoffs.clear();handoffReadFails=false;taskRequests.length=0;taskReads.length=0;taskPageRequests.length=0;tasks.clear();seedTasks();visitRequests.length=0;visitReads.length=0;visitSaved.clear();seedVisit();
  zoeQuestionRequests.length=0;zoeOpenRequests.length=0;zoeHistoryRequests.length=0;noteRequests.length=0;notes.length=0;noteRevision=1;noteThrown=false;noteStale=false;
  if(state!=='empty')notes.push({id:id(7000),actor_name:'Narine Example',actor_role:'nurse',kind:'evidence',note:'Earlier care note',created_at:'2026-10-31T10:00:00Z'});
  items=state==='empty'?[]:Array.from({length:120},(_,i)=>({id:id(i+1),senderRole:['member','doctor','nurse','zoe'][i%4],senderName:['Ani Example','Doctor Example','Narine Example','Zoe'][i%4],text:`Conversation message ${i}\nSecond line ${'longword'.repeat(12)}`,at:new Date(Date.UTC(2026,10,1,8,i)).toISOString()}));
  if(state==='handed-over')handoffs.push(handoff({memberId:member.id,messageId:items[0].id,topic:'other',observation:'Earlier saved observation'},id(1000),'2026-11-01T08:00:30Z'));
  if(state==='handoffs-unavailable')handoffReadFails=true;
  }
  keepNextOpen=false;
  const history=long?Array.from({length:100},(_,i)=>({id:`history-${i}`,kind:'reply',reply:{kind:'text',text:`Earlier reply ${i}`}})):[];
  return result(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/chat.css"><style>*{box-sizing:border-box}html,body{margin:0}button,input{font:inherit}svg{flex:none}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify({history,state})}</script><script src="/chat.js"></script></body></html>`,'text/html');
 };
 const recordElsewhere=(key,values)=>{visitDetail.items.find(item=>item.key===key).mark={done:true,note:null,values,recordedAt:'2026-11-01T09:30:00Z',nurseName:'Narine Example'};};
 return {recordElsewhere,url:'http://127.0.0.1',respond,requests,zoeQuestionRequests,zoeOpenRequests,zoeHistoryRequests,memberId:member.id,handoffRequests,taskRequests,taskReads,taskPageRequests,taskId,visitRequests,visitReads,visitId,deviceId,earlierVisitId,futureVisitId,completedVisitId,noteRequests,get notes(){return notes;},get noteRevision(){return noteRevision;},get visitDetail(){return visitDetail;},retainNextOpen(){keepNextOpen=true;},get reads(){return reads;},incoming,close:async()=>rmSync(directory,{recursive:true,force:true})};
}
