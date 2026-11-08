import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemberResultsUpload} from '@/components/clinic-portal/member-results-upload';
import {fileStatus,memberFileSchema,memberFilesSchema,type MemberFile} from '@/lib/clinic-admin/files-schema';

// Results uploaded from a member record: the clinic's status comes from the current attachment (audit B1-5),
// and a stored "choose the visit" state has an action that asks which visit (audit B1-4).
const file=(over:Partial<MemberFile>):MemberFile=>({fileId:'00000000-0000-4000-8000-000000000001',name:'synthetic.pdf',uploadedAt:'2026-10-20T10:00:00+04:00',fromRecord:true,
 state:'reading',attached:false,override:false,fileReading:null,memberReading:null,readingOn:true,compare:null,...over});

assert.equal(fileStatus(file({state:'attached',attached:true,memberReading:'done'})),'ready');
assert.equal(fileStatus(file({state:'attached',attached:true,memberReading:null,noValuesRead:false})),'by-hand','No completed member read cannot claim values are ready');
assert.equal(fileStatus(file({state:'attached',attached:false})),'detached','a detached or moved file is never ready for this member');
assert.equal(fileStatus(file({state:'choose-visit'})),'choose-visit');

// The clinic JSON extension ships separately. Missing or false fields preserve existing statuses.
for(const fields of [{},{noValuesRead:false,identityChecked:false}]){
 for(const memberReading of ['done','failed','rejected'] as const){
  const f=memberFileSchema.parse(file({attached:true,state:'attached',memberReading,...fields}));
  assert.equal(fileStatus(f),memberReading==='done'?'ready':'by-hand','No empty-read label without an explicit true flag');
  assert.equal(fileStatus({...f,override:true}),'identity-check','The existing override field keeps a mismatch waiting');
 }
}
for(const noValuesRead of [undefined,false,true])for(const identityChecked of [undefined,false,true]){
 const fields={...(noValuesRead===undefined?{}:{noValuesRead}),...(identityChecked===undefined?{}:{identityChecked})};
 const f=file({attached:true,state:'attached',override:true,memberReading:'done',...fields});
 const parsed=memberFilesSchema.parse({version:'clinic-member-files-v1',enabled:true,status:'ok',uploadAvailable:true,uploads:[f],unmatched:[]});
 assert.ok(parsed.enabled&&parsed.status==='ok');
 assert.deepEqual(parsed.uploads[0],f,'Both clinic JSON shapes parse without filling in missing metadata');
 assert.equal(fileStatus(parsed.uploads[0]!),noValuesRead?'unreadable':identityChecked?'identity-checked':'identity-check');
}

const render=(f:MemberFile,locale:'en'|'hy'|'ru'='en')=>renderToStaticMarkup(createElement(MemberResultsUpload,{locale,clinicId:'00000000-0000-4000-8000-000000000002',memberId:'00000000-0000-4000-8000-000000000003',actorScope:'synthetic',
 initial:{version:'clinic-member-files-v1',enabled:true,status:'ok',uploadAvailable:true,uploads:[f],unmatched:[]},
 begin:async()=>{throw Error('unused');},reserve:async()=>({status:'invalid' as const}),read:async()=>{throw Error('unused');},attach:async()=>({status:'invalid' as const})}));

const choose=render(file({state:'choose-visit'}));
assert.match(choose,/Choose the visit<\/span>/,'status chip');
assert.match(choose,/<button[^>]*>Choose the visit<\/button>/,'a stored choose-visit file has the action that lists the visits');
const detached=render(file({state:'attached',attached:false}));
assert.match(detached,/Removed by Noreon/);
assert.doesNotMatch(detached,/Ready for the doctor|Attach to this member/,'no ready label and no re-attach of a deliberate detachment');

const attached=render(file({state:'attached',attached:true,name:'PRIVATE member patronymic CBC.pdf',memberReading:'done'}));
assert.match(attached,/Lab result PDF/);
assert.match(attached,/Linked to the member&#x27;s record\. Their doctor reviews the values\./);
assert.doesNotMatch(attached,/PRIVATE|patronymic|CBC|Open PDF|\/files\//,'Attached clinic file has no original name or opening control');

for(const locale of ['en','hy','ru'] as const){
 const waiting={en:'Waiting for the doctor to check this file',hy:'Սպասում է բժշկի ստուգմանը',ru:'Ожидает проверки врачом'}[locale];
 const unreadable={en:"Couldn't read this file",hy:'Չհաջողվեց կարդալ այս ֆայլը',ru:'Не удалось прочитать этот файл'}[locale];
 const clearer={en:'Upload a clearer copy of the sheet.',hy:'Վերբեռնեք թերթիկի ավելի պարզ պատճենը։',ru:'Загрузите более чёткую копию листа.'}[locale];
 const checkFile={en:"Linked to the member's record. The doctor will check this file.",hy:'Կցված է անդամի գրառմանը։ Բժիշկը կստուգի այս ֆայլը։',ru:'Прикреплено к записи участника. Врач проверит этот файл.'}[locale];
 const ready={en:'Ready for the doctor',hy:'Պատրաստ է բժշկի համար',ru:'Готово для врача'}[locale];
 assert.ok(render(file({attached:true,state:'attached',memberReading:'done',noValuesRead:false}),locale).includes(ready),'A read with values stays ready in every language');
 for(const over of [{override:true},{override:true,noValuesRead:false,identityChecked:false},{override:true,memberReading:'failed' as const},{override:true,memberReading:'rejected' as const},{noValuesRead:true},{noValuesRead:true,memberReading:'failed' as const},{override:true,noValuesRead:true},{override:true,noValuesRead:true,identityChecked:true}]){
  const html=render(file({attached:true,state:'attached',memberReading:'done',...over}),locale);
  const text=html.replaceAll('&#x27;',"'");
  assert.ok(text.includes(over.noValuesRead?unreadable:waiting),`Correct clinic chip for ${locale}: ${JSON.stringify(over)}`);
  assert.ok(text.includes(over.noValuesRead?clearer:checkFile),`Correct next step for ${locale}`);
  assert.doesNotMatch(text,/Their doctor reviews the values|Արժեքները վերանայում է նրա բժիշկը|Значения проверяет его врач|Attached although the sheet differed|Կցվել է, թեև|Прикреплено, хотя/,'No normal values notice or identity details on unreadable and waiting rows');
  assert.doesNotMatch(text,/Ready for the doctor|Պատրաստ է բժշկի համար|Готово для врача|Open PDF|<iframe|mmol/);
 }
 const unlinked=render(file({state:'error',fileReading:'failed',noValuesRead:true}),locale).replaceAll('&#x27;',"'");
 assert.ok(unlinked.includes(unreadable)&&unlinked.includes(clearer),'An unreadable file read also explains how to retry before attachment');
 assert.equal(fileStatus(file({attached:true,override:true,readingOn:false})),'identity-check','Reading disabled must not make an override ready');
}

assert.equal(memberFileSchema.parse(file({noValuesRead:true})).noValuesRead,true,'Clinic parser keeps only the empty-read boolean, no lab values');
assert.equal(memberFileSchema.safeParse(file({noValuesRead:'true' as unknown as boolean})).success,false,'No string coercion for the boolean status');
assert.equal(memberFileSchema.safeParse({...file({}),valueCount:0}).success,false,'No lab value count in the clinic contract');
assert.equal(fileStatus(file({state:'attached',noValuesRead:true})),'detached','An empty historical read cannot hide a deliberate detachment');
assert.equal(fileStatus(file({state:'check',noValuesRead:true})),'check','Keep the existing mismatch card');

// An override's waiting chip must keep refreshing its underlying AI read.
const actorId='00000000-0000-4000-8000-000000000001';
const React=await import('react');
const {act,create}=await import('react-test-renderer');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const originalInterval=globalThis.setInterval,originalClear=globalThis.clearInterval;
try{
 for(const locale of ['en','hy','ru'] as const)for(const fields of [{},{noValuesRead:false,identityChecked:false},{noValuesRead:true,identityChecked:false}]){
  let poll:(()=>void)|undefined;
  globalThis.setInterval=((callback:()=>void)=>{poll=callback;return 1;}) as unknown as typeof setInterval;
  globalThis.clearInterval=()=>{};
  const initial={version:'clinic-member-files-v1' as const,enabled:true as const,status:'ok' as const,uploadAvailable:true,uploads:[file({attached:true,override:true,memberReading:'running'})],unmatched:[]};
  let reads=0;
  const props={locale,clinicId:actorId,memberId:actorId,actorScope:'synthetic',initial,
   begin:async()=>({status:'invalid' as const}),reserve:async()=>({status:'invalid' as const}),attach:async()=>({status:'invalid' as const}),
   read:async()=>{reads++;return {status:'loaded' as const,data:{...initial,uploads:[file({attached:true,override:true,memberReading:'done',...fields})]}};}};
  let tree!:ReturnType<typeof create>;
  await act(async()=>{tree=create(React.createElement(MemberResultsUpload,props));});
  assert.ok(poll,`Override with an active AI job keeps polling in ${locale}`);
  await act(async()=>poll!());
  assert.equal(reads,1);
  const expected=fields.noValuesRead?{en:"Couldn't read this file",hy:'Չհաջողվեց կարդալ այս ֆայլը',ru:'Не удалось прочитать этот файл'}:{en:'Waiting for the doctor to check this file',hy:'Սպասում է բժշկի ստուգմանը',ru:'Ожидает проверки врачом'};
  assert.ok(JSON.stringify(tree.toJSON()).includes(expected[locale]),'Polling accepts either JSON shape and only labels an explicit empty read');
  await act(async()=>tree.update(React.createElement(MemberResultsUpload,{...props,initial:{...initial,uploads:[file({attached:true,override:true,memberReading:'done',identityChecked:true})]}})));
  const text=JSON.stringify(tree.toJSON());
  assert.ok(text.includes({en:'File identity checked',hy:'Ֆայլի պատկանելությունը ստուգված է',ru:'Принадлежность файла проверена'}[locale]),'A confirmed identity stops waiting after clinic refresh');
  assert.doesNotMatch(text,/Ready for the doctor|Պատրաստ է բժշկի համար|Готово для врача/);
  await act(async()=>tree.unmount());
 }
}finally{globalThis.setInterval=originalInterval;globalThis.clearInterval=originalClear;}
console.log('Clinic labels EN/HY/RU: mismatch, empty/unreadable, active-read polling and confirmed identity passed; PDF/values remain masked.');
