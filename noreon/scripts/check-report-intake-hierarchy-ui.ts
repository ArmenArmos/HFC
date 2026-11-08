import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='next/navigation')return {url:'data:text/javascript,export function usePathname(){return "/patient/reports"}',shortCircuit:true};
 if(s==='next/link')return {url:'data:text/javascript,export default function Link(p){return globalThis.__hierarchyReact.createElement("a",p,p.children)}',shortCircuit:true};
 return next(s,c);
}});
const React=await import('react');const {create,act}=await import('react-test-renderer');
Object.assign(globalThis,{__hierarchyReact:React,IS_REACT_ACT_ENVIRONMENT:true,window:{location:{pathname:'/patient/reports'},setTimeout,clearTimeout}});
const {DemoReportsProvider}=await import('@/components/service-workflow/reports-provider');
const {ReportIntake}=await import('@/components/service-workflow/report-intake');
const {sampleReports,SAMPLE_EXTRACTION}=await import('@/lib/reports/demo');
const originalFetch=globalThis.fetch;
const pending={...sampleReports()[0],id:'pending',file_name:'Pending sample.pdf'};
const approved={...sampleReports()[1],id:'approved',file_name:'Approved report.pdf',reviewed:SAMPLE_EXTRACTION,explanation:{summary:'Approved explanation sentinel',attention:[],questions:[],items:SAMPLE_EXTRACTION.rows.map((_,row)=>({row,kind:'result',explanation:`Explanation for row ${row}`}))}};
try {
 for(const locale of ['en','hy'] as const) for(const key of ['current','stale']) {
  let deletes=0;
  globalThis.fetch=async(_input,init)=>{if(init?.method==='DELETE'){deletes++;return Response.json({ok:true});}return Response.json({reports:[{record:pending,revision:0,published:null},{record:approved,revision:0,published:{key:'current',approval:{doctor:'Fictional GP',report:approved}}}]});};
  let renderer!:ReturnType<typeof create>;
  await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:true,locale} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportIntake,{locale,demo:true,demoAi:true,publicationKey:key})));await new Promise(r=>setTimeout(r,25));});
  await act(async()=>{await new Promise(r=>setTimeout(r,25));});
  const json=JSON.stringify(renderer.toJSON());
  const articles=renderer.root.findAllByType('article');
  const filenames=articles.map(article=>article.findAllByType('h3')[0].children.join(''));
  if(key==='current') {
   assert.deepEqual(filenames,[approved.file_name,pending.file_name],'Published explanation precedes pending uploads even when added last');
   assert.ok(json.indexOf('Approved explanation sentinel')<json.indexOf('"type":"file"'),'Explanation precedes upload form');
   const jump=renderer.root.findAllByType('a').find(a=>a.props.href==='#report-approved');
   assert.ok(jump,'Approved report is directly reachable');
   assert.ok(articles[0].props.id==='report-approved');
   for(const row of SAMPLE_EXTRACTION.rows) assert.ok(json.includes(row.literal),'Published literal results remain present');
   assert.ok(json.includes('Fictional GP'),'Approval provenance remains present');
   let confirmation='';
   Object.assign(window,{confirm:(message:string)=>{confirmation=message;return false;}});
   const remove=articles[0].findAllByType('button').find(button=>button.children.includes(locale==='en'?'Remove this report':'Հեռացնել փաստաթուղթը'))!;
   await act(async()=>{await remove.props.onClick();});
   assert.equal(deletes,0,'Canceling published removal never sends a delete');
   assert.ok(confirmation.includes(approved.file_name),'Removal confirmation identifies the published report');
   assert.ok(JSON.stringify(renderer.toJSON()).includes('Approved explanation sentinel'),'Cancel preserves the explanation');

  } else {
   assert.ok(!json.includes('Approved explanation sentinel'),'Stale publication never reveals an explanation');
   assert.equal(renderer.root.findAllByType('a').filter(a=>a.props.href==='#report-approved').length,0);
  }
  const pendingArticle=articles.find(a=>a.findAllByType('h3')[0].children.includes(pending.file_name))!;
  const values=pendingArticle.findByType('details');
  assert.ok(!values.props.open,'Prepared pending values start compact');
  assert.ok(pendingArticle.findAllByType('span').some(n=>n.children.some(child => typeof child === 'string' && child.includes(locale==='en'?'Added for GP review':'Ավելացված է բժշկի վերանայման համար'))),'Pending status stays visible outside disclosure');
  assert.ok(json.includes(locale==='en'?'Clinical review is pending.':'Բժշկական վերանայումը սպասվում է։'));
  if(key==='current') {
   await act(async()=>{renderer.root.findByProps({href:'#report-upload'}).props.onClick();});
   assert.equal(renderer.root.findByProps({id:'report-upload'}).props.open,true,'Add another report opens its target before navigation');
   await act(async()=>{renderer.root.findByProps({id:'report-upload'}).props.onToggle({currentTarget:{open:false}});});
  }
  const uploadDisclosure=renderer.root.findByProps({id:'report-upload'});
  assert.equal(uploadDisclosure.props.open,false,'Upload is secondary when history exists');
  await act(async()=>{uploadDisclosure.props.onToggle({currentTarget:{open:true}});});
  assert.equal(renderer.root.findByProps({id:'report-upload'}).props.open,true,'You can expand upload without changing history');
  await act(async()=>{uploadDisclosure.props.onToggle({currentTarget:{open:false}});});
  assert.equal(renderer.root.findByProps({id:'report-upload'}).props.open,false,'You can collapse upload again');
  if(key==='current') {
   Object.assign(window,{confirm:()=>true});
   const remove=renderer.root.findAllByType('article')[0].findAllByType('button').find(button=>button.children.includes(locale==='en'?'Remove this report':'Հեռացնել փաստաթուղթը'))!;
   await act(async()=>{await remove.props.onClick();});
   assert.equal(deletes,1,'Explicitly confirmed published removal retains the existing delete path');
  }
  await act(async()=>renderer.unmount());
 }
 for(const scenario of ['loading','empty','full'] as const) {
  let finish!:(response:Response)=>void;
  globalThis.fetch=scenario==='loading'?()=>new Promise<Response>(resolve=>{finish=resolve;}):async()=>Response.json({reports:scenario==='full'?Array.from({length:10},(_,i)=>({record:{...approved,id:`full-${i}`},revision:0,published:{key:'current',approval:{doctor:'Fictional GP',report:approved}}})):[]});
  let renderer!:ReturnType<typeof create>;
  await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:true,locale:'en'} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportIntake,{locale:'en',demo:true,demoAi:true,publicationKey:'current'})));});
  await act(async()=>{await new Promise(r=>setTimeout(r,25));});
  if(scenario==='loading') {
   assert.ok(JSON.stringify(renderer.toJSON()).includes('Loading your reports…'));
   assert.equal(renderer.root.findByProps({type:'file'}).props.disabled,true);
   await act(async()=>{finish(Response.json({reports:[]}));});
  } else await act(async()=>{await new Promise(r=>setTimeout(r,25));});
  assert.equal(renderer.root.findAllByProps({href:'/patient/example'}).length,0,'Report intake does not repeat the global example entry');
  if(scenario!=='full') {
   assert.equal(renderer.root.findAllByProps({id:'uploaded-report-history'}).length,0,'Empty history has no large duplicate heading');
   const json=JSON.stringify(renderer.toJSON());
   assert.ok(json.indexOf('"type":"file"')<json.indexOf('"type":"ol"'),'Empty intake reaches upload before supporting workflow');
  }
  if(scenario==='full') {
   assert.equal(renderer.root.findAllByProps({id:'report-upload'}).length,0);
   assert.equal(renderer.root.findAllByProps({href:'#report-upload'}).length,0,'Quota never leaves a broken upload jump');
  } else assert.equal(renderer.root.findByProps({id:'report-upload'}).props.open,true,'First upload is open for empty history');
  await act(async()=>renderer.unmount());
 }
} finally {globalThis.fetch=originalFetch;}
console.log('Report intake hierarchy passes EN/HY rendered component checks: published-first, direct jump, compact pending values, visible pending feedback, upload secondary, and stale approval redaction (mocked network).');
