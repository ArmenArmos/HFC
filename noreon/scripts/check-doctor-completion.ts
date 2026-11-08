import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {runDocumentCommand,readMemberDocuments,openMemberDocument,openDoctorDocument,readMemberPlanVersions,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {memberDocumentsReadSchema} from '@/lib/doctor-completion/document-schema';
import {ReleasedDocuments} from '@/components/patient-care/released-documents';
import {ConsultationHoldCard} from '@/components/patient-care/consultation-hold-card';
import {arrangeCommandSchema} from '@/lib/doctor-completion/consultation-schema';
import {runArrangeCommand,readConsultationQueue} from '@/lib/doctor-completion/consultation-runtime';
import {arrangedConsultationText} from '@/lib/doctor-completion/consultation-copy';

const member='b5a00000-0000-4000-8000-000000000004',file='b5a00000-0000-4000-8000-000000000051';
const rpc=(data:unknown,error:{code?:string}|null=null):DocumentRpc&{calls:unknown[]}=>{const calls:unknown[]=[];return {calls,rpc:(name,args)=>{calls.push([name,args]);return Promise.resolve({data,error});}};};
const command={version:'member-document-v1',submissionId:'b5a00000-0000-4000-8000-000000000801',memberId:member,fileId:file,action:'release',singleMemberConfirmed:true};

// Flag: both the B5 switch and the real-review boundary are required.
const realEnv={NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_ANON_KEY:'anon'};
assert.equal(doctorCompletionEnabled(realEnv),false);
assert.equal(doctorCompletionEnabled({...realEnv,NOREON_DOCTOR_COMPLETION_ENABLED:'true'}),true);

// Commands: a malformed or cross-member command never reaches the database.
{const r=rpc({status:'released'});assert.deepEqual(await runDocumentCommand(r,member,{...command,memberId:file}),{status:'invalid'});assert.equal(r.calls.length,0);}
{const r=rpc({status:'released'});assert.deepEqual(await runDocumentCommand(r,member,{...command,extra:1}),{status:'invalid'});assert.equal(r.calls.length,0);}
assert.deepEqual(await runDocumentCommand(rpc({status:'released'}),member,command),{status:'released'});
assert.deepEqual(await runDocumentCommand(rpc(null,{code:'42501'}),member,command),{status:'access'});
assert.deepEqual(await runDocumentCommand(rpc(null,{code:'55P03'}),member,command),{status:'unavailable'});
assert.deepEqual(await runDocumentCommand(rpc(null,{code:'XX000'}),member,command),{status:'outcome-unknown'});
assert.deepEqual(await runDocumentCommand(rpc({status:'surprise'}),member,command),{status:'outcome-unknown'});

// Opens: the location must name the requested file in the clinic bucket.
const location={fileId:file,bucket:'clinic-originals',objectKey:'k/1',sha256:'a'.repeat(64),sizeBytes:10};
assert.deepEqual(await openMemberDocument(rpc(location),file),location);
assert.equal(await openMemberDocument(rpc({...location,fileId:member}),file),null);
assert.equal(await openMemberDocument(rpc({...location,bucket:'other'}),file),null);
assert.equal(await openDoctorDocument(rpc(location),'not-a-uuid',file),null);

// Member reads: an outage is null (shown as unavailable), never an empty list; no file name field is accepted.
assert.equal(await readMemberDocuments(rpc(null,{code:'XX000'})),null);
assert.equal(memberDocumentsReadSchema.safeParse({version:'released-documents-v1',documents:[{fileId:file,clinic:'C',uploadedAt:'2026-10-17T07:00:00+00:00',releasedAt:'2026-10-17T08:00:00+00:00',name:'x.pdf'}]}).success,false);
assert.equal(await readMemberPlanVersions(rpc({version:'plan-versions-v1',versions:[{planId:file,version:0,publishedAt:'2026-10-17T07:00:00+00:00',changeSummary:null,current:true}]})),null);

// Member copy: clinic and date label, unavailable state, neutral hold text.
const listed=renderToStaticMarkup(createElement(ReleasedDocuments,{documents:[{fileId:file,clinic:'Synthetic clinic',uploadedAt:'2026-10-17T07:00:00+00:00',releasedAt:'2026-10-17T08:00:00+00:00'}],locale:'en'}));
assert.match(listed,/Lab results from Synthetic clinic/);assert.match(listed,new RegExp(`/patient/documents/${file}`));
assert.equal(renderToStaticMarkup(createElement(ReleasedDocuments,{documents:[],locale:'en'})),'');
assert.match(renderToStaticMarkup(createElement(ReleasedDocuments,{documents:null,locale:'hy'})),/անհասանելի/);
for(const locale of ['en','hy'] as const)for(const hasPlan of [true,false]){
 const hold=renderToStaticMarkup(createElement(ConsultationHoldCard,{locale,hasPlan}));
 assert.doesNotMatch(hold,/patient|user|—|!/i);
 assert.equal(/current plan|ընթացիկ պլանը/.test(hold),hasPlan);
}
// Consultation arranging: channel and clinic must agree; mapping is conservative.
const arrange={version:'consultation-arrange-v1',submissionId:'b5a00000-0000-4000-8000-000000000901',memberId:member,since:'2026-10-17T08:00:00+00:00',previous:null,scheduledAt:'2026-10-20T10:30:00+04:00',channel:'phone'};
assert.equal(arrangeCommandSchema.safeParse(arrange).success,true);
assert.equal(arrangeCommandSchema.safeParse({...arrange,channel:'clinic'}).success,false);
assert.equal(arrangeCommandSchema.safeParse({...arrange,clinicId:file}).success,false);
assert.equal(arrangeCommandSchema.safeParse({...arrange,channel:'video'}).success,false);
{const r=rpc({status:'arranged'});assert.deepEqual(await runArrangeCommand(r,{...arrange,channel:'clinic'}),{status:'invalid'});assert.equal(r.calls.length,0);}
assert.deepEqual(await runArrangeCommand(rpc({status:'arranged'}),arrange),{status:'arranged'});
assert.deepEqual(await runArrangeCommand(rpc(null,{code:'42501'}),arrange),{status:'access'});
assert.deepEqual(await runArrangeCommand(rpc({status:'odd'}),arrange),{status:'outcome-unknown'});
assert.equal(await readConsultationQueue(rpc(null,{code:'XX000'})),null);
for(const locale of ['en','hy'] as const){
 const phone=arrangedConsultationText({scheduledAt:'2026-10-20T06:30:00+00:00',channel:'phone',clinic:null},locale);
 const clinic=arrangedConsultationText({scheduledAt:'2026-10-20T06:30:00+00:00',channel:'clinic',clinic:'Synthetic clinic'},locale);
 assert.match(phone,/10:30/);assert.match(clinic,/Synthetic clinic/);
 for(const text of [phone,clinic])assert.doesNotMatch(text,/patient|user|—|!/i);
 const card=renderToStaticMarkup(createElement(ConsultationHoldCard,{locale,hasPlan:false,arrangement:{scheduledAt:'2026-10-20T06:30:00+00:00',channel:'phone',clinic:null}}));
 assert.match(card,/10:30/);assert.doesNotMatch(card,/contact you to arrange|կկապվի ձեզ հետ/);
}
console.log('Doctor completion runtime: flag, command guards, error mapping, open location checks, member reads, copy and consultation arranging pass.');
