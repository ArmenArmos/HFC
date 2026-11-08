import assert from 'node:assert/strict';
import type {NurseVisitReady,NurseVisitItem,NurseVisitList as VisitListData} from '@/lib/nurse-visit/schema';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const source=ts.transpileModule(readFileSync('components/staff/nurse-visit-actions.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const deps:Record<string,unknown>={
 'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'next/navigation':{useRouter:()=>({refresh(){}})},'lucide-react':await import('lucide-react'),
 './bp-high-warning':await import('@/components/staff/bp-high-warning'),'./shell':{fieldClass:'field',buttonClass:'button'},'@/lib/staff/yerevan-time':await import('@/lib/staff/yerevan-time'),'./nurse-visit-timeline':await import('@/components/staff/nurse-visit-timeline'),
 '@/lib/nurse-visit/collection':await import('@/lib/nurse-visit/collection'),'@/lib/staff/staff-locale-copy':await import('@/lib/staff/staff-locale-copy'),'@/lib/patient/catalogue-label':await import('@/lib/patient/catalogue-label'),'@/lib/nurse-visit/actions':{recordNurseVisitCollect:async()=>({status:'saved'}),refreshNurseVisit:async()=>null},
 '@/lib/nurse-visit/copy':await import('@/lib/nurse-visit/copy'),
 '@/lib/nurse-visit/schema':await import('@/lib/nurse-visit/schema'),'@/lib/locale':await import('@/lib/locale'),
};
const card:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/nurse-chat-v2/sample-collection.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:card,crypto,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
deps['@/components/nurse-chat-v2/sample-collection']=card;
new vm.Script(source).runInNewContext({exports,crypto:globalThis.crypto,Date,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const Component=exports.NurseVisitActions as React.ComponentType<Record<string,unknown>>;
// Real database seed wording, including the subsequent protocol version. No database connection.
const sql=readFileSync('supabase/migrations/20261018170600_nurse_visit_flow.sql','utf8');
const checks:Extract<NurseVisitItem,{kind:'check'}>[]=[...sql.matchAll(/\('protocol-draft-1','([^']+)',\d+,'([^']+)',(?:null|'[^']*'),'((?:[^']|'')*)','((?:[^']|'')*)','([^']+)'\)/g)].map(([,checkId,section,en,hy,source])=>({kind:'check' as const,key:`check:${checkId}`,checkId,section:section as 'bp'|'safety'|'sampling',version:'protocol-draft-1',label:{en:en.replaceAll("''", "'"),hy:hy.replaceAll("''", "'")},source,mark:null}));
assert.equal(checks.length,10,'Exercise every database checklist item');
const bpWords=await import('@/lib/clinical/rules/bp-words');
const catalogue=await import('@/lib/clinical/seed/tests');
const {itemTitle,visitCopy,visitTestTitle,visitBlockCopy}=await import('@/lib/nurse-visit/copy');
const {collectionCopy}=await import('@/lib/nurse-visit/collection');
const at='2026-11-01T08:00:00Z',id='aa110000-0000-4000-8000-000000000001';
const data={version:'nurse-visit-v1',enabled:true,visit:{source:'appointment',id,memberId:id,memberName:'Narine',arrangementToken:'fixture',startsAt:at,endsAt:null,mode:'home',location:null,bookingStatus:'confirmed',completion:null},today:'2026-11-01',items:[
 ...catalogue.TEST_CATALOGUE.filter(test=>['blood_draw','urine_sample'].includes(test.method)).map(test=>({kind:'sample' as const,key:`sample:${test.id}`,testId:test.id,title:test.name.en,mark:null})),
 {kind:'sample',key:'sample:legacy-lipid',testId:'lipid-panel',title:'Lipid panel',mark:null},
 {kind:'sample',key:'sample:ldl-retest-lipid-panel',testId:'ldl-retest-lipid-panel',title:'Lipid panel (LDL cholesterol) after a change to lipid treatment',mark:null},
 ...checks,...(['bp','weight','waist'] as const).map(field=>({kind:'measurement' as const,field,key:`measure:${field}`,mark:null})),
 {kind:'device',key:'device:fixture',assignmentId:id,serial:'NRN-123',model:'Omron',mark:null},
],steps:[{step:'confirmed',at,by:'Narine'}],completion:null,checklistVersion:'protocol-draft-1',caseRevision:0,counts:{samplesPlanned:12,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]}} as unknown as NurseVisitReady;
const render=(component:unknown,props:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(component as React.ComponentType<Record<string,unknown>>,props));
// Allow only known names, document version, catalogue abbreviations and device identifiers.
// Reject every other Latin word, including English not previously listed in a dictionary.
const allowed=new Set(['Narine','Omron','NRN-123','v2','LDL-C','LDL','ApoB','Lp(a)','HbA1c','eGFR','ACR','TSH','NT-proBNP','HOMA-IR']);
type LanguageGap={surface:string;language:'hy'|'ru';sourceText:string[];context?:string};
function languageGaps(html:string,language:'hy'|'ru',surface:string,context?:string):LanguageGap[]{
 // Base UI's clipped layout sentinel is presentation-only, never nurse copy.
 const text=html.replace(/<span role="presentation" style="clip-path:inset\(50%\);[^"]*">x<\/span>/g,'').replace(/<[^>]*>/g,'\n').replace(/&(?:#\d+|#x[\da-f]+|\w+);/gi,' ');
 const wrongScript=language==='ru'?/[\u0531-\u058f]/u:/[\u0400-\u04ff]/u;
 const sourceText=text.split('\n').map(line=>line.trim()).filter(line=>wrongScript.test(line));
 const latin=text.match(/[A-Za-z][A-Za-z0-9]*(?:\([A-Za-z]+\))?(?:-[A-Za-z0-9]+)*/g)??[];
 const untranslated=[...new Set(latin.filter(word=>!allowed.has(word)))];
 return [
  ...(sourceText.length?[{surface,language,sourceText,...(context?{context}:{})}]:[]),
  ...(untranslated.length?[{surface,language,sourceText:untranslated,...(context?{context}:{})}]:[]),
 ];
}
function assertLanguage(html:string,l:'hy'|'ru',where:string){
 assert.deepEqual(languageGaps(html,l,where),[],`${where}: untranslated text`);
}
// Prove that the checker catches each reported class of leak.
for(const [l,text] of [['ru','Գրանցեք'],['hy','Источник'],['ru','Record the sample time'],['hy','Lipid panel']] as const)assert.throws(()=>assertLanguage(`<p>${text}</p>`,l,'negative control'));
// Pin the source text as well as the surface, so an additional leak cannot hide in a known gap.
const safetyText={
 // protocol-draft-1/urgent-symptoms
 urgent:'Հարցրեք կրծքավանդակի ցավի, ծանր շնչահեղձության, նոր նյարդաբանական ախտանիշների, գիտակցության խանգարման կամ տեսողության սուր վատացման մասին։ Դրանցից որևէ մեկի դեպքում անմիջապես կազմակերպեք շտապ բժշկական օգնություն (103)։ Մի սպասեք հետազոտություններին կամ հավելվածին։',
 // protocol-draft-1/severe-bp-contact
 legacyBp:'Եթե կրկնակի ճիշտ չափմամբ սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 110 կամ ավելի. ախտանիշների դեպքում անմիջապես զանգահարեք 103, առանց ախտանիշների՝ այսօր կապվեք նշանակված բժշկի հետ։',
 // BP_NURSE_GUIDANCE.hy (protocol-draft-2/severe-bp-contact)
 currentBp:'Եթե սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 110 կամ ավելի. թող անդամը 5 րոպե հանգստանա և նորից չափեք։ Ախտանիշների դեպքում անմիջապես զանգահարեք 103։ Առանց ախտանիշների, եթե կրկնակի չափմամբ սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 120 կամ ավելի, այսօր կապվեք նշանակված բժշկի հետ, հակառակ դեպքում՝ բժիշկ 48 ժամվա ընթացքում։',
};
// awaiting clinical Russian translation (output/PENDING_QUESTIONS.md, P0-… nurse language)
// Remove an entry when its approved translation lands. Never add new gaps to this baseline.
const knownGaps:LanguageGap[]=[
 {surface:'Visit tab protocol-draft-1',language:'ru',sourceText:[safetyText.urgent,safetyText.legacyBp]},
 {surface:'Visit tab protocol-draft-2',language:'ru',sourceText:[safetyText.urgent,safetyText.currentBp]},
 {surface:'Visit history',language:'ru',sourceText:[safetyText.urgent,safetyText.legacyBp]},
 {surface:'Urgent guidance',language:'ru',sourceText:[safetyText.urgent,safetyText.currentBp]},
 {surface:'Chat urgent sheet',language:'ru',sourceText:[safetyText.urgent,safetyText.currentBp]},
 {surface:'Chat visit flow',language:'ru',sourceText:[safetyText.urgent,safetyText.legacyBp],context:'change'},
 // Both existing protected paragraphs now stay visible throughout the BP group.
 // Only their render contexts changed; no additional source text is allowed.
 ...['check:bp-validated-device','check:bp-cuff-fit','check:bp-seated-rest','check:bp-conditions-medicines','check:urgent-symptoms','check:severe-bp-contact','measure:bp','device:fixture'].map(context=>({surface:'Chat visit flow',language:'ru' as const,sourceText:[safetyText.urgent,safetyText.legacyBp],context})),
 {surface:'Chat visit flow',language:'ru',sourceText:[safetyText.urgent,safetyText.legacyBp],context:'finish'},
];
function assertKnownGaps(actual:LanguageGap[]){
 assert.deepEqual(actual,knownGaps,'Language gaps changed: reject new gaps; remove fixed gaps from knownGaps.');
}
// Exercise both directions of the ratchet, including another leak on an already listed surface.
assert.throws(()=>assertKnownGaps([...knownGaps,{surface:'New surface',language:'ru',sourceText:['Գրանցեք']}]));
assert.throws(()=>assertKnownGaps(knownGaps.slice(1)));
assert.throws(()=>assertKnownGaps(knownGaps.map((gap,i)=>i===0?{...gap,sourceText:[...gap.sourceText,'Գրանցեք']}:gap)));
assert.throws(()=>assertKnownGaps([...knownGaps,...languageGaps('<p>Record the sample time</p>','ru','Urgent line')]));
const failures:LanguageGap[]=[];
function check(l:'hy'|'ru',where:string,html:string,context?:string){failures.push(...languageGaps(html,l,where,context));}
for(const locale of ['en','hy','ru'] as const)for(const version of ['protocol-draft-1','protocol-draft-2']){
 const items=data.items.map(item=>item.kind==='check'?{...item,version,label:item.checkId==='severe-bp-contact'&&version==='protocol-draft-2'?{en:bpWords.BP_NURSE_GUIDANCE.en,hy:bpWords.BP_NURSE_GUIDANCE.hy}:item.label}:item);
 const current={...data,items,checklistVersion:version};
 const props={data:current,locale,inline:true,completeIds:{},mark:async()=>({status:'saved'}),step:async()=>({status:'saved'}),complete:async()=>({status:'saved'})};
 const html=render(Component,props);
 if(locale!=='en')check(locale,`Visit tab ${version}`,html);
 else for(const item of items.filter((item):item is Extract<NurseVisitItem,{kind:'check'}>=>item.kind==='check'))assert.ok(html.includes(item.label.en.replaceAll('&','&amp;').replaceAll("'",'&#x27;')),'English protocol wording stays unchanged');
}
// Legacy record and both chat visit lists use the same requested UI language.
const {NurseVisitRecordPanel}=await import('@/components/staff/nurse-visit-record');
const {NurseChatVisitList}=await import('@/components/staff/nurse-chat-visit-list');
const {NurseVisitList}=await import('@/components/nurse-chat-v2/visit-list');
const {BpHighWarning}=await import('@/components/staff/bp-high-warning');
const {NurseUrgentLine,NurseUrgentGuidance}=await import('@/components/staff/nurse-urgent-guidance');
const {NurseUrgentSheet}=await import('@/components/nurse-chat-v2/urgent-sheet');
const list:Extract<VisitListData,{enabled:true}>={version:'nurse-visit-v1',enabled:true,today:data.today,role:'nurse',visits:[{...data.visit,samplesPlanned:2,samplesTaken:0,openItems:5,steps:data.steps,nurseName:'Narine'}]};
// Load actual chat rendering, replacing only its hook/IO boundary with synthetic state.
function load(file:string,modules:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,Date,crypto,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
 return exports;
}
const fields=load('components/nurse-chat-v2/visit-fields.tsx',{...deps,'@/lib/nurse-visit/chat-parser':await import('@/lib/nurse-visit/chat-parser'),'@/lib/nurse-visit/shortcut':await import('@/lib/nurse-visit/shortcut')});
deps['@/components/ui/progress']=await import('@/components/ui/progress');
const chat=load('components/nurse-chat-v2/visit.tsx',{...deps,'./visit-fields':fields,'@/lib/nurse-visit/chat-order':await import('@/lib/nurse-visit/chat-order'),'./sample-collection':card,'./use-nurse-visit':{questionKey:(await import('@/lib/nurse-visit/chat-order')).questionKey}}) as typeof import('@/components/nurse-chat-v2/visit');
const unused=()=>{throw Error('Language rendering must never call IO');};
const today=load('components/staff/nurse-today.tsx',{...deps,
 'next/link':{default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)},
 './real-coordination-tasks':{TaskRow:unused,RealCoordinationTasks:()=>null},
 './nurse-urgent-alerts':{NurseUrgentAlertRow:unused,NurseAlertReadFailure:()=>null},
 '@/components/patient-care/common':{stamp:(await import('@/components/patient-care/common')).stamp},
 './nurse-chat-visit-list':{nurseVisitChatHref:(await import('@/components/staff/nurse-chat-visit-list')).nurseVisitChatHref},
 '@/lib/nurse-chat/today':await import('@/lib/nurse-chat/today'),
 '@/lib/nurse-chat/today-actions':{readNurseToday:unused},
}).NurseToday as unknown;
for(const locale of ['en','hy','ru'] as const){
 const verify=(where:string,html:string,context?:string)=>{if(locale!=='en')check(locale,where,html,context);};
 verify('Visit history',render(NurseVisitRecordPanel,{locale,data:{enabled:true,version:data.version,visits:[{...data,items:data.items}]}}));
 verify('Empty history',render(NurseVisitRecordPanel,{locale,data:{enabled:true,version:data.version,visits:[]}}));
 verify('Unavailable history',render(NurseVisitRecordPanel,{locale,data:null}));
 for(const visits of [list,{...list,visits:[]}]){
  verify('Chat visit list',render(NurseVisitList,{data:visits,locale,disabled:false,onOpen:unused}));
  verify('Legacy visit list',render(NurseChatVisitList,{list:visits,locale}));
 }
 for(const visits of [null,{version:data.version,enabled:false,visits:[]}])verify('Unavailable/off visits',render(NurseChatVisitList,{list:visits,locale}));
 for(const initial of [
  {ok:true,asOf:at,page:{tasks:[],nextCursor:null},visits:list},
  {ok:true,asOf:at,page:{tasks:[],nextCursor:null},visits:{...list,visits:[]}},
  {ok:true,asOf:at,page:null,visits:null},
  {ok:true,asOf:at,page:{tasks:[],nextCursor:null},visits:{enabled:false,visits:[]}},
  {ok:false,code:'unavailable'},
 ])verify('Today visit rows',render(today,{initial,actor:{id,role:'nurse'},locale}));
 verify('Urgent line',render(NurseUrgentLine,{locale}));
 verify('Urgent guidance',render(NurseUrgentGuidance,{locale}));
 verify('Chat urgent sheet',render(NurseUrgentSheet,{locale,onClose:unused}));
 verify('BP warning',render(BpHighWarning,{systolic:180,diastolic:110,locale}));
 const base={flow:{selection:{memberName:'Narine'},data,loaded:true,view:'question',skipped:[],comment:'',commentBaseline:'',commenting:false,error:''},question:null,sending:false,frozen:false,uncertain:false};
 const states=[base,{...base,sending:true},...['change','complete'].map(view=>({...base,flow:{...base.flow,view}})),
  ...[false,true].map(loaded=>({...base,flow:{...base.flow,data:null,loaded}})),
  ...data.items.map(item=>({...base,question:{kind:'item',item}})),
  ...['confirmed','started','samples-collected','samples-at-lab'].map(step=>({...base,question:{kind:'step',step}})),
  {...base,question:{kind:'finish'}},
 ];
 for(const state of states){
  const context=state.flow.view!=='question'?state.flow.view:state.question&&'item' in state.question?state.question.item.key:state.question?.kind??'entry';
  verify('Chat visit flow',render(chat.NurseVisit,{visit:state,locale,onAction:unused,draft:''}),context);
  verify('Visit composer',render(({children}:{children:React.ReactNode})=>React.createElement('p',null,children),{children:[chat.visitComposerLabel(state as never,locale),' ',chat.visitComposerHint(state as never,locale)]}));
 }
 const block=visitBlockCopy(locale);
 const preview=(await import('@/lib/nurse-visit/chat-parser')).parseVisitShortcut(data.items,locale==='en'?'arrived, BP 142/88 pulse 76, all samples taken except HbA1c, tube broke':locale==='ru'?'прибыла, АД 142/88 пульс 76, все образцы взяты кроме HbA1c, пробирка разбилась':'ժամանել եմ, ճնշում 142/88 զարկերակ 76, բոլոր նմուշները վերցված են բացի HbA1c, փորձանոթը կոտրվեց',locale);
 verify('Visit shortcut preview',render(chat.NurseVisit,{visit:{...base,flow:{...base.flow,preview}},locale,onAction:unused,draft:''}));
 for(const collectionIssue of ['conflicting','unresolved'] as const)verify('Visit collection warning',render(chat.NurseVisit,{visit:{...base,flow:{...base.flow,preview:{...preview,samples:[],collectionIssue}}},locale,onAction:unused,draft:''}),collectionIssue);
 verify('Visit block controls',render(({children}:{children:React.ReactNode})=>React.createElement('p',null,children),{children:[...Object.values(block).filter(v=>typeof v==='string'),block.progress(3,6)].join(' ')}));
 const copy=visitCopy(locale),collection=collectionCopy(locale);
 const errorText=[...Object.values(copy).filter(value=>typeof value==='string'),...Object.values(collection).filter(value=>typeof value==='string'),...Object.values(collection.statuses),copy.scalarRange(20,400),copy.incompleteCount(3),copy.counts(3)];
 for(const status of ['completed','too-early','disabled','invalid','stale','pending-samples','no-samples','no-lab-entries','reason-required','booking-stale','outcome-unknown','unavailable'])errorText.push(copy.markError(status),copy.stepError(status),copy.completeError(status));
 verify('Visit status/error copy',render(({children}:{children:React.ReactNode})=>React.createElement('p',null,children),{children:errorText.join(' ')}));
 // Presence assertions keep an empty or unavailable replacement from passing as a translation.
 if(locale!=='en'){
  assert.equal(itemTitle(checks[9]!,locale),locale==='ru'?'Запишите время взятия образца и лекарства, которые принял участник, чтобы эти сведения сохранились вместе с результатом.':'Գրանցեք նմուշառման ժամը և անդամի ընդունած դեղերը, որպեսզի դրանք պահվեն արդյունքի հետ։');
  assert.equal(visitTestTitle({kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Lipid panel',mark:null},locale),locale==='ru'?'Липидная панель':'Լիպիդային վահանակ');
 }
}
// Unknown revisions must be explicit, and must never reuse a stale translation.
const {protocolLabel,protocolSource}=await import('@/lib/nurse-visit/protocol-copy');
for(const item of [{...checks[9]!,version:'protocol-draft-3'},{...checks[9]!,label:{...checks[9]!.label,en:'Changed protocol instruction'}}]){
 assert.match(protocolLabel(item,'ru'),/Перевод этого пункта недоступен/);
 assert.doesNotMatch(protocolLabel(item,'ru'),/Запишите время/);
}
for(const l of ['hy','ru'] as const)assertLanguage(protocolSource('New protocol source',l),l,'Untranslated source notice');
assert.equal(visitTestTitle({kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Provider wording',mark:null},'ru'),'Provider wording','Do not rewrite provider-authored clinical records');
if(process.argv.includes('--browser')){
 const {chromium,expect}=await import('@playwright/test');
 const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
 const css=await postcss([require('@tailwindcss/postcss')()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
 const browser=await chromium.launch();
 try{
  for(const width of [390,1440])for(const locale of ['en','hy','ru'] as const){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.route('**/*',route=>route.abort());
   const html=render(Component,{data,locale,inline:true,completeIds:{},mark:unused,step:unused,complete:unused});
   await page.setContent(`<style>${css.css}</style><main class="mx-auto max-w-3xl p-4">${html}</main>`);
   await page.locator('#nv-samples').click();
   await expect(page.locator('[data-sample-collection]')).toBeVisible();
   await expect(page.getByText(itemTitle(checks[9]!,locale),{exact:true})).toBeVisible();
   await expect(page.getByText(visitTestTitle({kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Lipid panel',mark:null},locale),{exact:true})).toBeVisible();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
   await page.screenshot({path:`/tmp/nurse-language-${locale}-${width}.png`,fullPage:true});
   await page.locator('#nv-measures').click();
   await page.locator('li[aria-labelledby="nv-measure-weight-title"] details summary').click();
   await expect(page.getByText(visitCopy(locale).weightInput,{exact:true})).toBeVisible();
   // Render the actual new chat block and preview, using only synthetic visit data and local CSS.
   const active={flow:{selection:{memberName:'Narine'},data,loaded:true,view:'question',skipped:[],comment:'',commentBaseline:'',commenting:false,error:''},question:{kind:'item',item:data.items.find(i=>i.key==='measure:bp')},sending:false,frozen:false,uncertain:false};
   const preview=(await import('@/lib/nurse-visit/chat-parser')).parseVisitShortcut(data.items,locale==='en'?'arrived, BP 142/88 pulse 76, all samples taken except HbA1c, tube broke':locale==='ru'?'прибыла, АД 142/88 пульс 76, все образцы взяты кроме HbA1c, пробирка разбилась':'ժամանել եմ, ճնշում 142/88 զարկերակ 76, բոլոր նմուշները վերցված են բացի HbA1c, փորձանոթը կոտրվեց',locale);
   const chatCss=readFileSync('components/chat-v2/chat.css','utf8')+'\n'+readFileSync('components/nurse-chat-v2/nurse-chat.css','utf8');
   const unresolved=(await import('@/lib/nurse-visit/chat-parser')).parseVisitShortcut(data.items,locale==='en'?'all samples taken; everything but HbA1c; tube broke':locale==='ru'?'все образцы взяты; за исключением HbA1c':'բոլոր նմուշները վերցված են; բացառությամբ HbA1c',locale);
   for(const screen of ['block','preview','unresolved'] as const){
    const isPreview=screen!=='block';
    const state=isPreview?{...active,flow:{...active.flow,preview:screen==='unresolved'?{...unresolved,measurements:{'measure:bp':'142/88'}}:preview}}:active;
    const chatHtml=render(chat.NurseVisit,{visit:state,locale,onAction:unused,draft:''});
    await page.setContent(`<style>${css.css}\n${chatCss}html,body{margin:0}</style><main class="cv2-root"><div class="cv2-thread"><div class="cv2-messages">${chatHtml}</div></div><footer class="cv2-bottom"><div class="cv2-composer"><textarea aria-label="${visitBlockCopy(locale).shortcut}"></textarea></div></footer></main>`);
    await page.locator(isPreview?'[data-visit-preview]':'[data-visit-question="measure:bp"]').scrollIntoViewIfNeeded();
    const field=page.getByRole('textbox',{name:visitCopy(locale).systolic,exact:true});
    await field.fill('142');await field.focus();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No chat horizontal overflow');
    const target=await page.locator('.ncv2-stepper button').first().boundingBox();assert.ok(target&&target.width>=44&&target.height>=44,'44px stepper targets');
    if(screen==='unresolved'){
     await expect(page.locator('[data-preview-sample]')).toHaveCount(data.items.filter(i=>i.kind==='sample').length);
     await expect(page.locator('[data-collection-choice][aria-pressed="true"]')).toHaveCount(0);
     for(const choice of await page.locator('[data-collection-choice]').all()){
      const box=await choice.boundingBox();assert.ok(box&&box.width>=44&&box.height>=44,'Collection choices retain touch targets');
     }
    }
    await page.screenshot({path:`/tmp/nurse-briefing-${locale}-${width}-${screen}.png`,fullPage:true});
    if(width===390){
     await page.setViewportSize({width,height:440});await field.scrollIntoViewIfNeeded();await field.focus();
     const box=await field.boundingBox(),footer=await page.locator('.cv2-bottom').boundingBox();
     assert.ok(box&&footer&&box.y>=0&&box.y+box.height<=footer.y,'Focused field stays above the composer in a reduced viewport');
     await page.setViewportSize({width,height:900});
    }
   }
   await page.close();
  }
  console.log('Offline browser: new chat blocks/previews and legacy visit rendered at 390/1440px in en/hy/ru, with 44px stepper targets, no horizontal overflow and reduced-viewport focus checks. Screenshots: /tmp/nurse-briefing-*.png');
  console.log('Offline browser: sample rules, sources, translated titles and measurement editor visible at 390/1440px in en/hy/ru; no horizontal overflow. Screenshots: /tmp/nurse-language-*.png');
 }finally{await browser.close();}
}
assertKnownGaps(failures);
console.log(`Nurse visit language: rendered en/hy/ru database checklist versions, sources, catalogue samples, steps, measurements and devices; ${knownGaps.length} protected Russian gaps matched exactly; new/stale gap negative controls passed.`);
