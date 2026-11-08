import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/lib/clinic-portal/identity')return {url:'data:text/javascript,export async function requireClinicPortal(){return {identity:{clinicId:"clinic-a"},actorScope:"current",rpc:{}}}',shortCircuit:true};
 if(s==='@/lib/clinic-scheduling/member-file')return {url:'data:text/javascript,export async function openClinicMemberPdf(){globalThis.__pdfReads++;return globalThis.__pdfBytes}',shortCircuit:true};
 if(s==='@/lib/clinic-scheduling/schema')return {url:'data:text/javascript,export function clinicSchedulingEnabled(){return true}',shortCircuit:true};
 if(s==='@/lib/observability/with-logging')return {url:'data:text/javascript,export const withRouteLogging=f=>f',shortCircuit:true};
 return next(s,c);
}});
Object.assign(globalThis,{__pdfReads:0,__pdfBytes:Buffer.from('%PDF-synthetic-original')});
const {GET}=await import('@/app/clinic/real/members/[memberId]/files/[fileId]/route');
const params={params:Promise.resolve({memberId:'member',fileId:'file'})};
const stale=await GET(new Request('http://localhost/clinic/real/members/member/files/file?clinic=clinic-a',{headers:{'x-clinic-ui-scope':'stale'}}),params);
assert.equal(stale.status,403,'Old chat actor cannot read a PDF under a new session');
assert.equal((globalThis as unknown as {__pdfReads:number}).__pdfReads,1,'Stale UI attempt still reaches refusal audit, with no bytes returned');
const good=await GET(new Request('http://localhost/clinic/real/members/member/files/file?clinic=clinic-a',{headers:{'x-clinic-ui-scope':'current'}}),params);
assert.equal(good.status,403);assert.equal(await good.text(),'');assert.match(good.headers.get('cache-control')!,/no-store/);assert.equal(good.headers.get('content-disposition'),null);
Object.assign(globalThis,{__pdfBytes:null});
assert.equal((await GET(new Request('http://localhost/file?clinic=clinic-a',{headers:{'x-clinic-ui-scope':'current'}}),params)).status,403);
console.log('Clinic PDF route PASS: stale actor audited and refused, empty 403 even with stale storage/helper bytes, private no-store. Auth injected.');
