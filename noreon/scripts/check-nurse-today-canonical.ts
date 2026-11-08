import {resolveTestModule} from './care-alert-resolve-test-module';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as icons from 'lucide-react';
import * as config from '@/lib/nurse-chat/config';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as inbox from '@/lib/doctor-inbox/contracts';
import * as locale from '@/lib/locale';
import {SidebarNav} from '@/components/app-shell/sidebar-nav';

// Real route functions; authentication and reads are isolated, with no database or network.
let role='nurse',signedIn=true,v2=true,telegram=true,adminChecks=0,doctorReads=0;
const empty=()=>null;
const modules:Record<string,unknown>={
 'react/jsx-runtime':jsx,'lucide-react':icons,
 'next/link':{default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)},
 'next/navigation':{notFound:()=>{throw Error('404');},redirect:(path:string)=>{throw Error(`redirect:${path}`);},unstable_rethrow:()=>{},usePathname:()=>'/staff/real/nurse-chat'},
 '@/lib/locale':locale,'@/components/app-shell/sidebar-nav':{SidebarNav},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{if(!signedIn)throw Error('redirect:/staff/real/login?notice=existing');return {identity:{role,name:'Fictional staff'},client:{}};}},
 '@/lib/nurse-chat/config':{...config,nurseTodayHref:()=>config.nurseTodayHref({NOREON_NURSE_CHAT:'true',NOREON_NURSE_CHAT_V2:String(v2)})},
 '@/lib/staff/staff-locale':{staffLocale:async()=> 'en'},'@/lib/staff/staff-locale-copy':copy,
 '@/components/patient-care/common':{CareSection:({title,children}:{title:string;children:React.ReactNode})=>React.createElement('section',null,title,children),Status:empty,stamp:()=>''},
 '@/lib/care-alerts/contracts':{closeResolutions:[],careAlertsEnabled:()=>false},
 '@/components/staff/alert-card':{AlertCardLines:empty},
 '@/lib/care-alerts/actions':{acknowledgeCareAlert:empty,resolveCareAlert:empty},
 '@/components/ui/select-field':{SelectField:empty},'@/lib/doctor-inbox/contracts':inbox,
 './actions':{approveInboxDraft:empty,rejectInboxDraft:empty},
 '@/lib/doctor-inbox/zoe-answered':{zoeMarkNotices:{}},
 '@/components/doctor-inbox/zoe-answered':{ZoeAnsweredSection:empty},
 '@/components/doctor-inbox/nurse-activity':{NurseActivity:empty},
 '@/components/doctor-inbox/medicine-concerns':{MedicineConcernsSection:empty},
 '@/components/staff/first-note-queue':{FirstNoteQueue:empty},
 '@/components/doctor-inbox/ldl-responses':{LdlResponsesSection:empty},
 '@/lib/doctor-inbox/day':{readDoctorDay:async()=>{doctorReads++;return {inbox:{items:[],p0:[],unavailable:[],nurseActivity:[],zoeAnsweredTotal:0,asOf:'2026-11-06T09:00:00Z'},windows:[],firstNotes:{enabled:false,items:[]}};},doctorDayCounts:()=>({total:0,alerts:0})},
 '@/lib/doctor-inbox/urgent-windows':{mergeUrgent:()=>[]},
 '@/lib/doctor-inbox/source-labels':{sourcesLine:()=>''},
 '@/components/doctor-inbox/urgent-window':{UrgentWindowRow:empty},
 '@/lib/staff-zoe/workspace-config':{doctorChatHomeEnabled:()=>false},
 '@/components/staff/doctor-workspace/day-cards':{OverdueTaskCards:empty},
 '@/components/staff/nurse-handoffs':{NurseHandoffs:empty},
 '@/app/staff/real/conversation/actions':{readAwaitingReplies:async()=>{doctorReads++;return {items:[]};},readZoeAnswered:async()=>({items:[]})},
 '@/lib/telegram-runtime/config':{telegramEnabled:()=>telegram},
 '@/lib/telegram-runtime/delivery-copy':{},
 '@/lib/staff/real-admin':{adminOnly:async()=>{adminChecks++;}},
 '@/lib/admin-conversations/server':{readAdminConversationList:async()=>({kind:'off'})},
 '@/lib/admin-conversations/contracts':{parseAdminConversationFilter:(filter:unknown)=>filter},
 '@/components/admin-conversations/list':{AdminConversationListView:empty},
};
const resolveFormModule=resolveTestModule();
modules['@/components/staff/care-alert-resolve']=resolveFormModule;
modules['./care-alert-resolve']=resolveFormModule;
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,`Missing stub: ${name}`);return modules[name];}});
 return exports;
}
type Page=(props:{searchParams:Promise<Record<string,unknown>>})=>Promise<React.ReactElement<{filter?:unknown}>>;
const today=load('app/staff/real/(review)/today/page.tsx').default as Page;
const conversations=load('app/staff/real/(review)/conversations/page.tsx').default as Page;
for(const env of [{},{NOREON_NURSE_CHAT:'true'},{NOREON_NURSE_CHAT_V2:'true'},{NOREON_NURSE_CHAT:'true',NOREON_NURSE_CHAT_V2:'TRUE'}])assert.equal(config.nurseTodayHref(env),'/staff/real/nurse-chat');
for(const route of [today,conversations]){
 for(v2 of [true,false])for(const query of [{},{notice:'access',member:'old',view:'today'}]){
  await assert.rejects(()=>route({searchParams:Promise.resolve(query)}),new RegExp(`^Error: redirect:/staff/real/nurse-chat${v2?'#today':''}$`));
 }
 for(role of ['member','admin','doctor']){
  if(role==='member'||role==='admin'&&route===today)await assert.rejects(()=>route({searchParams:Promise.resolve({})}),/404/);
  else{
   const before=doctorReads,adminBefore=adminChecks;
   const result=await route({searchParams:Promise.resolve({notice:'access',filter:'all'})});
   if(role==='doctor'){
    const html=renderToStaticMarkup(result);
    assert.equal(doctorReads,before+1);
    assert.match(html,route===today?/Only doctors and admins can act on alerts/:/No one is waiting/);
   }else{assert.equal(adminChecks,adminBefore+1);assert.equal(result.props.filter,'all');}
  }
 }
 role='nurse';signedIn=false;
 await assert.rejects(()=>route({searchParams:Promise.resolve({})}),/^Error: redirect:\/staff\/real\/login\?notice=existing$/);
 signedIn=true;
}
role='doctor';telegram=false;
await assert.rejects(()=>conversations({searchParams:Promise.resolve({})}),/404/);
console.log('Canonical nurse Today: both real routes redirect with flags on/off and any query; doctor/admin branches and access notice, member denial and unauthenticated redirect preserved (mocked auth/IO).');

const Navigation=load('components/staff/navigation.tsx').StaffNavigation as React.ComponentType<{real:boolean;admin:boolean;nurse?:boolean;nurseChat?:boolean;telegram?:boolean;adminConversations?:boolean}>;
const nurseNav=renderToStaticMarkup(React.createElement(Navigation,{real:true,admin:false,nurse:true,nurseChat:true}));
assert.match(nurseNav,/href="\/staff\/real\/nurse-chat#today" aria-current="page"/);
assert.doesNotMatch(nurseNav,/href="\/staff\/real\/(today|conversations)"/,'The separate nurse Today entry stays hidden');
const doctorNav=renderToStaticMarkup(React.createElement(Navigation,{real:true,admin:false,telegram:true}));
assert.match(doctorNav,/href="\/staff\/real\/today"/);assert.match(doctorNav,/href="\/staff\/real\/conversations"/);
const adminNav=renderToStaticMarkup(React.createElement(Navigation,{real:true,admin:true,adminConversations:true}));
assert.match(adminNav,/href="\/staff\/real\/conversations"/);
console.log('Canonical nurse navigation: Conversations points directly to #today and stays active, Today stays hidden; doctor/admin destinations preserved (real sidebar render).');
