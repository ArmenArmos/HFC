import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as nodeModule from 'node:module';
// QA sweep of 30 Oct 2026: the smaller fixes, each failing before its change.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const stub=(code:string)=>({url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true});
const hook=registerHooks({resolve(s,c,next){
 if(s==='@/app/patient/care/actions')return stub('export const reportDose=async()=>({ok:true});export const acknowledgePlan=async()=>({ok:true});');
 if(s==='next/navigation')return stub('export const useRouter=()=>({refresh(){},replace(){}});');
 return next(s,c);
}});
const failed:string[]=[];
const item=async(id:string,run:()=>Promise<void>)=>{try{await run();}catch(e){failed.push(id);console.error(`${id}: ${(e as Error).message.split('\n')[0]}`);}};
try{
 // a1-01: a birth date typed with slashes keeps the day and month the member meant.
 await item('a1-01',async()=>{
 const {maskBirthInput}=await import('@/lib/patient/validation');
 const type=(keys:string)=>{let v='';for(const k of keys)v=maskBirthInput(v+k);return v;};
 assert.equal(type('1/1/1990'),'01/01/1990','typed with single digits');
 assert.equal(type('12/3/1990'),'12/03/1990');
 assert.equal(type('1.2.1990'),'01/02/1990','dots');
 assert.equal(type('01011990'),'01/01/1990','digits only, as before');
 assert.equal(type('18/05/1974'),'18/05/1974','a full date, as before');
 assert.equal(maskBirthInput('1/',true),'1','deleting never pads');
 });
 // a2-01: a dose reported earlier still says so after a reload, when no "saved" message is left on screen.
 await item('a2-01',async()=>{
 const {DoseButtons}=await import('@/components/patient-care/controls');
 const medication={id:'m',name:'Fictional',dose:'1',planId:'p'};
 const render=(status:string,l:'en'|'hy'|'ru'='en')=>renderToStaticMarkup(createElement(DoseButtons,{compact:true,locale:l,dose:{medication,dueAt:'2026-10-30T08:00:00Z',status,revision:1} as never}));
 const taken=render('taken');
 assert.match(taken,/Reported taken/,'compact, taken: says so');
 assert.match(taken,/Change to skipped/,'the correction stays');
 assert.doesNotMatch(taken,/sr-only[^<]*>Reported taken/,'and it is visible');
 assert.match(render('skipped'),/Reported skipped/,'compact, skipped: says so');
 assert.doesNotMatch(render('due'),/Reported/,'nothing reported yet');
 });
 // a2-02: a chart reaching over a year shows the years; a chart within this year stays as short as it was.
 await item('a2-02',async()=>{
 const {MeasurementTrend}=await import('@/components/patient/measurement-trend');
 const reading=(iso:string)=>({id:iso,measuredAt:iso,systolic:128,diastolic:82,pulse:70,source:'manual'});
 const trend=(a:string,b:string)=>renderToStaticMarkup(createElement(MeasurementTrend as never,{measurements:[reading(b),reading(a)],locale:'en'} as never));
 assert.match(trend('1990-01-01T08:00:00Z','2026-10-30T08:00:00Z'),/1990/,'an old date reads as old');
 assert.doesNotMatch(trend('2026-03-01T08:00:00Z','2026-10-30T08:00:00Z'),/2026/,'one year needs no year');
 });
 // a6-03: a malformed body to the report route is the caller's mistake, not an outage.
 await item('a6-03',async()=>{
 const reports=readFileSync('lib/reports/server.ts','utf8'),route=readFileSync('app/api/patient/reports/route.ts','utf8');
 assert.match(reports,/command\.safeParse\(input\)/,'a body that fits no command is invalid');
 assert.match(route,/JSON\.parse\(text\)[\s\S]{0,80}invalid/,'a body that is not JSON is invalid');
 });
 // a6-02: an unassigned doctor gets the same 404 as everyone else who may not open the file.
 await item('a6-02',async()=>{
 const history=readFileSync('lib/member-history/server.ts','utf8');
 assert.match(history,/row\.error\.code !== "42501"/,'the database refusing access is a 404');
 });
 // a7-03: the member header wraps at any width, not only below 359px.
 await item('a7-03',async()=>{
 const shell=readFileSync('components/patient/patient-shell.tsx','utf8');
 assert.match(shell,/mx-auto flex max-w-6xl flex-wrap items-center/);
 assert.doesNotMatch(shell,/flex shrink-0 items-center gap-2/,'the header actions may wrap');
 assert.match(readFileSync('components/patient/profile-form.tsx','utf8'),/<fieldset disabled=\{busy\} className="min-w-0/,'a fieldset does not shrink unless told to');
 });
 // a4-01: the publish confirmation lives above the keyed controls, so their remount cannot lose it.
 await item('a4-01',async()=>{
 const controls=readFileSync('components/real-review/review-controls.tsx','utf8');
 const page=readFileSync('app/staff/real/(review)/members/[id]/page.tsx','utf8');
 assert.match(controls,/useContext\(PublishConfirmation\)/);
 assert.match(controls,/snapshot\.revision<=kept\.revision\+1/,'a draft saved after publishing can be published (Astra R4)');
 assert.match(page,/<PublishConfirmationProvider>[\s\S]*<RealReviewControls[\s\S]*? key=[\s\S]*<\/PublishConfirmationProvider>/,'the provider sits outside the keyed controls');
 });
}finally{hook.deregister();}
assert.deepEqual(failed,[],'QA sweep 1 fixes');
console.log('QA sweep 1 fixes checks passed.');
