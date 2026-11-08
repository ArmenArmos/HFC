import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='next/navigation')return {url:'data:text/javascript,export function usePathname(){return "/patient/reports"}',shortCircuit:true};
 return next(s,c);
}});
const React=await import('react');
const {create,act}=await import('react-test-renderer');
const {DemoReportsProvider}=await import('@/components/service-workflow/reports-provider');
const {ReportWorkspace}=await import('@/components/reports/report-workspace');
const {sampleReports,SAMPLE_EXTRACTION}=await import('@/lib/reports/demo');
Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,configurable:true});
const savedFetch=globalThis.fetch;
let reads=0;
const record={...sampleReports()[0],id:crypto.randomUUID(),file_name:'Owned historical report.pdf',extraction:null,reviewed:null,explanation:null};
try {
 for(const locale of ['en','hy'] as const) {
  globalThis.fetch=async input=>{assert.equal(String(input),'/api/patient/reports');reads++;return Response.json({reports:[record]});};
  let renderer!:ReturnType<typeof create>;
  const prior=reads;
  await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:false} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportWorkspace,{locale,demo:false,enabled:false,memberName:'Fictional member'})));});
  assert.ok(reads>prior,'Real workspace fetches saved history even while import is disabled');
  assert.equal(renderer.root.findAllByProps({type:'file'}).length,0);
  const json=JSON.stringify(renderer.toJSON());
  assert.ok(json.includes(record.file_name));assert.ok(!json.includes(locale==='en'?'Load sample reports':'Բեռնել օրինակները'));
  const select=renderer.root.findAllByType('button').find(button=>button.findAll(node=>node.type==='span'&&node.children.includes(record.file_name)).length)!;
  await act(async()=>{select.props.onClick();});
  const download=renderer.root.findAllByType('a').find(link=>link.props.href===`/api/patient/reports/${record.id}/original`);
  assert.ok(download,'Saved original remains downloadable');
  const extraction=renderer.root.findAllByType('button').find(button=>button.children.includes(locale==='en'?'Try extraction again':'Կրկին ընթերցել'));
  assert.ok(!extraction || extraction.props.disabled,'Extraction stays disabled');
  await act(async()=>{renderer.unmount();});
  // A pending load, empty history and outage remain distinct, and an outage can be retried.
  let finish!: (response: Response) => void;
  globalThis.fetch=()=>new Promise<Response>(resolve=>{finish=resolve;});
  await act(async()=>{renderer=create(React.createElement(DemoReportsProvider,{shared:false} as Parameters<typeof DemoReportsProvider>[0],React.createElement(ReportWorkspace,{locale,demo:false,enabled:false,memberName:'Fictional member'})));});
  assert.ok(renderer.root.findAllByProps({role:'status'}).some(node=>node.children.includes(locale==='en'?'Loading your reports…':'Ձեր հետազոտությունները բեռնվում են…')));
  await act(async()=>{finish(Response.json({reports:[]}));});
  assert.ok(JSON.stringify(renderer.toJSON()).includes(locale==='en'?'You have no saved reports yet.':'Դուք դեռ չունեք պահված հետազոտություններ։'));
  globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503});
  const refresh=renderer.root.findAllByType('button').find(button=>button.children.includes(locale==='en'?'Refresh':'Թարմացնել'))!;
  await act(async()=>{await refresh.props.onClick();});
  assert.ok(renderer.root.findByProps({role:'alert'}).children.join('').length>0,'History failure has visible recovery copy');
  assert.ok(!JSON.stringify(renderer.toJSON()).includes(locale==='en'?'You have no saved reports yet.':'Դուք դեռ չունեք պահված հետազոտություններ։'),'Outage is never shown as empty history');
  globalThis.fetch=async()=>Response.json({reports:[{...sampleReports()[1],id:record.id,file_name:record.file_name,reviewed:SAMPLE_EXTRACTION}]});
  await act(async()=>{await refresh.props.onClick();});
  assert.equal(renderer.root.findAllByProps({role:'alert'}).length,0);
  const saved=renderer.root.findAllByType('button').find(button=>button.findAll(node=>node.type==='span'&&node.children.includes(record.file_name)).length)!;
  await act(async()=>{saved.props.onClick();});
  const savedInputs=renderer.root.findAllByType('input');
  assert.ok(savedInputs.length>=7,'Saved date, result fields and confirmation controls are present');
  assert.ok(savedInputs.every(input=>input.props.disabled),'Read-only history never offers unsaveable edits');
  assert.ok(JSON.stringify(renderer.toJSON()).includes(locale==='en'?'Saved report details are read-only':'Պահված հետազոտության տվյալները միայն դիտելու համար են'));
  const save=renderer.root.findAllByType('button').find(button=>button.children.includes(locale==='en'?'Save checked results':'Պահել ստուգված արդյունքները'));
  assert.ok(save?.props.disabled,'Saved report writes stay disabled');
  const remove=renderer.root.findAllByType('button').find(button=>button.children.includes(locale==='en'?'Remove this report':'Հեռացնել այս փաստաթուղթը'));
  assert.ok(remove&&!remove.props.disabled,'Removing your own report stays available with import off (privacy audit B3-4)');
  const explain=renderer.root.findAllByType('button').find(button=>button.children.includes(locale==='en'?'Explain saved results':'Բացատրել պահված արդյունքները'));
  assert.ok(explain?.props.disabled,'New explanation stays gated while saved content is readable');
  await act(async()=>{renderer.unmount();});
 }
 console.log('Actual report workspace passes EN/HY mocked-network checks: history loads without import, saved original link, no upload/sample controls, gated writes, loading/empty/outage states and refresh recovery.');
} finally {globalThis.fetch=savedFetch;}
