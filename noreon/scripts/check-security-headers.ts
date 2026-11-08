import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
Object.assign(globalThis,{AsyncLocalStorage});
const {unstable_getResponseFromNextConfig}=await import('next/experimental/testing/server');
import config from '../next.config';
for(const path of ['/patient','/staff/doctor','/staff/backoffice','/api/internal/demo-report']){
 const response=await unstable_getResponseFromNextConfig({url:`https://demo.noreon.health${path}`,nextConfig:config});
 assert.equal(response.headers.get('x-frame-options'),'DENY',path);
 assert.match(response.headers.get('content-security-policy')??'',/frame-ancestors 'none'/,path);
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('referrer-policy'),'same-origin');
 assert.match(response.headers.get('permissions-policy')??'',/geolocation=\(\)/);
}
for(const path of ['/staff/reports?caseId=one&original=two&preview=1','/api/patient/reports/one/original?preview=1']){
 const response=await unstable_getResponseFromNextConfig({url:`https://demo.noreon.health${path}`,nextConfig:config});
 assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN',path);
 assert.match(response.headers.get('content-security-policy')??'',/frame-ancestors 'self'/,path);
}
// The lab check frames the audited PDF. Its own framing rule stays same-origin, and the rest of the record stays DENY.
const labPdf=await unstable_getResponseFromNextConfig({url:'https://backoffice.noreon.health/staff/real/members/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222',nextConfig:config});
assert.equal(labPdf.headers.get('x-frame-options'),'SAMEORIGIN');assert.match(labPdf.headers.get('content-security-policy')??'',/frame-ancestors 'self'/);
const labCheck=await unstable_getResponseFromNextConfig({url:'https://backoffice.noreon.health/staff/real/members/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/check',nextConfig:config});
assert.equal(labCheck.headers.get('x-frame-options'),'DENY');
const memberUploadPath='/staff/real/members/11111111-1111-4111-8111-111111111111/member-uploads/22222222-2222-4222-8222-222222222222';
for(const suffix of ['', '?page=2']){
 const upload=await unstable_getResponseFromNextConfig({url:`https://backoffice.noreon.health${memberUploadPath}${suffix}`,nextConfig:config});
 assert.equal(upload.headers.get('x-frame-options'),'SAMEORIGIN');
 assert.equal(upload.headers.get('content-security-policy'),"default-src 'none'; frame-ancestors 'self'");
 assert.equal(upload.headers.get('referrer-policy'),'no-referrer');
 assert.equal(upload.headers.get('x-content-type-options'),'nosniff');
}
for(const path of [memberUploadPath+'/check',memberUploadPath+'/other','/staff/real/members/11111111-1111-4111-8111-111111111111/member-uploads']){
 const neighbor=await unstable_getResponseFromNextConfig({url:`https://backoffice.noreon.health${path}`,nextConfig:config});
 assert.equal(neighbor.headers.get('x-frame-options'),'DENY',path);
 assert.match(neighbor.headers.get('content-security-policy')??'',/frame-ancestors 'none'/,path);
}
console.log('Next routing applies browser protections to member/staff/API and preserves same-origin original previews.');
const voice=await unstable_getResponseFromNextConfig({url:'https://noreon.health/demo/anamnesis',nextConfig:config});
assert.match(voice.headers.get('permissions-policy')??'',/microphone=\(self\)/,'Existing voice answers must remain available with browser consent');
const {IncomingMessage,ServerResponse}=await import('node:http');
const {Socket}=await import('node:net');
const {NodeNextRequest,NodeNextResponse}=await import('next/dist/server/base-http/node');
const {sendResponse}=await import('next/dist/server/send-response');
for(const path of ['/patient/reports/shared?original=one','/staff/reports?original=one','/api/patient/reports/one/original','/patient/reports/shared?original=one&preview=1']){
 const configured=await unstable_getResponseFromNextConfig({url:`https://demo.noreon.health${path}`,nextConfig:config});
 const request=new IncomingMessage(new Socket());request.method='HEAD';
 const output=new NodeNextResponse(new ServerResponse(request));
 configured.headers.forEach((value,name)=>output.setHeader(name,value));
 await sendResponse(new NodeNextRequest(request),output,new Response(null,{headers:{'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'attachment'}}));
 assert.match(output.getHeader('content-security-policy')??'',/default-src 'none'/,path);
 assert.match(output.getHeader('content-security-policy')??'',/sandbox/,path);
 assert.equal(output.getHeader('content-disposition'),'attachment');
}
console.log('Existing voice consent and download sandbox survive actual Next response-header merging.');

const realSource=await unstable_getResponseFromNextConfig({url:'https://backoffice.noreon.health/staff/real/members/11111111-1111-4111-8111-111111111111/reports/22222222-2222-4222-8222-222222222222',nextConfig:config});
assert.equal(realSource.headers.get('referrer-policy'),'no-referrer','Real staff source redirect keeps its stricter referrer policy after config merging');
assert.equal(realSource.headers.get('x-frame-options'),'DENY');
console.log('Real staff source report route preserves no-referrer in Next header configuration.');
