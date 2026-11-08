import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s: string,c: object,next:(s:string,c:object)=>object){
 if(s==='next/navigation')return {url:'data:text/javascript,export function usePathname(){return "/patient/reports"}',shortCircuit:true};
 if(s==='next/link')return {url:'data:text/javascript,export default function Link(p){return globalThis.__sampleReact.createElement("a",p,p.children)}',shortCircuit:true};
 return next(s,c);
}});
const React=await import('react');const {create,act}=await import('react-test-renderer');
Object.assign(globalThis,{__sampleReact:React,IS_REACT_ACT_ENVIRONMENT:true,window:{location:{pathname:'/patient/reports'},setTimeout,clearTimeout}});
const {DemoReportsProvider}=await import('@/components/service-workflow/reports-provider');const {ReportIntake}=await import('@/components/service-workflow/report-intake');const {sampleReports,sampleReportPreview}=await import('@/lib/reports/demo');
const originalFetch=globalThis.fetch;const saved: ReturnType<typeof sampleReports>=[];const writes:number[]=[];let failed=false;
globalThis.fetch=async (_input,init)=>{
 if(!init?.method)return Response.json({reports:saved.map(record=>({record,revision:0,approval:null,published:null,original:false}))});
 const input=JSON.parse(String(init.body));writes.push(input.year);
 if(input.year===2024&&!failed){failed=true;return Response.json({error:'unavailable'},{status:503});}
 const source=sampleReports().find(r=>r.file_name.includes(String(input.year)))!;
 const record={...source,id:crypto.randomUUID(),state:'needs_review',sample_preview:sampleReportPreview(source),extraction:null,reviewed:null,explanation:null} as typeof source;saved.push(record);return Response.json({report:record});
};
let renderer!: ReturnType<typeof create>;
try {
 await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:true,locale:'en'} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportIntake,{locale:'en',demo:true,demoAi:false,publicationKey:null})));await new Promise(r=>setTimeout(r,25));});
 await act(async()=>{renderer.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});});
 const button=()=>renderer.root.findAllByType('button').find(n=>n.children.includes('Add sample reports'))!;
 await act(async()=>{await button().props.onClick();});
 assert.deepEqual(writes,[2025,2024]);assert.equal(saved.length,1);assert.equal(renderer.root.findAll(n=>n.props.role==='alert').length,1);
 assert.ok(JSON.stringify(renderer.toJSON()).includes('Prepared sample values · Awaiting review'));
 assert.ok(renderer.root.findAllByType('article').every(article=>article.findByType('details').props.open),'A partially imported sample opens its prepared values immediately');
 await act(async()=>{await button().props.onClick();});
 assert.deepEqual(writes,[2025,2024,2024],'Retry skips the first stored sample instead of inserting a duplicate');
 assert.equal(saved.length,2);assert.equal(renderer.root.findAll(n=>n.props.role==='alert').length,0);
 assert.ok(JSON.stringify(renderer.toJSON()).includes('Sample reports saved.'));
 assert.ok(renderer.root.findAllByType('a').some(link=>saved.some(report=>link.props.href===`#report-${report.id}`)),'Saved feedback links directly to the added sample fields');
 assert.ok(renderer.root.findAllByType('article').every(article=>article.findByType('details').props.open),'Newly imported samples show their prepared values immediately');
 await act(async()=>renderer.unmount());
 for (const scenario of ['all-published','mixed','stale-key'] as const) {
   globalThis.fetch=async()=>Response.json({reports:saved.map((record,index)=>({record,revision:0,approval:null,original:false,published:scenario==='mixed'&&index===1?null:{key:'current-plan',approval:{doctor:'Fictional doctor',revision:0,at:new Date().toISOString(),report:{...record,reviewed:record.sample_preview}}}}))});
   await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:true,locale:'en'} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportIntake,{locale:'en',demo:true,demoAi:false,publicationKey:scenario==='stale-key'?'old-plan':'current-plan'})));await new Promise(r=>setTimeout(r,25));});
   await act(async()=>{await new Promise(r=>setTimeout(r,25));});
   const pending=JSON.stringify(renderer.toJSON()).includes('Clinical review is pending.');
   assert.equal(pending,scenario!=='all-published',`Sample pending status respects publication: ${scenario}`);
   await act(async()=>renderer.unmount());
 }

} finally {globalThis.fetch=originalFetch;await act(async()=>renderer?.unmount());}
console.log('Sample intake UI passes: partial save visible, one retryable error, stored preview, retry only missing report, honest success, all-published/mixed/stale publication status (mocked network).');
