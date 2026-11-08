import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
const state={workflowReads:0, contextReads:0, registeredReads:0, reportStateReads:0, contextError:''};
Object.assign(globalThis,{__reportPageMode:state});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 const stubs:Record<string,string>={
  '@/components/patient/patient-shell':'export function PatientShell({children}){return children}',
  '@/lib/patient/render-data':'export async function requireRegisteredForRender(){globalThis.__reportPageMode.registeredReads++;return {profile:{locale:"en",name:"Fictional member"}}}',
  '@/lib/reports/enabled':'export function reportsEnabled(){return false}',
  '@/lib/reports/context':'export async function registeredReportState(){globalThis.__reportPageMode.reportStateReads++;return {profile:{locale:"en",name:"Fictional member"}}} export async function reportContext(){const state=globalThis.__reportPageMode;state.contextReads++;if(state.contextError)throw new Error(state.contextError);return {}}',
  '@/lib/service-workflow/server':'export async function getServiceWorkflowForRender(){globalThis.__reportPageMode.workflowReads++;return null}',
 };
 if(stubs[s])return {url:'data:text/javascript,'+encodeURIComponent(stubs[s]),shortCircuit:true};
 return next(s,c);
}});
try {
 const {default:Page}=await import('@/app/patient/reports/page');
 const {ReportWorkspace}=await import('@/components/reports/report-workspace');
 const {ReportsContent}=await import('@/components/reports/member-reports-content');
 const workspace=(page:Awaited<ReturnType<typeof ReportsContent>>,type:unknown)=>{
  const body=page.props['data-member-chat-card']==='reports'?page.props.children:page.type===Symbol.for('react.fragment')?page:page.props.children;
  const children=Array.isArray(body.props.children)?body.props.children:[body.props.children];
  const matches=children.filter((child:unknown)=>!!child&&typeof child==='object'&&'type' in child&&child.type===type);
  assert.equal(matches.length,1,'Exactly one mode-appropriate report workspace is rendered');
  return matches[0];
 };
 const real=workspace(await Page(),ReportWorkspace);
 assert.equal(real.props.demo,false);assert.equal(real.props.enabled,false);
 assert.equal(state.workflowReads,0,'Real history never loads a demo workflow');
 assert.equal(state.registeredReads,0,'Real reports reuse the validated request client instead of a second Auth read');
 assert.equal(state.reportStateReads,1,'Real reports retain full profile/consent/assessment validation');
 const priorRegistered=state.registeredReads;
 state.contextError='unavailable';await assert.rejects(()=>ReportsContent({}),/unavailable/);
 assert.equal(state.registeredReads,priorRegistered,'Infrastructure outage reaches retry boundary before the legacy signed-out fallback');
 state.contextError='unauthorized';await assert.rejects(()=>ReportsContent({}),error=>!!error&&typeof error==='object'&&'digest'in error&&String(error.digest).includes('/patient'),'Missing/expired authentication still redirects to sign in');
 state.contextError='';
 const before=state.reportStateReads;
 const embedded=await ReportsContent({embedded:true});
 assert.equal(embedded.type,'section','Embedded reports have no page shell');
 assert.equal(embedded.props['data-member-chat-card'],'reports','Embedded report reader participates in chat focus and scrolling');
 const embeddedWorkspace=workspace(embedded,ReportWorkspace);
 assert.equal(embeddedWorkspace.props.embedded,true);assert.equal(embeddedWorkspace.props.demo,false);assert.equal(embeddedWorkspace.props.enabled,false);
 assert.equal(state.reportStateReads,before+1,'Embedded reports retain the same validated profile/consent/assessment read');
 assert.equal(state.workflowReads,0,'Embedded reports never read demo workflows');
 state.contextError='unauthorized';await assert.rejects(()=>ReportsContent({embedded:true}),error=>!!error&&typeof error==='object'&&'digest'in error&&String(error.digest).includes('/patient'),'Embedded reports retain authentication redirect');
 console.log('Actual reports page renders the owned report workspace with validated report context.');
} finally {hook.deregister();Reflect.deleteProperty(globalThis,'__reportPageMode');}
