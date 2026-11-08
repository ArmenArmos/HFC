import {journeyFixture} from './journey.ts';
/** Isolated browser harness: real member view/hook; synthetic initial data and action IO. No secrets or DB. */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {CONSULT,consultQuestionsText} from '../../lib/zoe-chat-actions/consult-copy.ts';
import {preferredVisitDays,requestVisitInput,visitRequestMessage} from '../../lib/zoe-chat-actions/visit-request-contract.ts';
import { createRequire } from 'node:module';
import {evaluateSams,samsAnswers,samsItem} from '../../lib/zoe-chat-actions/dose-flow.ts';
const require = createRequire(resolve('package.json'));
const { webpack } = require('next/dist/compiled/webpack/webpack');
export const history = () => ({ ok: true, version: 1, ack: null, zoeReplies: false, settledSeq: 0,
  emergencyCheck:{env:{NOREON_ZOE_TEST_LEXICON:'true',NOREON_ZOE_URGENT_PLACEHOLDER:'true'},intake:{enabled:true,active:true}},
  messages: [], answers: [], replies: Array.from({length: 100}, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`, doctorName: 'Dr. Mariam',
    text: `Recorded doctor reply ${i}. We can discuss your questions here.`,
    at: new Date(Date.UTC(2026,9,1,0,i)).toISOString(),
  })),
});
// The notice strings stand for the exact already-saved Telegram payload, not UI summaries.
export const noticeHistory = () => Array.from({length:24}, (_, i) => ({
  id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,
  text:`Saved Telegram notice ${i}. Your care team has updated your next step.`,
  at:new Date(Date.UTC(2026,9,1,0,Math.floor(i*99/23),30)).toISOString(),closed:i===2,
}));
/** @param {{notices?:boolean,firstUnseenNotice?:string|null}} options */
export async function startChatFixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'noreon-chat-v2-'));
  const root = resolve('.');
  // The member page paints shared controls with these utilities, so a real look needs them here too.
  const tailwindEntry = require.resolve('@tailwindcss/postcss');
  const postcss = createRequire(tailwindEntry)('postcss');
  const globals = (await postcss([require('@tailwindcss/postcss')()]).process(readFileSync(join(root,'app/globals.css'),'utf8'),{from:join(root,'app/globals.css')})).css;
  const actions = join(root, 'e2e/chat-v2/actions.ts');
  const radii=readFileSync(join(root,'app/globals.css'),'utf8').split('\n').filter(line=>/^\s*--radius-/.test(line)).join('\n');
  const aliases = Object.fromEntries([
    '@/app/patient/zoe/chat-actions', '@/lib/zoe-chat-actions/actions', '@/lib/zoe-chat-actions/everyday-actions',
    '@/app/patient/actions', '@/app/patient/account/locale-actions', '@/app/patient/account/telegram/zoe-actions',
    '@/lib/zoe-chat-actions/next-step-actions', '@/lib/zoe-chat-actions/visit-request-actions', '@/lib/bp-week/actions', '@/app/patient/learn/actions', '@/app/patient/care/actions', '@/lib/zoe-chat-actions/labs-actions', '@/lib/zoe-chat-actions/consult-actions', '@/lib/zoe-chat-actions/booking-actions', '@/lib/real-booking/actions', '@/lib/patient/answer-transport', '@/lib/zoe-chat-actions/plan-actions', '@/lib/zoe-chat-actions/dose-actions', '@/lib/zoe-chat-actions/onboarding-actions',
    // This action is imported relatively by the production urgent notice.
  ].map(name => [name+'$', actions]));
  await new Promise((done, reject) => webpack({
    mode:'development', devtool:false, context:root, entry:join(root,'e2e/chat-v2/entry.tsx'),
    output:{path:directory,filename:'chat.js'},
    resolve:{extensions:['.tsx','.ts','.js'],alias:{...aliases, '@':root,
      'next/link$':join(root,'e2e/chat-v2/navigation.tsx'), 'next/navigation$':join(root,'e2e/chat-v2/navigation.tsx'),
      [join(root,'app/patient/zoe/urgent/actions.ts')]:actions,
    }},
    module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(root,'e2e/chat-v2/loader.cjs')}]},
    plugins:[new (webpack.NormalModuleReplacementPlugin)(/\.\/actions$/, resource => {
      if(resource.context.endsWith('/patient/zoe/urgent'))resource.request=actions;
    })],
  }, (error, stats) => error ? reject(error) : stats.hasErrors() ? reject(Error(stats.toString({all:false,errors:true}))) : done()));
  let seenThrough = options.firstUnseenNotice === null ? 23 : Math.max(-1, noticeHistory().findIndex(n=>n.id===options.firstUnseenNotice)-1);
  const savedNotices = options.notices ? noticeHistory() : undefined;
  const noticeState = () => savedNotices ? {notices:savedNotices,firstUnseenNotice:savedNotices[seenThrough+1]?.id??null} : {};
  let thread = {...history(),...noticeState()};
  const seenPosts = [];
  let polls = 0;
  let languageRevision = 1;
  let locale = "en";
  let assessment;
  let saves = 0, attempts = 0, failures = 0;
  // Without ?v3 the page gets NO_CARDS, as it does with the switch off.
  const noCards = {enabled:false,cards:[],clearedSeq:null,readingSeq:null};
  let cards = noCards;
  // Synthetic equivalent of stored, verified receipts. Never taken from an open-card input.
  const voiceMessages = new Set();
  let bpSaves = [], measurements = [], opens = [], failSave = false, loseSave = false, saveStatus = null, stalePoll = false;
  let cardReads = 0, taskReplies = false;
  const bpCard = (sourceSeq = null) => {
    const message = thread.messages.find(m => m.seq === sourceSeq);
    const pair = message?.text.match(/^(\d+)\/(\d+)$/);
    const typed = pair ? {systolic:Number(pair[1]),diastolic:Number(pair[2]),pulse:null} : null;
    return {valid:true,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'bp',source:sourceSeq ? 'typed' : 'chip',sourceSeq,state:'open',outcome:{},at:new Date().toISOString(),
      snapshot:{v:1,week:{weekId:'00000000-0000-4000-8000-0000000000bb',date:new Date().toISOString().slice(0,10),slot:'morning',time:'08:00',day:2,days:7,saved:3,expected:28},latest:null,
        ...(typed ? {typed:{...typed,measuredAt:message.at,...(voiceMessages.has(message.seq)?{entrySource:'patient_voice_confirmed'}:{})}} : {})}};
  };
  let openFailure = null, openLost = false, flowMode = null, failFlag = false;
  const flowBase = {ruleVersion:'zones-v1-2026-11-02',outOfHours:false,taskIds:[],sentTo:null,slaHours:null,next:null,provisional:false,zone:null};
  const taskId = '00000000-0000-4000-8000-0000000000aa';
  const flowFor = (mode) => ({
    high:{...flowBase,zone:'yellow',provisional:true,next:'red_flags',slaHours:48},
    repeat:{...flowBase,zone:'yellow',provisional:true,next:'repeat',slaHours:48},
    'after-flags':{...flowBase,zone:'yellow',provisional:true,next:'repeat',slaHours:48},
    final:{...flowBase,zone:'yellow',sentTo:'nurse',slaHours:48,taskIds:[taskId]},
    orange:{...flowBase,zone:'orange',sentTo:'physician',slaHours:4,taskIds:[taskId,'00000000-0000-4000-8000-0000000000ab'],nurseTask:true,outOfHours:true},
    'orange-day':{...flowBase,zone:'orange',sentTo:'physician',slaHours:4,taskIds:[taskId]},
    green:{...flowBase,zone:'green'},
    'no-team':{...flowBase,zone:'yellow',slaHours:48},
  }[mode]);
  const flowCard = (kind,input,parent,item='bp') => ({valid:true,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind,source:'chip',sourceSeq:null,state:'open',outcome:{},at:new Date().toISOString(),
    snapshot:kind==='repeat'?{v:1,first:{systolic:input.systolic,diastolic:input.diastolic},follows:{cardId:parent.id,item},week:parent.snapshot.week}:{v:1,follows:{cardId:parent.id,item},week:parent.snapshot.week,episodeId:'00000000-0000-4000-8000-0000000000cc',readingId:'00000000-0000-4000-8000-0000000000cc',readings:[{sbp:input.systolic,dbp:input.diastolic}]}});
  // V3 onboarding: ?v3&onboarding. Without it the fixture refuses these kinds, as the real page never asks for them.
  let visitRequestMode=false,visitReason='configuration-unavailable',visitHours=[],visitHoursFailed=false,failVisit=null,loseVisit=false;
  let visitRequests=[],visitTasks=new Set();
  let planConfirmations = [], failPlan = false, losePlan = false;
  let doseEvents=[],failDose=false,loseDose=false;
  let doseReasons=[],safetyAlerts=[];
  let onboarding = false, profileSaves = [], reviews = [], consents = [], failProfile = false, loseProfile = false, reviewStatus = null, medicinesRead = 'ok', ownMedicines = [], stoppedMedicines = [], restores = [];
  const newCard = (kind, snapshot, requestId = crypto.randomUUID()) => ({valid:true,id:crypto.randomUUID(),requestId,kind,source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:new Date().toISOString(),snapshot});
  let journey=null;
  const publishedPlan = () => {
        const planId='00000000-0000-4000-8000-000000000008';
        return newCard('plan',{v:1,available:true,plan:{id:planId,version:1,clinician:'Dr. Mariam',publishedAt:'2026-11-02T08:00:00Z',instructions:'Walk as agreed.',medicines:[{name:'Rosuvastatin',dose:'20 mg',times:['20:00']}]},v3:{planId,version:1,clinician:'Dr. Mariam',publishedAt:'2026-11-02T08:00:00Z',teachBackConfirmedAt:null,bp:null,ldl:{target:1.8,current:2.2,reductionPercent:null,status:'above_goal'},lifestyle:'Walk as agreed.',followUp:'Your doctor requested a repeat test.',calendar:[{id:'test',title:'Lipid profile',dueAt:'2026-12-14T08:00:00Z'}]}});
  };
  const doneAt = () => new Date().toISOString().replace('Z','123+00:00');
  const respond = (address, method = 'GET', body = '') => {
    const url = new URL(address);
    const result = (body, contentType = 'application/json') => ({status:200,body:typeof body === 'string' ? body : JSON.stringify(body),contentType});
    if(url.pathname === '/chat.js') return result(readFileSync(join(directory,'chat.js'),'utf8'),'text/javascript; charset=utf-8');
    if(url.pathname === '/overview.css') return result(readFileSync(join(root,'components/chat-v2/overview.css'),'utf8'),'text/css');
    if(url.pathname === '/globals.css') return result(globals,'text/css');
    if(url.pathname === '/chat.css') return result(`:root{${radii}}`+readFileSync(join(root,'components/chat-v2/chat.css'),'utf8'),'text/css');
    if(url.pathname === '/api/patient/zoe/voice') return result({status:'ok',text:'145/92',receipt:'synthetic-voice-receipt'});
    if(url.pathname === '/api/patient/zoe/thread') { polls++; return result({...thread,...noticeState()}); }
    if(url.pathname === '/api/patient/zoe/cards') { journey?.sync(); cardReads++; return result(stalePoll ? {...cards,cards:cards.cards.map(c=>({...c,state:'open',outcome:{}}))} : cards); }
    if(url.pathname === '/fixture/task-seen') { cards={...cards,tasks:[{id:taskId,queue:'nurse',status:'seen',slaDeadline:new Date(Date.now()+3600e3).toISOString(),createdAt:new Date().toISOString()}]}; return result({}); }
    if(url.pathname === '/fixture/visit-state') return result({visitRequests,visitTasks:[...visitTasks],cards});
    if(url.pathname === '/fixture/accept-visit'){
      const input=JSON.parse(body);
      const card=cards.cards.find(c=>c.id===input.cardId&&c.snapshot.living&&c.snapshot.proposal?.proposalId===input.proposalId);
      if(!card)return result({status:'invalid'});
      card.snapshot.living={...card.snapshot.living,status:'confirmed',startsAt:card.snapshot.proposal.startsAt,revision:card.snapshot.living.revision+1};
      const proposalId=card.snapshot.proposal.proposalId;
      card.snapshot.proposal=null;card.state='done';card.outcome={...card.outcome,[`accepted:${proposalId}`]:{proposalId,commandId:input.commandId}};
      return result({status:'ok',card});
    }
    if(url.pathname === '/fixture/living-proposal'){
      const card=cards.cards.find(c=>c.snapshot.living);
      card.snapshot={...card.snapshot,proposal:JSON.parse(body),living:{...card.snapshot.living,status:'awaiting',revision:card.snapshot.living.revision+1}};
      return result(cards);
    }
    if(url.pathname === '/fixture/living-status'){
      const card=cards.cards.find(c=>c.snapshot.living),status=JSON.parse(body).status;
      if(card&&!card.outcome[`visit:${card.id}:${status}`]){
        card.snapshot.living={...card.snapshot.living,status,planId:status==='plan_published'?card.id:null,revision:card.snapshot.living.revision+1};
        card.outcome={...card.outcome,[`visit:${card.id}:${status}`]:{status,doneAt:new Date().toISOString()}};
      }
      return result(cards);
    }
    if(url.pathname === '/fixture/journey-state')return result(journey?.state()??{});
    if(url.pathname === '/fixture/journey-stage'){journey?.stage(JSON.parse(body).stage);return result({});}
    if(url.pathname === '/fixture/plan-state') return result({planConfirmations,cards});
    if(url.pathname === '/fixture/dose-state') return result({doseEvents,doseReasons,safetyAlerts,cards});
    if(url.pathname === '/fixture/replace-plan') {
      const previous=cards.cards.findLast(c=>c.kind==='plan');
      const snapshot=structuredClone(previous.snapshot);
      snapshot.plan.id='00000000-0000-4000-8000-000000000009';snapshot.plan.version=2;
      snapshot.v3.planId=snapshot.plan.id;snapshot.v3.version=2;snapshot.v3.teachBackConfirmedAt=null;
      cards={...cards,cards:[...cards.cards,newCard('plan',snapshot)]};return result({});
    }
    if(url.pathname === '/fixture/bp-state') return result({saves:bpSaves,measurements,opens,cards,cardReads});
    if(url.pathname === '/fixture/onboarding-state') return result({profileSaves,reviews,restores,consents,opens,cards,ownMedicines,stoppedMedicines});
    if(url.pathname === '/fixture/arrive-card') { cards={...cards,cards:[...cards.cards,bpCard()]}; return result({}); }
    if(url.pathname === '/fixture/reply') { thread={...thread,version:thread.version+1,replies:[...thread.replies,{id:crypto.randomUUID(),doctorName:'Dr. Mariam',text:'A new doctor reply',at:new Date().toISOString()}]}; return result({}); }
    if(url.pathname === '/fixture/notice' && savedNotices) {
      const notice={id:crypto.randomUUID(),text:'Saved Telegram notice just received.',at:'2026-10-01T03:00:00.000Z',closed:false};
      savedNotices.push(notice); thread={...thread,version:thread.version+1,...noticeState()};return result(notice);
    }
    if(url.pathname === '/fixture/seen')return result({seenThrough,seenPosts,...noticeState()});
    if(url.pathname === '/api/patient/zoe/notices/seen' && method === 'POST' && savedNotices) {
      const {id}=JSON.parse(body||'{}');
      const index=savedNotices.findIndex(n=>n.id===id);
      if(index<0)return {status:400,body:JSON.stringify({ok:false}),contentType:'application/json'};
      seenPosts.push(id); seenThrough=Math.max(seenThrough,index);
      thread={...thread,...noticeState()};return result({ok:true});
    }
    if(url.pathname === '/fixture/polls') return result(polls);
    if(url.pathname === '/fixture/assessment') {
      if(url.pathname === '/patient/progress/earlier/upload') return result({status:opens.some(o=>o.kind==='document')?'duplicate':'stored',id:'00000000-0000-4000-8000-0000000000dd'});
    if(method === 'POST') { assessment=JSON.parse(body); saves=0; attempts=0; failures=0; }
      return result({assessment,saves,attempts});
    }
    if(url.pathname === '/patient/progress/earlier/upload') return result({status:opens.some(o=>o.kind==='document')?'duplicate':'stored',id:'00000000-0000-4000-8000-0000000000dd'});
    if(method === 'POST') {
      const input=JSON.parse(body||'{}');
      let answer={ok:true};
      if(url.pathname === '/fixture/follow-next-step')return result(journey?.follow(input.cardId)??{status:'disabled'});
      if(url.pathname === '/fixture/read-plan')return result({status:'unavailable'});
      if(url.pathname === '/fixture/send-card'){
        const card=cards.cards.find(c=>c.id===input.cardId&&c.kind==='message');
        if(!card)return result({status:'invalid'});
        const at=doneAt();card.state='done';card.outcome={['sent:'+input.requestId]:{doneAt:at}};
        thread={...thread,version:thread.version+1,messages:[...thread.messages,{requestId:input.requestId,text:input.text,seq:thread.messages.length+1,at,channel:'app'}]};
        return result({status:'ok',card});
      }
      if(url.pathname === '/fixture/open-card') {
        opens.push(input);
        if(openFailure) { openFailure=null; return result({status:'failed'}); }
        if(input.kind !== 'bp' && !(onboarding && ['profile','medicines','visit','document','symptom_gate','consult_questions','plan','results','message'].includes(input.kind))) throw Error('Hidden card opened');
        const existing = cards.cards.find(c => c.requestId === input.requestId || input.kind==='visit'&&c.kind==='visit'&&c.snapshot.living);
        if(existing) return result({status:'ok',card:existing});
        const card = input.kind === 'results' ? newCard('results',{v:1,available:true,publishedAt:null,rows:[],more:0},input.requestId)
          : input.kind === 'message' ? newCard('message',{v:1},input.requestId)
          : input.kind === 'plan' ? {...publishedPlan(),requestId:input.requestId}
          : input.kind === 'symptom_gate' ? newCard('symptom_gate',{v:1},input.requestId)
          : input.kind === 'consult_questions' ? newCard('consult_questions',{v:1,appointmentId:null,groups:['symptoms','medicines','results'].map(label=>({label,text:''}))},input.requestId)
          : input.kind === 'visit' ? newCard('visit',{v:1,available:true,next:visitRequestMode?null:{appointmentId:'00000000-0000-4000-8000-0000000000aa',revision:1,status:'confirmed',startsAt:'2026-11-03T05:00:00Z',endsAt:'2026-11-03T05:30:00Z',mode:'clinic',location:'Synthetic clinic'},proposal:null,attention:false,bookingToken:'a'.repeat(64)},input.requestId)
          : input.kind === 'profile' ? newCard('profile',{v:1,wake:'07:00',sleep:'22:00'},input.requestId)
          : input.kind === 'medicines' ? newCard('medicines',{v:1,token:'a'.repeat(64)},input.requestId)
          : {...bpCard(input.sourceSeq),requestId:input.requestId};
        cards={...cards,cards:[...cards.cards,card],clearedSeq:null,readingSeq:null};
        if(openLost) { openLost=false; return {status:503,body:'Lost opening reply'}; }
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/save-bp') {
        bpSaves.push(input);
        if(failSave) { failSave=false; return result({status:'failed'}); }
        if(saveStatus) return result({status:saveStatus});
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(!measurements.some(m=>m.submissionId===input.submissionId)) measurements.push(input);
        // The time as the database writes it into the stored outcome: microseconds and an offset.
        if(!card.outcome.bp) card.outcome={bp:{systolic:input.systolic,diastolic:input.diastolic,pulse:input.pulse,measuredAt:input.measuredAt,submissionId:input.submissionId,doneAt:new Date().toISOString().replace('Z','123+00:00')}};
        card.state='done';
        // ?flow=: the rules' outcome for this reading, as the server would record it.
        if(flowMode){
          const flow=flowFor(flowMode,input);
          card.outcome.bp.flow=flow;
          const next=flow.next?flowCard(flow.next,input,card):null;
          if(next){
            // The flow posts before the action record commits, as production does.
            card.outcome.bp.doneAt=new Date(Date.parse(next.at)+10).toISOString();
            cards={...cards,cards:[...cards.cards,next]};
          }
          answer={status:'ok',card,...(next?{next}:{})};
          return result(answer);
        }
        if(loseSave) { loseSave=false; return {status:503,body:'Lost reply'}; }
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/save-repeat') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        const flow=flowFor(flowMode==='no-team'?'no-team':'final',input);
        card.outcome={bp:{systolic:input.systolic,diastolic:input.diastolic,pulse:input.pulse,measuredAt:input.measuredAt,submissionId:input.submissionId,flow,doneAt:new Date().toISOString()}};
        card.state='done';
        measurements.push(input);
        return result({status:'ok',card});
      }
      if(url.pathname === '/fixture/answer-flag') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(failFlag) return {status:503,body:'Lost reply'};
        const doneAt=new Date().toISOString();
        if(input.answer){
          const requestId=crypto.randomUUID(),text=`Fixed message ${input.question}`;
          card.outcome[`a:${input.question}`]={answer:true,alerted:true,requestId,text,doneAt};
          card.state='done';
          thread={...thread,version:thread.version+1,messages:[...thread.messages,{seq:thread.messages.length+1,requestId,text,channel:'app',at:new Date(Date.now()+1).toISOString()}]};
          return result({status:'ok',card});
        }
        const last=input.question==='faint';
        const flow=last?flowFor('after-flags',{systolic:166,diastolic:98}):undefined;
        card.outcome[`a:${input.question}`]={answer:false,...(flow?{flow}:{}),doneAt};
        if(last)card.state='done';
        const next=flow?.next?flowCard(flow.next,{systolic:166,diastolic:98},card,`a:${input.question}`):null;
        if(next){
          card.outcome[`a:${input.question}`].doneAt=new Date(Date.parse(next.at)+10).toISOString();
          cards={...cards,cards:[...cards.cards,next]};
        }
        return result({status:'ok',card,...(next?{next}:{})});
      }
      if(url.pathname === '/fixture/open-document') {
        opens.push({kind:'document'});
        if(openFailure){openFailure=null;return result({status:'failed'});}
        const existing=cards.cards.find(c=>c.requestId===input.requestId);if(existing)return result({status:'ok',card:existing});
        const card=newCard('document',{v:1,document:{id:input.documentId,fileName:'lipids.pdf',mime:'application/pdf',docType:null,studyDate:null,uploaderRole:'member',readStatus:'not_read',classificationConfidence:null}},input.requestId);
        cards={...cards,cards:[...cards.cards,card]}; answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/save-document') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        card.outcome={document:{...input,fresh:input.docType==='lab'&&input.studyDate==='2026-10-12'&&input.medicineChangedSince===false,doneAt:doneAt()}};card.state='done';answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/read-visit') {
        if(!visitRequestMode)answer={status:'unavailable'};
        else answer={status:'ok',data:{token:'a'.repeat(64),hold:visitReason==='urgent'?'urgent':null,crisis:visitReason==='urgent',requestEnabled:cards.enabled,
          requestDays:visitHoursFailed?null:preferredVisitDays(visitHours),booking:visitReason==='urgent'?null:{
            data:{requests:[],clinicalHold:visitReason==='clinical-hold',legacyCreationAvailable:false},
            pilot:{available:false,unavailableReason:visitReason,appointments:[],offers:[],program:[]},
            pricing:undefined,decision:{urgency:'green',findings:[]},homeAvailable:false,doneTestIds:[],
          }}};
      }
      if(url.pathname === '/fixture/request-visit') {
        const parsed=requestVisitInput.safeParse(input),card=cards.cards.find(c=>c.id===input.cardId);
        if(!cards.enabled||!visitRequestMode)return result({status:'disabled'});
        if(!parsed.success||!card)return result({status:'invalid'});
        if(card.state==='done')return result({status:'ok',card});
        if(!card.claims.booking&&!preferredVisitDays(visitHours).includes(parsed.data.day))return result({status:'invalid'});
        const {day,window,note}=parsed.data;
        const claim=card.claims.booking??{op:input.opId,payload:{kind:'visit_request',day,window,note,locale}};
        card.claims.booking=claim;
        if(day!==claim.payload.day||window!==claim.payload.window||note!==claim.payload.note)return result({status:'stale',card});
        visitTasks.add(`visit-request:${card.id}`);
        if(failVisit==='task'){failVisit=null;return result({status:'unavailable',card});}
        const text=visitRequestMessage(claim.payload,claim.payload.locale);
        if(!visitRequests.some(r=>r.opId===claim.op)){
          visitRequests.push({opId:claim.op,...claim.payload,text});
          thread={...thread,version:thread.version+1,messages:[...thread.messages,{seq:thread.messages.length+1,requestId:claim.op,text,channel:'app',at:new Date().toISOString()}]};
        }
        if(failVisit==='message'){failVisit=null;return result({status:'unavailable',card});}
        card.outcome={booking:{...claim.payload,requestId:claim.op,dialog:true,ok:true,doneAt:doneAt()}};card.state='done';
        if(loseVisit){loseVisit=false;return {status:503,body:'Lost visit request reply'};}
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/admin-visit') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        card.outcome={booking:{kind:'admin_change',dialog:true,ok:true,doneAt:doneAt()}};card.state='done';answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/lab-reply') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(url.searchParams.has('fail'))return result({status:'unavailable'});
        card.outcome={[card.kind]:{answer:input.answer,doneAt:doneAt()}};card.state='done';answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/symptom-gate' || url.pathname === '/fixture/consult-questions') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        const gate=url.pathname === '/fixture/symptom-gate';
        const text=gate?(input.choice==='acute'?CONSULT.acuteMessage:CONSULT.plannedMessage)[input.locale]:consultQuestionsText(input.locale,input.groups);
        respond(new URL('/fixture/send',url).href,'POST',JSON.stringify({requestId:input.opId,text,toDoctor:true}));
        card.outcome={[card.kind]:{choice:input.choice,requestId:input.opId,sent:true,doneAt:doneAt()}};card.state='done';answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/arrive-lab') {
        const card=newCard(input.kind,{v:1,appointmentId:'00000000-0000-4000-8000-0000000000aa',revision:1,startsAt:'2026-11-03T05:00:00Z',location:'Synthetic clinic',preparation:'Water only\nFollow your clinic instructions'});
        cards={...cards,cards:[...cards.cards,card]};answer={card};
      }
      if(url.pathname === '/fixture/confirm-plan') {
        if(failPlan) { failPlan=false; return result({status:'failed'}); }
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(!card?.snapshot.v3)return result({status:'invalid'});
        if(!card.outcome.plan) {
          const at=doneAt();
          planConfirmations.push(card.snapshot.plan.id);
          card.outcome={plan:{planId:card.snapshot.plan.id,confirmedAt:at,doneAt:at}};card.state='done';
          if(journey?.state().phase==='plan_published')journey.stage('teach_back');
        }
        if(losePlan) { losePlan=false; return {status:503,body:'Lost reply'}; }
        return result({status:'ok',card});
      }
      if(url.pathname === '/fixture/dose') {
        if(failDose){failDose=false;return result({status:'unavailable'});}
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(!card||!card.snapshot.v3)return result({status:'invalid'});
        const item=`dose:${input.medicineId}:${Date.parse(input.dueAt)}`;
        if(!card.outcome[item]){
          doseEvents.push({medicineId:input.medicineId,dueAt:input.dueAt,status:input.status});card.outcome={[item]:{status:input.status,doneAt:doneAt()}};card.state='done';
          if(input.status==='skipped'){const next=newCard('ask',{v:1,v3:true,askId:card.id,name:card.snapshot.slots[0].name,dueAt:input.dueAt,trigger:'skipped'});cards={...cards,cards:[...cards.cards,next]};}
        }
        if(loseDose){loseDose=false;return {status:503,body:'Lost reply'};}
        return result({status:'ok',card,next:cards.cards.find(c=>c.kind==='ask'&&c.snapshot.askId===card.id)});
      }
      if(url.pathname === '/fixture/dose-reason') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(!card||!card.snapshot.v3)return result({status:'invalid'});
        if(!card.outcome.answer){
          doseReasons.push({reason:input.reason,later:input.later});card.outcome={answer:{reason:input.reason,later:input.later,doneAt:doneAt()}};card.state='done';
          if(input.reason==='side_effect_or_fear'){const next=newCard('sams',{v:1,episodeId:card.id});cards={...cards,cards:[...cards.cards,next]};}
        }
        return result({status:'ok',card,next:cards.cards.find(c=>c.kind==='sams'&&c.snapshot.episodeId===card.id)});
      }
      if(url.pathname === '/fixture/sams') {
        const card=cards.cards.find(c=>c.id===input.cardId);
        if(!card||card.kind!=='sams')return result({status:'invalid'});
        const item=samsItem(input.question);
        if(!card.outcome[item]){
          const answers={...samsAnswers(card),[input.question]:input.answer},zone=evaluateSams(answers).zone;
          const red=zone==='red',done=red||input.question==='rightUpperPain';
          card.outcome={...card.outcome,[item]:{answer:input.answer,doneAt:doneAt(),...(red?{zone,requestId:crypto.randomUUID(),text:'I have muscle symptoms with warning signs.',alerted:true}:done?{flow:{...flowBase,zone,sentTo:zone==='orange'?'physician':null,slaHours:4}}:{})}};
          if(red)safetyAlerts.push({episode:card.snapshot.episodeId});
          if(done)card.state='done';
        }
        return result({status:'ok',card});
      }
      if(url.pathname === '/fixture/consent') consents.push(input);
      if(url.pathname === '/fixture/save-profile') {
        profileSaves.push(input);
        if(failProfile) { failProfile=false; return result({status:'failed'}); }
        const card=cards.cards.find(c=>c.id===input.cardId);
        card.outcome={profile:{channel:input.channel,wake:input.wake,sleep:input.sleep,caregiver:!!input.caregiver,doneAt:doneAt()}};card.state='done';
        if(loseProfile) { loseProfile=false; return {status:503,body:'Lost reply'}; }
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/read-medicines') {
        answer=medicinesRead === 'ok' ? {status:'ok',data:{plan:[{id:'p1',name:'Bisoprolol',dose:'5 mg',times:['08:00']}],own:ownMedicines,stopped:stoppedMedicines}} : {status:medicinesRead};
      }
      if(url.pathname === '/fixture/review-medicines') {
        reviews.push(input);
        if(reviewStatus) { const status=reviewStatus; reviewStatus=null; return result(status === 'limit' ? {status:'failed',review:'limit',released:true} : {status}); }
        const card=cards.cards.find(c=>c.id===input.cardId);
        const rows=[...input.changes.map(x=>({name:ownMedicines.find(m=>m.id===x.id).name,status:x.status,stopReason:x.stopReason,added:false})),...input.added.map(x=>({name:x.name,status:x.status,stopReason:x.stopReason,added:true}))];
        for(const change of input.changes.filter(x=>x.status==='course_stopped')){
          const row=ownMedicines.find(m=>m.id===change.id);
          ownMedicines=ownMedicines.filter(m=>m!==row);stoppedMedicines=[...stoppedMedicines,{...row,status:change.status,stopReason:change.stopReason}];
        }
        card.outcome={medicines:{kind:'review',status:'saved',rows,doneAt:doneAt()}};card.state='done';
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/restore-medicine') {
        restores.push(input);
        const card=cards.cards.find(c=>c.id===input.cardId);
        const row=stoppedMedicines.find(m=>m.id===input.id);
        stoppedMedicines=stoppedMedicines.filter(m=>m!==row);ownMedicines=[...ownMedicines,{...row,status:null,stopReason:null}];
        card.outcome={medicines:{kind:'review',status:'saved',rows:[{name:row.name,status:'restored',stopReason:null,added:false}],doneAt:doneAt()}};card.state='done';
        answer={status:'ok',card};
      }
      if(url.pathname === '/fixture/answer-failure') failures=input.remaining;
      if(url.pathname === '/fixture/answers') {
        attempts++;
        if(failures > 0) { failures--; answer={ok:false,reason:'unavailable'}; }
        else if(!assessment || input.expectedAssessmentId !== assessment.id || input.expectedRevision !== assessment.revision) answer={ok:false,reason:'conflict'};
        else {
          assessment={...assessment,answers:input.nextAnswers,revision:assessment.revision+1}; saves++;
          answer={ok:true,revision:assessment.revision};
        }
      }
      if(url.pathname === '/fixture/complete') {
        if(!assessment || input.id !== assessment.id || input.revision !== assessment.revision) answer={ok:false,reason:'conflict'};
        else { assessment={...assessment,revision:assessment.revision+1,completedAt:'2026-11-01T12:00:00.000Z'}; answer={ok:true,revision:assessment.revision}; }
      }
      if(url.pathname === '/fixture/send') {
        if(input.text === 'refuse') answer={status:'not_eligible'};
        else if(input.text === 'offline') answer={status:'failed'};
        else {
          thread={...thread,version:thread.version+1,messages:[...thread.messages,{seq:thread.messages.length+1,requestId:input.requestId,text:input.text,channel:'app',at:new Date().toISOString()}]};
          if(input.voiceReceipt==='synthetic-voice-receipt' && input.text==='145/92')voiceMessages.add(thread.messages.length);
          // The pipeline's fixed reply to an exact task phrase, in either mode.
          if(taskReplies && /^(I took my medicines|I want to record my blood pressure)$/.test(input.text)) thread={...thread,answers:[...thread.answers,{id:crypto.randomUUID(),text:'You can do that on the card here.',at:new Date().toISOString()}]};
          if(cards.enabled) cards={...cards,readingSeq:thread.messages.length};
          answer={status:'sent',thread};
        }
      }
      if(url.pathname === '/fixture/language') {
        if(input.expectedRevision !== languageRevision || input.expectedLocale !== locale) answer={ok:false,reason:'conflict'};
        else { languageRevision++; locale=input.locale; answer={ok:true,revision:languageRevision}; }
      }
      if(url.pathname === '/fixture/urgent-status')answer={alerted:false,pending:false};
      return result(answer);
    }
    // Mirrors the page's own gate; scripts/check-chat-overview.ts runs the real route with the switches off.
    const overviewPage = url.pathname === '/patient/chat/overview';
    if(url.pathname !== '/patient/chat' && !(overviewPage && url.searchParams.has('v3'))) return {status:404,body:''};
    if(savedNotices)thread={...thread,...noticeState()};
    else if(!url.searchParams.has('keep')) thread = url.searchParams.has('empty') ? {...history(),replies:[]} : history();
    polls=0;
    if(!url.searchParams.has('keep')) {
      journey=null;
      cards=url.searchParams.has('v3') ? {...noCards,enabled:true} : noCards;
      bpSaves=[]; measurements=[]; opens=[]; cardReads=0; taskReplies=url.searchParams.has('task-replies');
      openFailure=url.searchParams.has('fail-open'); openLost=url.searchParams.has('lose-open'); failSave=url.searchParams.has('fail-save'); loseSave=url.searchParams.has('lose-save'); saveStatus=url.searchParams.get('save-status'); stalePoll=url.searchParams.has('stale-poll');
      flowMode=url.searchParams.get('flow'); failFlag=url.searchParams.has('fail-flag');
      planConfirmations=[]; failPlan=url.searchParams.has('fail-plan'); losePlan=url.searchParams.has('lose-plan');
      doseEvents=[];failDose=url.searchParams.has('fail-dose');loseDose=url.searchParams.has('lose-dose');
      doseReasons=[];safetyAlerts=[];
      if(cards.enabled&&url.searchParams.has('dose'))cards={...cards,cards:[newCard('dose',{v:1,v3:true,enabled:true,date:'2026-11-02',slots:[{medicineId:'00000000-0000-4000-8000-00000000d008',planId:'00000000-0000-4000-8000-000000000008',name:'Rosuvastatin',dose:'20 mg',time:'20:00',dueAt:'2026-11-02T16:00:00Z',status:'due',revision:0}]})]};
      if(cards.enabled && url.searchParams.has('plan')) {
        cards={...cards,cards:[publishedPlan()]};
      }
      visitRequestMode=url.searchParams.has('visit-request');visitReason=url.searchParams.get('visit-reason')||'configuration-unavailable';
      visitHours=url.searchParams.has('sunday-hours')?[{weekday:7}]:[];visitHoursFailed=url.searchParams.has('hours-failed');
      failVisit=url.searchParams.get('fail-visit');loseVisit=url.searchParams.has('lose-visit');visitRequests=[];visitTasks=new Set();
      onboarding=url.searchParams.has('onboarding'); profileSaves=[]; reviews=[]; consents=[]; restores=[]; stoppedMedicines=[];
      failProfile=url.searchParams.has('fail-profile'); loseProfile=url.searchParams.has('lose-profile'); reviewStatus=url.searchParams.get('review-status'); medicinesRead=url.searchParams.get('medicines-read')||'ok';
      ownMedicines=[{id:'00000000-0000-4000-8000-00000000a001',name:'Atorvastatin',dose:'20 mg',times:['21:00'],status:null,stopReason:null},{id:'00000000-0000-4000-8000-00000000a002',name:'Amoxicillin',dose:null,times:['08:00'],status:null,stopReason:null}];
      if(url.searchParams.has('unreadable')) cards={...cards,cards:[{...bpCard(),valid:false,snapshot:{}}]};
      if(url.searchParams.has('closed')) cards={...cards,cards:[{...bpCard(),state:'done'}]};
      if(url.searchParams.has('living-visit')){
        const card=newCard('visit',{v:1,available:true,next:null,proposal:null,attention:false,living:{visitId:'00000000-0000-4000-8000-00000000b001',source:'appointment',revision:1,status:'awaiting',startsAt:'2026-11-08T10:00:00Z',location:'Synthetic clinic',preparation:null,planId:null}});
        card.id=card.snapshot.living.visitId;card.state='done';card.outcome={[`visit:${card.id}:awaiting`]:{status:'awaiting',doneAt:card.at}};
        if(url.searchParams.has('living-proposal')){
          card.state='open';card.snapshot.proposal={appointmentId:card.id,proposalId:'00000000-0000-4000-8000-00000000b002',startsAt:'2026-11-08T10:00:00Z',endsAt:'2026-11-08T11:00:00Z',clinicName:'Synthetic clinic',clinicAddress:'Synthetic address'};
        }
        cards={...cards,cards:[card]};
      }
    }
    if(url.searchParams.has('keep')&&url.searchParams.has('visit-reason'))visitReason=url.searchParams.get('visit-reason');
    if(url.searchParams.has('journey')&&!journey&&cards.enabled)journey=journeyFixture(()=>cards,next=>{cards=next;},()=>assessment,newCard,publishedPlan);
    journey?.sync();
    if(cards.enabled) thread={...thread,suggestionState:{locale:url.searchParams.get('locale')||'en',consent:true,emergency:false,safetyHold:false,medicineDue:true,bpDue:true,visitProposal:false,visitToBook:true,planToRead:true,resultsToRead:true,doctorReply:false}};
    languageRevision=url.searchParams.has('anamnesis') ? assessment?.revision ?? 1 : 1; locale=url.searchParams.get('locale')||'en';
    voiceMessages.clear();
    const fixture = {voice:url.searchParams.has('v3')?{microphone:url.searchParams.has('voice'),conversation:url.searchParams.has('conversation')}:undefined,overview:url.searchParams.has('v3'),signup:url.searchParams.has('signup'),thread,cards,locale,...(onboarding?{onboarding:{profileRequest:url.searchParams.has('no-offer')?null:'00000000-0000-4000-8000-00000000f001'}}:{}),consent:url.searchParams.has('consent'),unavailable:url.searchParams.has('unavailable'),
      assessment:url.searchParams.has('anamnesis') ? assessment : undefined, emergencyCard:!url.searchParams.has('full-urgent'),memberPush:url.searchParams.has('push')?{publicKey:'BAECAwQ'}:undefined};
    return result(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/chat.css"><link rel="stylesheet" href="/overview.css"><style>*{box-sizing:border-box}html,body{margin:0}button,input{font:inherit}body{min-height:100vh}button{border:0}svg{flex:none}</style></head><body><div id="root"></div><script>window.process={env:{}}</script><script>window.fixture=${JSON.stringify(fixture).replaceAll('<','\\u003c')}</script><script src="/chat.js"></script></body></html>`, 'text/html');
  };
  return {url:'http://127.0.0.1',respond,close:async()=>rmSync(directory,{recursive:true,force:true})};
}
