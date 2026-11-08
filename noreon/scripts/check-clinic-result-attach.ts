import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readResultAttachPage,runResultAttach} from '@/lib/clinic-portal/result-attach-runtime';
import {resultAttachEnabled,resultAttachCommandSchema,type ResultAttachPage} from '@/lib/clinic-portal/result-attach-schema';
import {LabStages} from '@/components/staff/lab-stages';
import {staffLabReadSchema} from '@/lib/staff/lab-stage-schema';

const clinic='c7a00000-0000-4000-8000-000000000007',file='c7a00000-0000-4000-8000-000000000051',member='c7a00000-0000-4000-8000-000000000004',visit='c7a00000-0000-4000-8000-000000000021';
const rpc=(response:{data:unknown;error:{code?:string}|null})=>({rpc:async()=>response});
const command={version:'clinic-result-attach-v1' as const,submissionId:'c7a00000-0000-4000-8000-000000000710',fileId:file,memberId:member,visitId:visit};

// Flag: off unless exactly 'true'.
assert.equal(resultAttachEnabled({}),false);assert.equal(resultAttachEnabled({NOREON_CLINIC_RESULT_ATTACH_ENABLED:'1'}),false);assert.equal(resultAttachEnabled({NOREON_CLINIC_RESULT_ATTACH_ENABLED:'true'}),true);
// The command names member and visit only: no test list, no content-derived match.
assert.ok(!resultAttachCommandSchema.safeParse({...command,tests:['cbc']}).success);
// Runtime maps errors truthfully and never reports an unproven save.
assert.deepEqual(await runResultAttach(rpc({data:null,error:{code:'42501'}}),command),{status:'access'});
assert.deepEqual(await runResultAttach(rpc({data:null,error:{code:'55P03'}}),command),{status:'unavailable'});
assert.deepEqual(await runResultAttach(rpc({data:null,error:{code:'08006'}}),command),{status:'outcome-unknown'});
assert.deepEqual(await runResultAttach(rpc({data:{status:'saved'},error:null}),command),{status:'outcome-unknown'},'Malformed receipt is not proof');
assert.equal((await runResultAttach(rpc({data:{status:'saved',attachmentId:file,corrected:false,moved:1,waitingForLab:1,atLabAfterUpload:0,alreadyReceived:0,retracted:0},error:null}),command)).status,'saved');
const page:ResultAttachPage={version:'clinic-result-attach-v1',clinic:{id:clinic,name:'Synthetic'},files:[],visits:[]};
assert.equal((await readResultAttachPage(rpc({data:page,error:null}),clinic)).status,'loaded');
assert.equal((await readResultAttachPage(rpc({data:{...page,clinic:{id:file,name:'Other'}},error:null}),clinic)).status,'unavailable','A page for another clinic is refused');
// Staff panel shows a system-recorded stage without inventing a person.
const data=staffLabReadSchema.parse({version:'lab-stage-v1',memberId:member,revision:2,samples:[{entryId:file,visitId:visit,testId:'cbc',title:null,collectedAt:'2026-10-16T04:00:00+00:00',stages:[
 {id:clinic,stage:'at-lab',occurredAt:'2026-10-16T05:00:00+00:00',recordedAt:'2026-10-16T05:00:00+00:00',actor:{name:'Synthetic nurse',role:'nurse'}},
 {id:visit,stage:'results-received',occurredAt:'2026-10-16T09:00:00+00:00',recordedAt:'2026-10-16T09:00:00+00:00',actor:{name:'Clinic upload',role:'system'}}]}]});
for(const [locale,label] of [['en','recorded from the clinic’s lab upload'],['hy','գրանցվել է կլինիկայի վերբեռնած լաբորատոր ֆայլից']] as const){
 const html=renderToStaticMarkup(createElement(LabStages,{data,locale,role:'nurse',submissionIds:{},command:async()=>({status:'access' as const})}));
 assert.ok(html.includes(label)&&!html.includes('Clinic upload,'),`System actor label (${locale})`);
}
console.log('Clinic result attach: flag, strict command, runtime statuses, clinic-bound page and system actor display passed.');
// Part 2: detach, clinic attach and visit list keep strict shapes and truthful statuses.
{
 const {runResultDetach,runClinicResultAttach,readClinicResultVisits,openClinicOriginal}=await import('@/lib/clinic-portal/result-attach-runtime');
 const detach={version:'clinic-result-detach-v1' as const,submissionId:command.submissionId,fileId:file,reason:'Synthetic'};
 assert.deepEqual(await runResultDetach(rpc({data:null,error:null}),{...detach,reason:'  '}),{status:'invalid'},'A detach needs a reason');
 assert.deepEqual(await runResultDetach(rpc({data:{status:'disabled'},error:null}),detach),{status:'disabled'});
 assert.equal((await runResultDetach(rpc({data:{status:'saved',replayed:false,retracted:1},error:null}),detach)).status,'saved');
 const clinicCmd={version:'clinic-result-attach-v1' as const,submissionId:command.submissionId,fileId:file,visitId:visit};
 assert.deepEqual(await runClinicResultAttach(rpc({data:null,error:null}),clinic,{...clinicCmd,memberId:member}),{status:'invalid'},'A clinic command never names a member');
 assert.deepEqual(await runClinicResultAttach(rpc({data:{status:'saved',attachmentId:file,corrected:false,moved:1,waitingForLab:0,atLabAfterUpload:0,alreadyReceived:0,retracted:0},error:null}),clinic,clinicCmd),{status:'outcome-unknown'},'A clinic response carrying an attachment id is refused');
 assert.deepEqual(await readClinicResultVisits(rpc({data:{version:'clinic-result-visits-v1',enabled:true,visits:[{visitId:visit,memberName:'Synthetic',visitedAt:'2026-10-16T04:00:00+00:00',memberId:member}]},error:null}),clinic),{status:'unavailable'},'A visit row carrying a member id is refused');
 assert.equal(await openClinicOriginal(rpc({data:null,error:{code:'42501'}}),file),null,'A refused open yields no location');
}
{
 const {readClinicResultVisits}=await import('@/lib/clinic-portal/result-attach-runtime');
 const {shortReference}=await import('@/lib/clinic-portal/result-attach-schema');
 const row={visitId:visit,memberName:'Synthetic',visitedAt:'2026-10-16T04:00:00+00:00',reference:file,ambiguous:true};
 const loaded=await readClinicResultVisits(rpc({data:{version:'clinic-result-visits-v1',enabled:true,visits:[row]},error:null}),clinic);
 assert.ok(loaded.status==='loaded'&&loaded.data.visits[0].ambiguous,'Clinic rows carry the email reference and the ambiguity flag (CF-2)');
 assert.equal(shortReference('c7a00000-0000-4000-8000-000000000051'),'C7A00000');
 const ambiguous=await (await import('@/lib/clinic-portal/result-attach-runtime')).runClinicResultAttach(rpc({data:{status:'ambiguous'},error:null}),clinic,{version:'clinic-result-attach-v1',submissionId:command.submissionId,fileId:file,visitId:visit});
 assert.deepEqual(ambiguous,{status:'ambiguous'},'An ambiguous clinic attach is reported, not hidden');
}
console.log('Clinic result attach part 2: detach reason, clinic command without member, strict clinic shapes, email reference, ambiguity and refused open passed.');

// Audited copy must stay behind a locale helper, including accessibility labels.
{
 const {readFileSync}=await import('node:fs');
 const {default:ts}=await import('typescript');
 for(const file of ['admin-memberships','change-approvals','approval-navigation','result-attach','pdf-viewer']){
  const path=`components/clinic-portal/${file}.tsx`;
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node:import('typescript').Node){
   if(ts.isJsxText(node))assert.ok(!/[A-Za-z]{2}/.test(node.text.replace(/\b(?:UTC|PDF|Noreon)\b/g,'')),`${path}: untranslated JSX text: ${node.text.trim()}`);
   if(ts.isJsxAttribute(node)&&node.name.getText(source)==='aria-label'&&node.initializer&&ts.isStringLiteral(node.initializer))assert.ok(!/[A-Za-z]{2}/.test(node.initializer.text),`${path}: untranslated aria-label`);
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
}
