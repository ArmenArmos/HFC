import assert from 'node:assert/strict';
// @ts-expect-error Node 24+ runtime hook; type definitions target Node 20.
import {registerHooks} from 'node:module';
const f={signedIn:true,quota:60,outage:false,claims:0,writes:0};
Object.assign(globalThis,{__admissionHttp:f});
const setup='const f=globalThis.__admissionHttp;';
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/lib/staff/auth') return {url:'data:text/javascript,'+encodeURIComponent(setup+`export function workspaceAdmin(){return {rpc:async(name,args)=>{if(name!=='claim_workspace_admission'||args.p_operation!=='upload'||!/^[a-f0-9]{64}$/.test(args.p_source))throw Error('wrong admission request');f.claims++;return {data:f.quota,error:f.outage?{message:'offline'}:null}}}}`),shortCircuit:true};
 if(s==='@/lib/staff/cases') return {url:'data:text/javascript,'+encodeURIComponent(setup+`export async function requireMemberCase(){if(!f.signedIn)throw Error('unauthorized');return {id:'fictional-member'}}`),shortCircuit:true};
 if(s==='@/lib/staff/reports') return {url:'data:text/javascript,'+encodeURIComponent(setup+`export const listCaseReports=async()=>[];export async function addFictionalReport(){f.writes++;return {id:'fictional-report'}};export const addMemberReport=async()=>{f.writes++;throw Error('unexpected upload')};export const deleteMemberReport=()=>{};export const toReport=x=>x;export const redactMemberReport=x=>x;`),shortCircuit:true};
 if(s==='@/lib/staff/request') return {url:'data:text/javascript,export const sameWorkspaceOrigin=()=>true;',shortCircuit:true};
 return next(s,c);
}});
process.env.VERCEL='1';process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY='fictional-admission-test-secret-at-least-32';
try{
 const {POST}=await import('@/app/patient/reports/shared/route');
 const req=()=>new Request('https://demo.noreon.health/patient/reports/shared',{method:'POST',headers:{'content-type':'application/json','x-vercel-forwarded-for':'203.0.113.1'},body:JSON.stringify({op:'sample',year:2025,sharedConsent:true})});
 let request=req();const blocked=await POST(request);
 assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'60');assert.equal(blocked.headers.get('cache-control'),'no-store');assert.equal(request.bodyUsed,false);assert.equal(f.writes,0);
 f.signedIn=false;f.claims=0;assert.equal((await POST(req())).status,401);assert.equal(f.claims,0);
 f.signedIn=true;f.outage=true;assert.equal((await POST(req())).status,503);assert.equal(f.writes,0);
 f.outage=false;f.quota=0;assert.equal((await POST(req())).status,200);assert.equal(f.writes,1);
 request=req();request.headers.delete('x-vercel-forwarded-for');f.claims=0;assert.equal((await POST(request)).status,503);assert.equal(f.claims,0);assert.equal(f.writes,1);
 console.log('Real report POST authenticates before admission; denies before body/storage; fails closed; admits valid requests.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__admissionHttp');}
