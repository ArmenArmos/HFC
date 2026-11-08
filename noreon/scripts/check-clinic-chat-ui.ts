import assert from 'node:assert/strict';
import {clinicSnapshot} from './fixtures/clinic-portal';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='next/link')return {url:'data:text/javascript,export default function Link(p){return globalThis.__clinicChatReact.createElement("a",p,p.children)}',shortCircuit:true};
 if(s==='next/navigation')return {url:'data:text/javascript,export function useRouter(){return {refresh(){},push(){}}} export function unstable_rethrow(){}',shortCircuit:true};
 if(s==='@/lib/clinic-portal/actions')return {url:'data:text/javascript,export async function clinicRead(){return {status:"unavailable"}} export async function clinicRecover(){return {status:"unavailable"}} export async function clinicCommand(){return {status:"invalid"}}',shortCircuit:true};
 if(s==='@/lib/clinic-portal/lab-results-actions')return {url:'data:text/javascript,export async function clinicLabResults(){return {status:"unavailable"}} export async function clinicLabLink(){return {status:"access"}}',shortCircuit:true};
 if(s==='@/lib/clinic-admin/actions')return {url:'data:text/javascript,export async function clinicMemberFilesRead(){return {status:"forbidden"}} export async function clinicMemberFileAttach(){return {status:"refused"}} export async function clinicMemberUploadBegin(){return {status:"refused"}} export async function clinicMemberUploadReserve(){return {status:"refused"}}',shortCircuit:true};
 return next(s,c);
}});
const React=await import('react');const {create,act}=await import('react-test-renderer');
const {ClinicChat}=await import('@/components/clinic-portal/chat');
import type {ClinicIdentity} from '@/lib/clinic-portal/schema';
import type {ClinicBooking,ScheduleCommand} from '@/lib/clinic-scheduling/schema';
import type {ClinicChatReply} from '@/lib/clinic-chat/runtime';
import type {ChatQuery} from '@/lib/clinic-chat/schema';
Object.assign(globalThis,{__clinicChatReact:React,document:{getElementById:()=>null},IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{}});
const id=(n:number)=>`c1c10000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity:ClinicIdentity={version:'clinic-portal-v1',userId:id(1),membershipId:id(2),membershipRevision:1,clinicId:id(3),clinicName:'Synthetic clinic',displayName:'Synthetic staff',capability:'clinic_staff'};
const booking:ClinicBooking={appointmentId:id(4),memberId:id(5),reference:id(6),revision:2,kind:'pending',status:'change-requested',channel:'portal',memberName:'Synthetic member',memberPhone:null,startsAt:'2030-01-02T09:00:00+04:00',endsAt:'2030-01-02T09:30:00+04:00',previousStartsAt:'2030-01-01T09:00:00+04:00',previousEndsAt:'2030-01-01T09:30:00+04:00',tests:['ECG'],proposal:null,rejectedProposal:null,decline:null};
const loaded={status:'loaded' as const,data:{version:'clinic-schedule-bookings-v1' as const,enabled:true as const,role:'staff' as const,bookings:[booking]}};
const home:ClinicChatReply={kind:'home',maskedMembers:[],bookings:loaded,today:loaded,batches:{status:'loaded',data:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[],nextCursor:null}},asOf:'2026-11-01T08:00:00Z'};
let next:ClinicChatReply={kind:'bookings',maskedMembers:[],result:loaded};const reads:ChatQuery[]=[],sent:ScheduleCommand[]=[];
const props={identity,actorScope:'synthetic-scope',canChooseClinic:true,resultLink:false,locale:'en' as const,initial:home,initialQuery:{kind:'home'} as const,read:async(q:ChatQuery)=>{reads.push(q);return next;},run:async(c:ScheduleCommand)=>{sent.push(c);return {status:'stale'} as const;},slots:async()=>[]};
let tree!:ReturnType<typeof create>;
type Node={children:(string|Node)[]};const label=(n:Node):string=>n.children.map(c=>typeof c==='string'?c:label(c)).join('');
const text=()=>label(tree.root as unknown as Node);
const button=(s:string)=>tree.root.findAll(n=>n.type==='button'&&label(n as unknown as Node)===s)[0];
const click=async(s:string)=>{assert.ok(button(s),`Missing button ${s}`);await act(async()=>{await button(s).props.onClick();});};
try{
 for(const [locale,line] of [['en','Nothing needs your attention right now.'],['hy','Այս պահին ոչինչ ձեր ուշադրության կարիքը չունի։'],['ru','Сейчас ничто не требует вашего внимания.']] as const){
  const emptyHome:ClinicChatReply={...home,bookings:{...loaded,data:{...loaded.data,bookings:[]}},today:{...loaded,data:{...loaded.data,bookings:[]}}};
  await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,locale,initial:emptyHome}));});
  assert.ok(text().includes(line),'An empty clinic landing has a localized Zoe turn');
  await act(async()=>tree.unmount());
  for(const initial of [home,{...emptyHome,today:{status:'unavailable' as const}},{...emptyHome,today:{status:'loaded' as const,data:{version:'clinic-schedule-bookings-v1' as const,enabled:false as const,bookings:[] as never[]}}}]){
   await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,locale,initial}));});
   assert.ok(!text().includes(line),'Waiting, unavailable or disabled work is never described as empty');
   await act(async()=>tree.unmount());
  }
 }
 // Successful waiting and batch reads must not hide an independent Today outage.
 for(const today of [{status:'unavailable' as const},{status:'loaded' as const,data:{version:'clinic-schedule-bookings-v1' as const,enabled:false as const,bookings:[] as never[]}}]){
  const partial:ClinicChatReply={...home,today};
  await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:partial}));});
  next=partial;await click('What needs my attention?');
  assert.ok(text().includes('Synthetic member'),'Waiting bookings survive an independent Today failure');
  if(today.status==='unavailable'){
   assert.ok(tree.root.findAll(n=>n.props.role==='alert').some(n=>/Today.*could not load/.test(label(n as unknown as Node))),'Open attention names the failed Today read');
  }else assert.match(text(),/Scheduling is not switched on/);
  await act(async()=>tree.unmount());
 }
 await act(async()=>{tree=create(React.createElement(ClinicChat,props));});
 assert.ok(!text().includes('Synthetic member'),'Landing keeps attention cards in Menu');
 assert.ok(tree.root.find(n=>n.type==='input'&&n.props.name==='clinic-message'),'Landing has a composer');
 assert.equal(tree.root.findAllByType('header').length,0,'The agreed landing starts empty, without an attention banner');
 next=home;
 await click('What needs my attention?');
 assert.deepEqual(reads.at(-1),{kind:'home'},'The menu opens the existing attention read');
 assert.ok(text().includes('Synthetic member'),'Opening attention reveals waiting work');
 next={kind:'bookings',maskedMembers:[],result:loaded};
 await act(async()=>{tree.root.find(n=>n.type==='input'&&n.props.name==='clinic-message').props.onChange({target:{value:'show bookings'}});});
 await act(async()=>{tree.root.find(n=>n.type==='form'&&n.props['aria-label']==='Message the clinic assistant').props.onSubmit({preventDefault(){}});});
 assert.deepEqual(reads.at(-1),{kind:'bookings',scope:'upcoming',day:null});
 const beforeUnsupported=reads.length;
 await act(async()=>{tree.root.find(n=>n.type==='input'&&n.props.name==='clinic-message').props.onChange({target:{value:'What should I prescribe?'}});});
 await act(async()=>{tree.root.find(n=>n.type==='form'&&n.props['aria-label']==='Message the clinic assistant').props.onSubmit({preventDefault(){}});});
 assert.equal(reads.length,beforeUnsupported,'Unsupported text never calls the data reader');
 assert.ok(text().includes('choose an action in Menu'));
 next=home;await click('What needs my attention?');
 assert.ok(text().includes('Synthetic member'));assert.ok(text().includes('Currently booked'));
 next={kind:'bookings',maskedMembers:[],result:loaded};
 const links=tree.root.findAllByType('a').map(a=>a.props.href);
 assert.ok(!links.some(h=>/\/(hours|team|records)[?]/.test(h)),'Staff has no admin links');
 assert.ok(links.includes('/clinic/real/select?locale=en'));
 await click('Confirm visit');assert.equal(sent[0].op,'confirm');assert.equal(sent[0].revision,2);assert.ok(text().includes('This booking changed.'));
 await click('Decline');
 await act(async()=>{tree.root.findAllByType('textarea')[0].props.onChange({target:{value:'ab'}});});
 await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});});
 assert.equal(sent.length,1,'Short reason never reaches command');
 assert.ok(text().includes('at least 3 characters'));
 await act(async()=>{tree.root.findAllByType('textarea')[0].props.onChange({target:{value:'No available capacity'}});});
 await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}});});
 assert.equal(sent.at(-1)?.op,'decline');
 await click('Show bookings');assert.deepEqual(reads.at(-1),{kind:'bookings',scope:'upcoming',day:null});
 await click('Past');assert.equal(reads.at(-1)?.kind,'bookings');assert.ok(reads.at(-1)?.kind==='bookings'&&(reads.at(-1) as {scope:string}).scope==='past');
 next={kind:'members',maskedMembers:[],result:{status:'loaded',data:{version:'clinic-member-search-v2',enabled:true,maskedMembers:[],members:[{memberId:id(5),name:'Synthetic member',phone:null,birthDate:null}],page:1,pageSize:25,total:1}}};
 await click('Find a member');
 next={kind:'member',maskedMembers:[],result:{status:'missing'}};await click('Open file');assert.ok(text().includes('not in your clinic’s records'));
 next={kind:'batches',maskedMembers:[],result:{status:'unavailable'}};await click('Show upload status');assert.ok(text().includes('could not load'));assert.ok(!text().includes('No matching records'));
 next={kind:'home',maskedMembers:[],bookings:{status:'unavailable'},today:{status:'unavailable'},batches:{status:'unavailable'},asOf:home.asOf};await click('What needs my attention?');assert.ok(text().includes('could not load'));assert.ok(!text().includes('Requests to answer'),'Unavailable reads do not become misleading zero counts');
 await act(async()=>tree.unmount());
 for(const locale of ['hy','ru'] as const){
  await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,locale}));});
  assert.ok(!text().includes('Synthetic member'),'Each locale starts empty');
  await act(async()=>{tree.root.find(n=>n.type==='input'&&n.props.name==='clinic-message').props.onChange({target:{value:locale==='hy'?'Ցույց տալ այցերը':'Показать записи'}});});
  await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});});
  assert.deepEqual(reads.at(-1),{kind:'bookings',scope:'upcoming',day:null},'Localized requests use the same guarded read');
  await act(async()=>tree.unmount());
 }
 // File status opens in chat through the same read-only file renderer as the batch page.
 next={kind:'batches',maskedMembers:[],result:{status:'loaded',data:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[{...clinicSnapshot.batch,clinicId:identity.clinicId,fileCount:1,attentionCount:1}],nextCursor:null}}};
 await act(async()=>{tree=create(React.createElement(ClinicChat,props));});
 await click('Show upload status');next={kind:'batch',maskedMembers:[],result:{status:'loaded',data:{...clinicSnapshot,files:clinicSnapshot.files.map(f=>({...f,recoveryCommand:{version:'clinic-command-v1' as const,op:'reserve-upload' as const,submissionId:id(91),clinicId:clinicSnapshot.batch.clinicId,batchId:clinicSnapshot.batch.id,revision:1,logicalKey:f.logicalKey,fileId:f.id,attemptId:f.upload.attemptId,name:f.name,mime:'application/pdf' as const,declaredSizeBytes:f.declaredSizeBytes,fingerprint:'a'.repeat(64)}}))}}};
 await click('Synthetic batch');assert.equal(reads.at(-1)?.kind,'batch');
 assert.ok(text().includes('Upload not confirmed')&&text().includes('Unavailable'));
 assert.ok(button('Check unfinished attempt'),'Chat exposes existing guarded recovery');
 await act(async()=>tree.unmount());
 // Proposal capacity failures and withdrawal use the existing card command shapes.
 const slot={key:'a'.repeat(64),startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+88200000).toISOString(),free:1};
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,run:async(c:ScheduleCommand)=>{sent.push(c);return {status:'full'} as const;},slots:async()=>[slot]}));});
 next=home;await click('What needs my attention?');
 await click('Propose another time');
 await act(async()=>{await tree.root.find(n=>n.type==='input'&&n.props.type==='date').props.onChange({target:{value:slot.startsAt.slice(0,10)}});});
 await act(async()=>{tree.root.find(n=>n.type==='input'&&n.props.type==='radio').props.onChange();});
 await act(async()=>{tree.root.find(n=>n.type==='form'&&n.props['aria-label']!=='Message the clinic assistant').props.onSubmit({preventDefault(){}});});
 assert.ok(sent.at(-1)?.op==='propose'&&(sent.at(-1) as {slotKey:string}).slotKey===slot.key);
 assert.ok(text().includes('That time is now full.'));
 await act(async()=>tree.unmount());
 const withProposal:ClinicChatReply={...home,bookings:{...loaded,data:{...loaded.data,bookings:[{...booking,proposal:{id:id(50),startsAt:slot.startsAt,endsAt:slot.endsAt,createdAt:new Date().toISOString(),note:null}}]}}};
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:withProposal}));});
 next=withProposal;await click('What needs my attention?');
 const proposalCard=tree.root.findAllByType((await import('@/components/clinic-portal/bookings')).ClinicBookingCard).find(card=>card.props.booking.proposal);
 assert.ok(proposalCard);
 const proposalText=label(proposalCard as unknown as Node);
 assert.ok(!proposalText.includes('Confirm visit')&&!proposalText.includes('Propose another time')&&!proposalText.includes('Decline'),'A waiting proposal has no conflicting decision controls');
 await click('Withdraw proposal');
 assert.ok(sent.at(-1)?.op==='withdraw-proposal'&&(sent.at(-1) as {proposalId:string}).proposalId===id(50));
 await act(async()=>tree.unmount());
 // A booking command must refresh the question now open, even if it started on Home.
 let finish!:(value:{status:'saved';booking:null})=>void;
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,run:()=>new Promise<{status:'saved';booking:null}>(resolve=>{finish=resolve;})}));});
 next=home;await click('What needs my attention?');
 await click('Confirm visit');next={kind:'batches',maskedMembers:[],result:{status:'unavailable'}};
 await click('Show upload status');
 await act(async()=>{finish({status:'saved',booking:null});});
 assert.equal(reads.at(-1)?.kind,'batches','Late save retains the newer question');
 await act(async()=>tree.unmount());
 // A saved decision remains visible even when its home card disappears.
 for(const op of ['confirm','decline','propose'] as const){
  next={...home,bookings:{...loaded,data:{...loaded.data,bookings:[]}}};
  const saved={...booking,kind:'current' as const,status:'confirmed' as const,proposal:op==='propose'?{id:id(71),startsAt:slot.startsAt,endsAt:slot.endsAt,createdAt:new Date().toISOString(),note:null}:null};
  await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,run:async()=>({status:'saved' as const,booking:saved})}));});
  const refreshed=next;next=home;await click('What needs my attention?');next=refreshed;
  const action=tree.root.findByType((await import('@/components/clinic-portal/bookings')).ClinicBookingCard).props.run;
  await act(async()=>{await action({version:'clinic-schedule-command-v1',submissionId:id(72),appointmentId:booking.appointmentId,revision:booking.revision,op,...(op==='decline'?{reason:'No capacity'}:op==='propose'?{slotKey:slot.key,note:null}:{})},booking);});
  assert.ok(text().includes(op==='confirm'?'You confirmed':op==='decline'?'You declined':'You proposed'),'Saved outcome names the action');
  assert.ok(text().includes('Synthetic member')&&text().includes('(UTC+4)'),'Receipt retains member and time after card vanishes');
  await act(async()=>tree.unmount());
 }
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,canChooseClinic:false}));});
 assert.ok(!text().includes('Choose a clinic'),'Single clinic has no selector');
 await act(async()=>tree.unmount());
 const attended={...booking,kind:'current' as const,status:'confirmed' as const,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+1800000).toISOString()};
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:{kind:'bookings',maskedMembers:[],result:{...loaded,data:{...loaded.data,bookings:[attended]}}},initialQuery:{kind:'bookings',scope:'upcoming',day:null}}));});
 assert.ok(button('Mark arrived')&&button('Mark did not come'),'Attendance controls remain in chat');
 const beforeNoShow=sent.length;
 await click('Mark did not come');
 assert.equal(sent.length,beforeNoShow,'Opening no-show confirmation saves nothing');
 await click('Cancel');assert.equal(sent.length,beforeNoShow,'Cancel saves nothing');
 await click('Mark did not come');await click('Confirm did not come');
 assert.equal(sent.at(-1)?.op,'check-in');assert.equal((sent.at(-1) as {outcome:string}).outcome,'no-show');
 const press=button('Mark arrived').props.onClick;
 const before=sent.length;
 await act(async()=>{press();press();});
 assert.equal(sent.length,before+1,'Same-tick attendance press only sends once');
 await act(async()=>tree.unmount());
 // Upload refresh replaces the outer lab list without remounting the upload controller.
 const memberReply={kind:'member',maskedMembers:[],result:{status:'loaded',data:{version:'clinic-member-file-v1',enabled:true,status:'ok',member:{memberId:id(5),name:'Synthetic member',phone:null,birthDate:null},bookings:[],files:[]}}} satisfies ClinicChatReply;
 const added={fileId:id(81),name:'New lab.pdf',uploadedAt:'2026-11-01T08:00:00Z',batchName:'Results upload',linkedAt:'2026-11-01T08:00:00Z',visitedAt:null};
 next={kind:'member',maskedMembers:[],result:{status:'loaded',data:{...memberReply.result.data,files:[added]}}};
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,identity:{...identity,capability:'clinic_admin',fullAccess:true},initial:memberReply,initialQuery:{kind:'member',memberId:id(5)}}));});
 const memberFiles=tree.root.findByType((await import('@/components/clinic-portal/chat-member-files')).ChatMemberFiles);
 const refreshFiles=memberFiles.props.onChanged;
 await act(async()=>{await refreshFiles?.();});
 assert.ok(text().includes('Lab result PDF')&&!text().includes('New lab.pdf'),'Upload refresh uses neutral dated labels');
 assert.equal(reads.at(-1)?.kind,'member');
 assert.equal(tree.root.findByType(memberFiles.type),memberFiles,'Refresh preserves the upload controller');
 assert.equal(button('Open PDF'),undefined,'No clinic PDF opening control after upload');
 assert.ok(text().includes("Linked to the member's record. Their doctor reviews the values."),'Linked file explains that the doctor reviews values');
 // A refresh that finishes after navigation must not replace the newer answer.
 let finishMember!:(value:ClinicChatReply)=>void;
 await act(async()=>tree.update(React.createElement(ClinicChat,{...props,identity:{...identity,capability:'clinic_admin',fullAccess:true},initial:memberReply,initialQuery:{kind:'member',memberId:id(5)},read:(q:ChatQuery)=>q.kind==='member'?new Promise<ClinicChatReply>(resolve=>{finishMember=resolve;}):Promise.resolve<ClinicChatReply>({kind:'batches',maskedMembers:[],result:{status:'unavailable'}})})));
 let refreshing!:Promise<void>;
 await act(async()=>{refreshing=tree.root.findByType(memberFiles.type).props.onChanged();});
 await click('Show upload status');
 await act(async()=>{finishMember(next);await refreshing;});
 assert.ok(!text().includes('New lab.pdf'),'Late file refresh keeps the newer question');
 await act(async()=>tree.unmount());
 // The short landing line covers every Home source and never reports a partial read as empty.
 const emptyBookings={...loaded,data:{...loaded.data,bookings:[]}};
 const quietHome={...home,bookings:emptyBookings,today:emptyBookings};
 // A files-only prompt must lead to the affected batch, while Today-only work exposes booking actions.
 const fileHome:ClinicChatReply={...quietHome,batches:{status:'loaded',data:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[{...clinicSnapshot.batch,clinicId:identity.clinicId,fileCount:3,attentionCount:3}],nextCursor:null}}};
 next=fileHome;
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:fileHome}));});
 await click('What needs my attention?');
 assert.ok(button('Synthetic batch (3)'),'Waiting files open as a batch action, not only a count');
 next={kind:'batch',maskedMembers:[],result:{status:'unavailable'}};
 await click('Synthetic batch (3)');
 assert.deepEqual(reads.at(-1),{kind:'batch',batchId:clinicSnapshot.batch.id,cursor:null});
 await act(async()=>tree.unmount());
 const todayHome:ClinicChatReply={...quietHome,today:loaded};
 next=todayHome;
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:todayHome}));});
 await click('What needs my attention?');
 assert.ok(button('Confirm visit'),'Today-only bookings have reachable actions');
 await act(async()=>tree.unmount());
 for(const [initial,expected] of [
  [quietHome,'No waiting work in the records shown.'],
  [{...quietHome,batches:{status:'loaded',data:{...(home.batches.status==='loaded'?home.batches.data:{}),nextCursor:'more-batches'}}},'No waiting work in the records shown.'],
  [{...quietHome,batches:{status:'unavailable'}},'Some clinic records are unavailable.'],
  [{...quietHome,batches:{status:'loaded',data:{...(home.batches.status==='loaded'?home.batches.data:{}),batches:[{...clinicSnapshot.batch,clinicId:identity.clinicId,fileCount:1,attentionCount:1}]}}},'You have bookings or files to check.'],
  [{...quietHome,bookings:{...loaded,data:{...loaded.data,bookings:[{...booking,status:'confirmed',rejectedProposal:{id:id(94),startsAt:booking.startsAt,endsAt:booking.endsAt,rejectedAt:home.asOf}}]}}},'You have bookings or files to check.'],
 ] as const){
  await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:initial as ClinicChatReply}));});
  assert.ok(!text().includes('Synthetic member'),'Landing remains empty until a request');
  assert.ok(!text().includes('No waiting work'),'Landing never claims an unrequested work summary');
  next=initial as ClinicChatReply;await click('What needs my attention?');
  if(expected.includes('unavailable'))assert.ok(text().includes('could not load'),'A partial read stays visibly unavailable after asking');
  assert.equal(tree.root.findAllByType('h1').length,0,'Cards do not add a pinned assistant heading');
  await act(async()=>tree.unmount());
 }
 // Replacement answers and their receipts start at the priority cards; only appended help follows the bottom.
 const scrolls:number[]=[];
 Object.assign(globalThis,{requestAnimationFrame:(callback:FrameRequestCallback)=>{callback(0);return 0;}});
 next=home;
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,run:async()=>({status:'saved' as const,booking})}),{createNodeMock:element=>{const props=element.props as {className?:unknown};return typeof props.className==='string'&&props.className.includes('overscroll-contain')?{scrollHeight:900,scrollTo:({top}:{top:number})=>scrolls.push(top)}:null;}});});
 await click('What needs my attention?');
 assert.equal(scrolls.at(-1),0,'New replacement results reveal the first priority card');
 await click('Confirm visit');
 assert.ok(text().includes('You confirmed'),'Saved receipt remains in the replacement result');
 assert.equal(scrolls.length,2,'Saving does not scroll away from the tapped visit');
 const receiptCard=tree.root.findByType((await import('@/components/clinic-portal/bookings')).ClinicBookingCard);
 assert.ok(label(receiptCard as unknown as Node).includes('You confirmed'),'The confirmation is inside its booking card');
 await act(async()=>{tree.root.find(n=>n.type==='input'&&n.props.name==='clinic-message').props.onChange({target:{value:'unrecognized'}});});
 await act(async()=>{tree.root.find(n=>n.type==='form'&&n.props['aria-label']==='Message the clinic assistant').props.onSubmit({preventDefault(){}});});
 assert.equal(scrolls.at(-1),900,'Appended guidance is the newest status');
 await act(async()=>tree.unmount());
 Object.assign(globalThis,{requestAnimationFrame:()=>0});
 // An initial access failure is visible even on the otherwise empty Home landing.
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:{kind:'access'}}));});
 assert.ok(text().includes('Your clinic access changed.'),'Landing never hides access failure');
 await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(ClinicChat,{...props,initial:{...home,bookings:{status:'loaded',data:{version:'clinic-schedule-bookings-v1',enabled:false,bookings:[]}}}}));});
 assert.ok(text().includes('Scheduling is not switched on'),'Disabled scheduling is distinct from a failed read');
 await act(async()=>tree.unmount());
 console.log('Clinic chat UI PASS: staff boundary, clinic selector, exact confirm/decline card, validation, stale/full feedback, proposal/withdrawal, follow-up reads, refused member, outage and three locales. React interaction fixture, not browser/Auth.');
}finally{await act(async()=>tree?.unmount());}
