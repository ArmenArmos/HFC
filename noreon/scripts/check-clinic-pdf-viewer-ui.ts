import assert from 'node:assert/strict';
import * as React from 'react';
import {act,create} from 'react-test-renderer';
import {ClinicPdfViewer} from '@/components/clinic-portal/pdf-viewer';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const originalFetch=globalThis.fetch;
let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('A clinic view must not read a PDF');};
let tree!:ReturnType<typeof create>;
try{
 for(const locale of ['en','hy','ru'] as const){
  const props={clinicId:'clinic-a',actorScope:'current',memberId:'member-a',fileId:'file-a',name:'PRIVATE original patronymic CBC.pdf',locale,onClose:()=>{}};
  await act(async()=>{tree=create(React.createElement(ClinicPdfViewer,props));});
  const content=JSON.stringify(tree.toJSON());
  assert.ok(!content.includes('PRIVATE')&&!content.includes('CBC')&&!content.includes('Open PDF'));
  assert.equal(tree.root.findAllByType('iframe').length,0,'No preview or fallback PDF frame');
  assert.equal(tree.root.findAllByType('a').length,0,'No PDF download link');
  assert.equal(tree.root.findAllByType('button').length,0,'No retry or open control');
  assert.ok(content.includes({en:"Linked to the member's record. Their doctor reviews the values.",hy:'Կցված է անդամի գրառմանը։ Արժեքները վերանայում է նրա բժիշկը։',ru:'Прикреплено к записи участника. Значения проверяет его врач.'}[locale]),'Linked-file notice explains that the doctor reviews values');
  await act(async()=>tree.update(React.createElement(ClinicPdfViewer,{...props,actorScope:'changed'})));
  assert.equal(requests,0,'No read during opening, loading, error, or scope changes');
  await act(async()=>tree.unmount());
 }
 console.log('Clinic PDF UI PASS: EN/HY/RU linked-file notice, no sensitive name, fetch, frame, fallback, or opening control, including scope changes.');
}finally{globalThis.fetch=originalFetch;}

// The clinician document component retains its original PDF link in every locale.
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
const {registerHooks}=await import('node:module');
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/components/staff/shell')return {url:'data:text/javascript,export const buttonClass=""',shortCircuit:true};
 if(s==='@/components/staff/record-refresh')return {url:'data:text/javascript,export const useRecordRefresh=()=>()=>{}',shortCircuit:true};
 return next(s,c);
}});
try{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {MemberDocuments}=await import('@/components/staff/member-documents');
 const memberId='00000000-0000-4000-8000-000000000001',fileId='00000000-0000-4000-8000-000000000002';
 for(const locale of ['en','hy','ru'] as const){
  const html=renderToStaticMarkup(React.createElement(MemberDocuments,{locale,memberId,submissionIds:{},command:async()=>({status:'access' as const}),data:{version:'member-documents-v1',enabled:true,documents:[{fileId,name:'Original for clinician.pdf',clinic:'Synthetic clinic',uploadedAt:'2026-11-05T08:00:00Z',attachedAt:'2026-11-05T08:00:00Z',released:false,releasedAt:null,openedByYou:false}]}}));
  assert.ok(html.includes(`/staff/real/members/${memberId}/documents/${fileId}`),'Staff PDF URL is preserved');
  assert.ok(html.includes({en:'Open PDF',hy:'Բացել PDF-ը',ru:'Открыть PDF'}[locale]),'Staff opening control is preserved');
 }
 console.log('Staff document UI PASS: existing PDF link and translated opening control preserved. Rendered with synthetic IO.');
}finally{hook.deregister();}
