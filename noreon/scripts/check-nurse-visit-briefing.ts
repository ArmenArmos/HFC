import assert from 'node:assert/strict';
import type {NurseVisitReady,NurseVisitItem} from '@/lib/nurse-visit/schema';
import * as parser from '@/lib/nurse-visit/chat-parser';
import * as copy from '@/lib/nurse-visit/copy';
const parse=(parser as unknown as {parseVisitShortcut:typeof import('@/lib/nurse-visit/chat-parser').parseVisitShortcut}).parseVisitShortcut;
assert.equal(typeof parse,'function','A typed visit must prepare a draft instead of writing immediately');
const items:NurseVisitItem[]=[
 {key:'measure:bp',kind:'measurement',field:'bp',mark:null},
 {key:'measure:weight',kind:'measurement',field:'weight',mark:null},
 {key:'measure:waist',kind:'measurement',field:'waist',mark:null},
 {key:'sample:lipid-panel',kind:'sample',testId:'lipid-panel',title:'Lipid panel',mark:null},
 {key:'sample:hba1c-glucose',kind:'sample',testId:'hba1c-glucose',title:'HbA1c and fasting glucose',mark:null},
];
// E16: natural visit dictation is a complete local draft in each nurse language.
for(const [l,bp,pulse,waist,weight,kg,cm,all,and] of [
 ['en','Blood pressure','pulse','waist circumference','weight','kg','cm','Samples collected.','and'],
 ['ru','АД','пульс','обхват талии','вес','кг','см','Образцы взяты.','и'],
 ['hy','ճնշում','զարկերակ','գոտկատեղի շրջագիծ','քաշ','կգ','սմ','Նմուշները վերցված են։','և'],
] as const){
 for(const join of [', ',` ${and} `]){
  const d=parse(items,`${bp} 138/88${join}${pulse} 72, ${weight} 84 ${kg}, ${waist} 96 ${cm}. ${all}`,l);
  assert.deepEqual(d.measurements,{'measure:bp':'138/88 72','measure:weight':'84','measure:waist':'96'});
  assert.deepEqual(d.untouched,[]);assert.ok(d.samples.every(s=>s.status==='collected'));assert.equal(d.samples.length,2);
 }
 for(const value of ['84','84,5',`84,5 ${kg}`])assert.equal(parse(items,`${weight} ${value}`,l).measurements['measure:weight'],value==='84'?'84':'84.5');
 for(const suffix of ['; call me later',`; HbA1c`, '; except unknown'])assert.equal(parse(items,`${bp} 138/88, ${pulse} 72; ${all}${suffix}`,l).samples.length,0,'New bulk aliases retain the whole-message safety gate');
 for(const words of [`${pulse} 72 or 74`,`${pulse} 72, ${pulse} 74`]){
  const d=parse(items,`${bp} 138/88, ${words}; ${all}`,l);
  assert.equal(d.measurements['measure:bp'],'','An ambiguous pulse must not turn into a saved BP with no pulse');assert.ok(d.untouched.length);assert.equal(d.samples.length,0);
 }
}
assert.deepEqual(parse(items,'Blood pressure 138/88, pulse 72, weight 84 kg, waist 96 cm. Samples collected.','en').measurements,{'measure:bp':'138/88 72','measure:weight':'84','measure:waist':'96'});
for(const all of ['all samples collected','all samples taken','все пробы собраны','все образцы взяты','բոլոր նմուշները հավաքված են'])assert.equal(parse(items,all,'en').samples.length,2,all);
// A second measurement must preserve the evidence for both values, including identical repeats.
for(const text of ['weight 72 kg; weight 73 kg; BP 142/88','weight 72 kg; weight 72 kg; BP 142/88']){
 const d=parse(items,text,'en');
 assert.equal(d.measurements['measure:weight'],'');
 assert.deepEqual(d.untouched,text.split('; ').slice(0,2));
 assert.equal(d.measurements['measure:bp'],'142/88');
}
for(const text of ['all samples taken; everything but HbA1c; tube broke','all samples taken; except: HbA1c','все образцы взяты; за исключением HbA1c','բոլոր նմուշները վերցված են; բացառությամբ HbA1c','all samples taken; call me later','HbA1c; all samples taken']){
 assert.equal(parse(items,text,'en').samples.length,0,`${text}: the whole message must be accounted for before prefilling collection`);
}
for(const name of ['Sodium','Натрий','Նատրիում','ApoB'])assert.equal(parse(items,`all samples taken except HbA1c, ${name}`,'en').samples.length,0,'A catalogue test outside the ordered list must not become a reason');
assert.equal(parse(items.filter(i=>i.key!=='sample:lipid-panel'),'all samples taken except HbA1c, Lipid panel','en').samples.length,0,'Legacy catalogue aliases remain test names even when not ordered');
const namedCheck:NurseVisitItem={kind:'check',key:'check:fixture',checkId:'fixture',version:'protocol-draft-2',section:'sampling',label:{en:'HbA1c',hy:'HbA1c'},source:'fixture',mark:null};
assert.equal(parse([...items,namedCheck],'all samples taken; done HbA1c','en').samples.length,0,'A recognised command containing a test name still cannot qualify bulk collection safely');
for(const join of [', ',' and ',' и ',' և ']){
 const d=parse(items,`all samples taken except HbA1c${join}Lipid panel, tubes broke`,'en');
 assert.deepEqual(d.samples.map(s=>[s.testId,s.status,s.reason]),[['lipid-panel','not-collected','tubes broke'],['hba1c-glucose','not-collected','tubes broke']]);
}
const noReason=parse(items,'all samples taken except HbA1c, Lipid panel','en');
assert.equal(noReason.samples.length,2);
assert.ok(noReason.samples.every(s=>s.status==='pending'&&s.reason===''),'Test names never become reasons; missing reasons leave excluded statuses unset');
for(const [l,weight,waist,bp,pulse,kg,cm,mmhg,bpm] of [
 ['en','weight','waist','BP','pulse','kg','cm','mmHg','bpm'],
 ['hy','քաշ','գոտկատեղ','ճնշում','զարկերակ','կգ','սմ','մմ ս.ս.','զարկ'],
 ['ru','вес','талия','АД','пульс','кг','см','мм рт. ст.','уд/мин'],
] as const){
 for(const [text,key] of [[`${weight} 72 ${cm}`,'measure:weight'],[`${waist} 91 ${kg}`,'measure:waist'],[`${bp} 142/88 ${kg}`,'measure:bp'],[`${bp} 142/88 ${pulse} 76 ${cm}`,'measure:bp'],[`${weight} 72 lb`,'measure:weight']] as const){
  const d=parse(items,text,l);
  assert.equal(d.measurements[key],'',`${text}: incompatible units leave the field empty`);
  assert.deepEqual(d.untouched,[text],`${text}: rejected units remain visible`);
 }
 assert.deepEqual(parse(items,`${weight} 72 ${kg}; ${waist} 91 ${cm}; ${bp} 142/88 ${mmhg} ${pulse} 76 ${bpm}`,l).measurements,{'measure:weight':'72','measure:waist':'91','measure:bp':'142/88 76'});
 assert.deepEqual(parse(items,`${weight} 72; ${waist} 91; ${bp} 142/88 76`,l).measurements,{'measure:weight':'72','measure:waist':'91','measure:bp':'142/88 76'});
}
for(const [l,text,reason] of [
 ['en','arrived, BP 142/88 pulse 76, all samples taken except HbA1c, tube broke','tube broke'],
 ['ru','прибыла, АД 142/88 пульс 76, все образцы взяты кроме HbA1c, пробирка разбилась','пробирка разбилась'],
 ['hy','ժամանել եմ, ճնշում 142/88 զարկերակ 76, բոլոր նմուշները վերցված են բացի HbA1c, փորձանոթը կոտրվեց','փորձանոթը կոտրվեց'],
] as const){
 const d=parse(items,text,l);
 assert.equal(d.arrived,true);assert.equal(d.measurements['measure:bp'],'142/88 76');
 assert.deepEqual(d.samples.map(s=>[s.testId,s.status,s.reason]),[['lipid-panel','pending',''],['hba1c-glucose','not-collected',reason]]);
 assert.deepEqual(d.untouched,[]);
}
for(const text of ['BP 142/88,76','BP 142/88 and 76','АД 142/88 и 76','ճնշում 142/88 և 76','BP 142','BP 142 or 144/88','BP 142.5/88','BP 142/88 pulse 76 or 78','BP 142/88, BP 144/90'])assert.equal(parse(items,text,'en').measurements['measure:bp'],'',text);
for(const text of ['weight 72.5, waist 91.2','weight 72,5, waist 91,2'])assert.deepEqual(parse(items,text,'en').measurements,{'measure:weight':'72.5','measure:waist':'91.2'});
assert.equal(parse(items,'weight 72 or 75','en').measurements['measure:weight'],'');
assert.equal(parse(items,'not arrived, no samples taken','en').arrived,null);
assert.equal(parse(items,'all samples taken except unknown test, tube broke','en').samples.length,0,'An unknown exception must never mark every sample collected');
assert.equal(parse(items,'all samples taken except HbA1c','en').samples.find(s=>s.testId==='hba1c-glucose')?.reason,'','A reason is required, never invented');
assert.deepEqual(parse(items.filter(i=>i.kind==='sample'),'BP 142/88','en').measurements,{},'No measurement item is invented');
assert.ok(parse(items,'call me later','en').untouched.includes('call me later'));
const data:NurseVisitReady={version:'nurse-visit-v1',enabled:true,today:'2026-11-06',checklistVersion:'protocol-draft-2',caseRevision:3,visit:{id:'fixture',source:'appointment',memberId:'fixture',memberName:'Narine',arrangementToken:'fixture',startsAt:'2026-11-06T08:00:00Z',endsAt:null,mode:'home',location:'Yerevan',bookingStatus:'confirmed',completion:null},items,steps:[],counts:{samplesPlanned:2,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]},completion:null};
for(const l of ['en','hy','ru'] as const){
 const briefing=copy.visitBriefing(data,l);
 assert.ok(briefing.includes('Narine'));assert.ok(briefing.includes('Yerevan'));assert.ok(briefing.includes('12:00'));
 assert.ok(briefing.includes(copy.visitSampleShortTitle(items[3] as Extract<NurseVisitItem,{kind:'sample'}>,l)));
 if(l!=='en')assert.doesNotMatch(briefing,/You have|To do|Confirm|Blood pressure|Complete blood count|Fasting glucose/);
 assert.equal(copy.visitBlockCopy(l).progress(3,6),l==='en'?'3 of 6':l==='hy'?'3՝ 6-ից':'3 из 6');
}
console.log('Visit briefing/shortcut: three languages, real tasks, decimal readings, ambiguous and absent fields, translated arrival/collection/exception words passed.');

// Catch lost collection revisions, invented confirmation and writes made during preview preparation.
const {shortcutActions,shortcutCommand}=await import('@/lib/nurse-visit/shortcut');
const unresolved=parse(items,'all samples taken, except unknown test, tube broke','en');
assert.equal(shortcutActions(data,{...unresolved,confirmed:true,samples:[{testId:'lipid-panel',status:'collected',reason:''}]},'en'),null,'Editing sample statuses cannot bypass an unresolved collection clause');
const withReason=parse(items,'all samples taken; except HbA1c; could not draw the sample','en');
assert.deepEqual(withReason.samples.map(s=>[s.testId,s.status,s.reason]),[['lipid-panel','pending',''],['hba1c-glucose','not-collected','could not draw the sample']],'The following reason is retained verbatim rather than limited to tube-broke phrases');
for(const reason of ['Lipid panel could not be collected','Липидная панель не взята','Լիպիդային վահանակը չի վերցվել','the other sample could not be collected either','Ｔｕｂｅ broke']){
 const d=parse(items,`all samples taken except HbA1c, ${reason}`,'en');
 assert.deepEqual(d.samples.map(s=>[s.status,s.reason]),[['pending',''],['not-collected',reason]]);
 assert.equal(parser.exceptionReasonNeedsCheck(items,reason),true);
 assert.equal(shortcutActions(data,{...d,confirmed:true},'en'),null);
}
for(const reason of ['not taken','could not draw','no sample','unable to draw','broken','failed','lost','spilled','не взят','нет образца','невозможно взять','нельзя взять','разбилась','потерян','пролился','չվերցվեց','չի վերցվել','չկա','կոտրվեց','կորել է','թափվել է'])assert.equal(parser.exceptionReasonNeedsCheck(items,reason),true,reason);
assert.equal(parser.exceptionReasonNeedsCheck(items,'appointment rescheduled'),false,'Advisory matching does not determine collection safety');
const draft=parse(items,'arrived, BP 142/88 pulse 76, all samples taken except HbA1c, tube broke','en');
assert.equal(shortcutActions(data,draft,'en'),null,'Arrival does not imply confirmation with the member');
draft.confirmed=true;
assert.equal(shortcutActions(data,draft,'en'),null,'The former exception positive now requires an explicit choice for the rest');
draft.samples=draft.samples.map(s=>s.status==='pending'&&!s.needsReason?{...s,status:'collected'}:s);
const actions=shortcutActions(data,draft,'en')!;
assert.deepEqual(actions.map(a=>a.kind),['confirmation','arrival','measurement','sample','sample']);
assert.equal(shortcutCommand({...data,caseRevision:11},actions[3]!,'en','id')?.kind,'collect');
const command=shortcutCommand({...data,caseRevision:11},actions[3]!,'en','id')!;
assert.equal(command.kind==='collect'&&command.command.expectedRevision,11);
assert.equal(shortcutActions(data,{...draft,measurements:{'measure:bp':''}},'en'),null,'An ambiguous reading blocks every write until edited or removed');

const {actionIntent}=await import('@/lib/nurse-chat/action-intent');
for(const text of ["what's next?",'что дальше?','ինչն է հաջորդը'])assert.deepEqual(actionIntent(text),{kind:'start-visit',name:null,next:true});
assert.deepEqual(actionIntent("Hayk's visit"),{kind:'start-visit',name:'Hayk'});

const prior={done:true,note:null,values:{systolic:120,diastolic:80,pulse:null},recordedAt:'2026-11-06T08:00:00Z',nurseName:'Narine'};
const recorded={...data,items:data.items.map(i=>i.key==='measure:bp'?{...i,mark:prior}:i)};
const edit=shortcutActions(recorded,{arrived:null,measurements:{'measure:bp':'130/85'},replace:['measure:bp'],marks:[],samples:[],untouched:[]},'en')![0];
const changed={...recorded,items:recorded.items.map(i=>i.key==='measure:bp'?{...i,mark:{...prior,recordedAt:'2026-11-06T08:01:00Z'}}:i)};
assert.equal(shortcutCommand(changed,edit,'en','id'),null,'A later mark must not be overwritten by an earlier explicit-edit preview');

// The presentation groups preserve every RPC item without inflating progress.
const {visitBlocks,questionKey}=await import('@/lib/nurse-visit/chat-order');
const groups=visitBlocks({...data,items:[...data.items,namedCheck]});
assert.equal(groups.length,5);
assert.deepEqual(groups.map(g=>g.id),['arrival','bp','body','samples','finish']);
for(const item of data.items.filter(i=>i.kind!=='sample'))assert.ok(groups.some(g=>g.questions.some(q=>questionKey(q)===item.key)),item.key);
const collected={done:true,collectionStatus:'collected' as const,note:null,values:null,recordedAt:data.visit.startsAt,nurseName:'Nurse Ani'};
for(const l of ['en','hy','ru'] as const){
 const brief=copy.visitBriefing(data,l);
 assert.ok(!brief.includes('2026'),'Today shows only the time');
 assert.ok(!brief.includes(copy.visitCopy(l).confirmed));
 assert.ok(brief.includes(copy.visitBlockCopy(l).briefBp));
 assert.ok(brief.includes(copy.visitBlockCopy(l).briefBody));
 const future=copy.visitBriefing({...data,today:'2026-11-05'},l);assert.ok(future.includes('2026'));
 const partial={...data,items:data.items.map(i=>i.key==='sample:lipid-panel'?{...i,mark:collected}:i)};
 assert.ok(!copy.visitBriefing(partial,l).includes(copy.visitSampleShortTitle(items[3] as Extract<NurseVisitItem,{kind:'sample'}>,l)));
 const all={...data,items:data.items.map(i=>i.kind==='sample'?{...i,mark:collected}:i)};
 assert.ok(copy.visitBriefing(all,l).includes(copy.visitBlockCopy(l).allCollected));
}

// A short checklist must not claim the rest of the visit is done.
for(const l of ['en','hy','ru'] as const){
 const outstanding={...data,items:[...data.items.map(i=>({...i,mark:collected})),namedCheck]};
 assert.ok(!copy.visitBriefing(outstanding,l).includes(copy.visitCopy(l).allItemsDone));
}
const allChecks=Array.from({length:10},(_,index)=>({...namedCheck,key:`check:fixture-${index}`,section:index<4?'bp' as const:index<6?'safety' as const:'sampling' as const}));
const standard={...data,items:[...data.items,...allChecks,{kind:'device' as const,key:'device:fixture',assignmentId:'fixture',serial:'NRN-123',model:'Omron',mark:null}]};
assert.deepEqual(visitBlocks({...data,items:[]}).map(b=>b.id),['arrival','finish'],'Absent actionable groups do not inflate progress');
const standardGroups=visitBlocks(standard);assert.ok(standardGroups.length>=5&&standardGroups.length<=7);
for(const item of standard.items.filter(i=>i.kind!=='sample'))assert.equal(standardGroups.flatMap(g=>g.questions).filter(q=>questionKey(q)===item.key).length,1,'Every checklist/measurement/device action belongs to exactly one group');

// #752: exact standalone/trailing collection sentences, including an unlabelled BP.
for(const [l,sentence,pulse] of [
 ['en','Samples collected.','pulse'],
 ['hy','Նմուշները վերցված են։','զարկերակ'],
 ['ru','Образцы взяты.','пульс'],
] as const){
 for(const text of [sentence,`138/88, ${pulse} 72. ${sentence}`]){
  const d=parse(items,text,l);
  assert.equal(d.samples.length,2,text);
  assert.ok(d.samples.every(s=>s.status==='collected'),text);
  assert.deepEqual(d.untouched,[]);
  if(text!==sentence)assert.equal(d.measurements['measure:bp'],'138/88 72');
 }
 for(const tail of ['one tube missing','not collected','issue','HbA1c','Lipid','не взят','проблема','չի վերցվել','խնդիր']){
  const d=parse(items,`${sentence} ${tail}`,l);
  assert.ok(!d.samples.some(s=>s.status==='collected'),`${sentence} ${tail}: unresolved scope cannot collect anything`);
 }
 const prior={done:true,collectionStatus:'collected' as const,note:null,values:null,recordedAt:data.visit.startsAt,nurseName:'Nurse Ani'};
 const partial=items.map(i=>i.key==='sample:lipid-panel'?{...i,mark:prior}:i);
 assert.deepEqual(parse(partial,sentence,l).samples.map(s=>s.testId),['hba1c-glucose'],'Already collected samples are not written again');
 assert.equal(parse(partial.map(i=>i.kind==='sample'?{...i,mark:prior}:i),sentence,l).samples.length,0);
}

// The public runtime validates and forwards the stricter JSON flag through the existing RPC.
const {sendNurseVisitMark}=await import('@/lib/nurse-visit/runtime');
const bulkCommand={version:'nurse-visit-v1',memberId:'aa110000-0000-4000-8000-000000000001',source:'appointment',sourceId:'aa110000-0000-4000-8000-000000000002',
 submissionId:'aa110000-0000-4000-8000-000000000003',startsAt:'2026-11-06T08:00:00Z',checklistVersion:'protocol-draft-2',item:'check:bp-cuff-fit',done:true,note:null,values:null,expectUnanswered:true};
let markCalls=0;
const markRpc={rpc:async(name:string,args:Record<string,unknown>={})=>{markCalls++;assert.equal(name,'nurse_visit_mark');assert.deepEqual(args.p_command,bulkCommand);return {data:{status:'already-marked'},error:null};}};
assert.deepEqual(await sendNurseVisitMark(markRpc,bulkCommand),{status:'already-marked'},'A racing answer refusal survives the existing runtime');
assert.deepEqual(await sendNurseVisitMark(markRpc,{...bulkCommand,expectUnanswered:'yes'}),{status:'invalid'});
assert.equal(markCalls,1,'Invalid preconditions never reach the database');
console.log('All done command: boolean expectUnanswered reaches the ordinary mark RPC; refusal is retained and malformed flags are rejected.');
