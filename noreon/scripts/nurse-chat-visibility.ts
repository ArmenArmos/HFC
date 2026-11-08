// Local browser regression using the real page/components with synthetic read ports.
// No Next server, environment files, authentication or database is used.
// node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/nurse-chat-visibility.ts
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium,expect} from '@playwright/test';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

const require=createRequire(import.meta.url);
const id=(n:number)=>`aa110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const urgent='Ask about chest pain, severe breathlessness, new neurological symptoms, confusion or sudden worsening of vision. If any is present, get urgent medical help now (call 103). Do not wait for tests or the app.';
const severeBP='If systolic is 180 or higher, or diastolic 110 or higher: have the member rest 5 minutes and measure again. With symptoms, call 103 now. Without symptoms, if the repeat is systolic 180 or higher, or diastolic 120 or higher, contact the assigned doctor today; otherwise the doctor within 48 hours.';
const at='2026-11-01T08:00:00Z';
const visit={memberId:id(1),source:'appointment',id:id(2),memberName:'Fictional member',startsAt:at,endsAt:null,mode:'home',location:null,bookingStatus:'confirmed',completion:null,samplesPlanned:0,samplesTaken:0,openItems:1,steps:[],nurseName:'Fictional nurse'};
const check=(checkId:string,text:string)=>({kind:'check',key:`check:${checkId}`,checkId,section:'safety',version:'protocol-draft-1',label:{en:text,hy:text},source:'Existing protocol',mark:null});
const visitRow=Object.fromEntries(Object.entries(visit).filter(([key])=>!['samplesPlanned','samplesTaken','openItems','steps','nurseName'].includes(key)));
const detail={version:'nurse-visit-v1',enabled:true,today:'2026-11-01',visit:visitRow,items:[{kind:'measurement',field:'bp',key:'measure:bp',mark:null},check('urgent-symptoms',urgent),check('severe-bp-contact',severeBP)],counts:{samplesPlanned:0,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]},steps:[],completion:null,checklistVersion:'protocol-draft-1',caseRevision:0};
(await import('@/lib/nurse-visit/schema')).nurseVisitDetailSchema.parse(detail);
const today={ok:true,page:{tasks:[],nextCursor:null},visits:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[visit]},asOf:at};
const conversation={ok:true,memberId:id(1),memberName:'Fictional member',doctorName:'Fictional doctor',version:1,canSend:true,items:Array.from({length:12},(_,i)=>({id:`m${i}`,text:'Synthetic conversation text for scrolling.',at,senderName:'Fictional member',senderRole:'member'}))};
let locale:StaffLocale='en',cardState='ready';
const noWrite=async()=>{throw Error('Browser visibility checks must not write');};
const rpc={rpc:async(name:string)=>({error:null,data:name==='nurse_visit_detail'?detail:today.visits})};
const modules:Record<string,unknown>={
 react:React,'react-dom':require('react-dom'),'react/jsx-runtime':require('react/jsx-runtime'),
 'next/link':{default:({href,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',{href,...props})},
 'next/navigation':{usePathname:()=>'/staff/real/nurse-chat',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({refresh(){}}),notFound:()=>{throw Error('Not found');},unstable_rethrow:()=>{}},
 'lucide-react':await import('lucide-react'),zod:await import('zod'),
 'server-only':{},
 'class-variance-authority':await import('class-variance-authority'),clsx:await import('clsx'),'tailwind-merge':await import('tailwind-merge'),
 '@base-ui/react/select':await import('@base-ui/react/select'),'@base-ui/react/combobox':await import('@base-ui/react/combobox'),'@base-ui/react/button':await import('@base-ui/react/button'),
 '@/lib/nurse-visit/runtime':await import('@/lib/nurse-visit/runtime'),
 '@/lib/staff/nurse-actions':{staffCareCommand:noWrite,realStaffCareCommand:noWrite,refreshRealCareTasks:noWrite},
 'components/staff/shell.tsx':{buttonClass:'dw-pill',fieldClass:'dw-input'},
 '@/lib/staff/real-staff-render':{requireRealStaffForRender:async()=>({client:rpc,identity:{id:id(3),role:'nurse',name:'Fictional nurse'},actorScope:'fixture'})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>locale},
 '@/lib/staff/member-search-command':{runMemberIdentitySearch:async()=>({ok:true,page:{rows:[],hasMore:false}})},
 '@/lib/nurse-chat/config':{nurseChatEnabled:()=>true,nurseChatNewScreen:()=>false},
 '@/components/nurse-chat-v2/nurse-chat':{NurseChatV2:()=>null},
 '@/lib/nurse-chat/actions':{readNurseConversation:async()=>conversation,sendNurseReply:noWrite},
 '@/lib/nurse-chat/handoff-actions':{readNurseHandoffs:async()=>null,escalateNurseMessage:noWrite},
 '@/lib/nurse-chat/today-actions':{readNurseToday:async()=>today},
 '@/lib/nurse-visit/actions':{recordNurseVisitMark:noWrite,recordNurseVisitStep:noWrite,recordNurseVisitComplete:noWrite},
 '@/lib/staff/visit-evidence-actions':{recordRealVisitEvidence:noWrite,refreshRealVisitEvidence:noWrite},
 '@/lib/nurse-chat/member-card-actions':{readNurseMemberCard:async(_member:string,card:string)=>cardState==='unavailable'?{kind:'unavailable'}:card==='context'?{kind:'ready',card,cards:[{tool:'overview',state:'none',facts:[],quotes:[],missing:[]}]}:card==='notes'?{kind:'ready',card,revision:0,notes:[]}:card==='samples'?{kind:'ready',card,visits:[],data:{memberId:id(1),samples:[]}}:{kind:'ready',card,data:cardState==='off'?{enabled:false}:cardState==='missing'?null:{enabled:true,weeks:[]},asOf:at}},
 '@/lib/staff/lab-stage-actions':{recordRealLabStage:noWrite},
 '@/lib/staff/real-coordination/actions':{coordinationCommand:noWrite,readCoordinationPage:noWrite,refreshCoordinationTask:noWrite},
 '@/lib/staff/real-member-search-actions':{searchRealMembers:noWrite},
 '@/lib/staff-zoe/actions':{openStaffZoe:noWrite},
 '@/lib/bp-week/actions':{staffStartBpWeek:noWrite,staffStopBpWeek:noWrite},
};
// Load actual layout and UI modules, replacing only server I/O. Fail on unexpected I/O.
function load(path:string):Record<string,unknown>{
 if(path.endsWith('.css'))return {};
 if(path in modules)return modules[path] as Record<string,unknown>;
 const output:Record<string,unknown>={};modules[path]=output;
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const localRequire=(name:string):unknown=>{
  if(name in modules)return modules[name];
  if(name.startsWith('@base-ui/react/'))return require(name);
  if(name.startsWith('@/')||name.startsWith('.')){
   const base=name.startsWith('@/')?name.slice(2):`${path.slice(0,path.lastIndexOf('/')+1)}${name}`;
   const file=[base,`${base}.ts`,`${base}.tsx`].find(existsSync);assert.ok(file,`Missing module: ${name}`);
   const resolved=require.resolve(`${process.cwd()}/${file}`);
   assert.ok(!resolved.includes('/lib/db/')&&!resolved.includes('/lib/observability/'),`Unexpected server dependency: ${name}`);
   return load(resolved.slice(process.cwd().length+1));
  }
  throw Error(`Unexpected dependency: ${name} in ${path}`);
 };
 vm.runInNewContext(code,{exports:output,require:localRequire,crypto,Date,URLSearchParams,console},{filename:path});
 return output;
}
const pageModule=load('app/staff/real/(review)/nurse-chat/page.tsx');
const Page=pageModule.default as (props:{searchParams:Promise<Record<string,string>>})=>Promise<React.ReactNode>;
const Shell=load('components/staff/nurse-chat-shell.tsx').NurseChatShell as typeof import('@/components/staff/nurse-chat-shell').NurseChatShell;
// Resolve server components as Next does, leaving client components for React SSR.
async function resolve(node:React.ReactNode):Promise<React.ReactNode>{
 if(Array.isArray(node))return Promise.all(React.Children.toArray(node).map(resolve));
 if(!React.isValidElement<{children?:React.ReactNode}>(node))return node;
 if(typeof node.type==='function'&&node.type.constructor.name==='AsyncFunction'){
  const rendered=await resolve(await (node.type as (props:unknown)=>Promise<React.ReactNode>)(node.props));
  return React.isValidElement(rendered)?React.cloneElement(rendered,{key:node.key}):rendered;
 }
 return React.cloneElement(node,{},await resolve(node.props.children));
}
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const css=await postcss([require('@tailwindcss/postcss')()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
const styles=css.css+readFileSync('app/staff/real/(review)/doctor-workspace/workspace.css','utf8')+readFileSync('app/staff/real/(review)/nurse-chat/nurse-chat.css','utf8');
// Reuse the already generated app fonts, offline. Never start Next (it reads .env).
const fontDir='.next/dev/static/chunks';
const fonts=existsSync(fontDir)?readdirSync(fontDir).filter(file=>/^\[next\]_internal_font_google_(inter|manrope|noto_sans_armenian)_.*\.css$/.test(file)).map(file=>readFileSync(`${fontDir}/${file}`,'utf8').replace(/url\("\.\.\/media\/([^"]+)"\)/g,(_match,name:string)=>`url("data:font/woff2;base64,${readFileSync(`.next/dev/static/media/${name}`).toString('base64')}")`)).join(''):'';
async function render(url:URL){
  locale=(url.searchParams.get('locale')??locale) as StaffLocale;cardState=url.searchParams.get('state')??'ready';
  const tree=await resolve(await Page({searchParams:Promise.resolve(Object.fromEntries(url.searchParams))}));
  const shell=React.createElement(Shell,{locale,nav:React.createElement('nav',null,'Synthetic staff navigation'),actions:null,fallback:null},tree);
  return `<!doctype html><html lang="${locale}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}${fonts}:root{--font-inter:Inter;--font-manrope:Manrope;--font-armenian:'Noto Sans Armenian'}</style><body>${renderToStaticMarkup(shell)}</body></html>`;
}
const origin='http://nurse-visibility.test';
if(process.argv.includes('--fixtures')){
 const folder='/tmp/noreon-nurse-visibility';mkdirSync(folder,{recursive:true});
 for(const language of ['en','hy','ru']){
  const landing=await render(new URL(`${origin}?locale=${language}`));
  const headings=landing.match(/<h[12][^>]*>Your work today<\/h[12]>/g)??[];
  if(language==='en')assert.equal(headings.length,0,'Landing keeps work lists in Menu');
  assert.ok(landing.includes('id="nurse-workspace-input"'),'Landing retains its composer');
  assert.equal(landing.includes('data-visit-link='),false,'Landing does not render the visit queue');
  writeFileSync(`${folder}/landing-${language}.html`,landing);
  for(const card of ['visits','context','notes','samples','week','conversation']){
   const html=await render(new URL(`${origin}?member=${id(1)}&source=appointment&visit=${id(2)}&card=${card}&locale=${language}`));
   if(card==='visits'){
    assert.equal(html.includes('role="log"'),false,'Visit remains outside the auto-scrolling conversation');
    assert.equal(html.includes('id="nurse-reply"'),false,'Visit has no covering reply dock');
    assert.ok(html.includes('card=conversation'),'Visit can return to the conversation card');
   }
   assert.ok(html.includes('data-nurse-urgent-line'),`Urgent line on ${card}`);
   assert.ok(html.includes('id="nurse-urgent-guidance"'),`Guidance target on ${card}`);
   // Pin the copied clinical text to the existing approved protocol, including its BP wording.
   const protocol=readFileSync('supabase/migrations/20261018170600_nurse_visit_flow.sql','utf8');
   for(const checkId of ['urgent-symptoms','severe-bp-contact']){
    const row=protocol.split('\n').find(line=>line.includes(`'${checkId}'`))!;
    const copy=row.match(/null,'([^']*)','([^']*)'/);assert.ok(copy);
    assert.ok(html.includes(copy[language==='en'?1:2]),`${checkId} keeps the protocol wording`);
   }
   writeFileSync(`${folder}/${card}-${language}.html`,html.replace(/href="\/staff\/real\/nurse-chat(?:\?([^"]*))?"/g,(_match,query:string)=>{
    const params=new URLSearchParams((query??'').replaceAll('&amp;','&'));
    return `href="${params.has('member')?params.get('card')??'visits':'landing'}-${language}.html"`;
   }));
  }
 }
 for(const state of ['off','missing','unavailable']){
  const html=await render(new URL(`${origin}?member=${id(1)}&card=week&state=${state}`));
  assert.ok(html.includes('data-nurse-urgent-line')&&html.includes('id="nurse-urgent-guidance"'),`Guidance survives ${state} BP card`);
 }
 for(const width of [390,1440])writeFileSync(`${folder}/${width}.html`,`<!doctype html><html><body style="margin:0"><iframe title="Nurse workspace at ${width}px" src="visits-en.html" style="width:${width}px;height:700px;border:0"></iframe></body></html>`);
 writeFileSync(`${folder}/390-hy.html`,'<!doctype html><html><body style="margin:0"><iframe title="Armenian nurse workspace at 390px" src="visits-hy.html" style="width:390px;height:700px;border:0"></iframe></body></html>');
 console.log(`Markup checks passed; real page fixtures at ${folder}/390.html and 1440.html. Browser visibility still requires opening them.`);
}else{
const browser=await chromium.launch();
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:700}});
  await page.route('**/*',async route=>route.fulfill({contentType:'text/html',body:await render(new URL(route.request().url()))}));
  await page.goto(origin);
  await expect(page.getByRole('heading',{name:'Your work today',exact:true})).toHaveCount(0);
  await expect(page.locator('#nurse-workspace-input')).toBeInViewport();
  await expect(page.locator('[data-visit-link]')).toHaveCount(0);
  await expect(page.locator('.nurse-landing-space a')).toHaveCount(1);
  await page.locator('[data-nurse-chat-shell] > header summary').click();
  await page.locator('[data-nurse-chat-shell] > header a[href$="view=visits"]').click();
  await expect(page.locator('[data-visit-link]')).toHaveCount(1);
  await page.locator('[data-visit-link]').click();
  await expect(page.locator('#nurse-reply')).toHaveCount(0);
  await expect(page.getByRole('log')).toHaveCount(0);
  for(const language of ['en','hy','ru']){
   await page.goto(`${origin}/staff/real/nurse-chat?member=${id(1)}&source=appointment&visit=${id(2)}&locale=${language}`);
   const line=page.locator('[data-nurse-urgent-line]');
   const assertPinned=async()=>{
    await expect(line).toBeInViewport({ratio:1});
    const box=await line.boundingBox();assert.ok(box&&box.height<=58,'Urgent line stays within two lines at 390px');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow');
   };
   await assertPinned();
   assert.equal(await page.locator('main').evaluate(node=>node.scrollTop),0,'A selected visit opens at the top');
   await expect(page.getByRole('link',{name:language==='en'?'Back to conversation':language==='hy'?'Վերադառնալ զրույցին':'Вернуться к разговору'})).toHaveAttribute('href',/card=conversation/);
   // Every checklist section, including the previously failing change after opening.
   for(const section of ['nv-steps','nv-samples','nv-measures','nv-devices']){
    await page.locator(`#${section}`).click();
    await assertPinned();
   }
   // Follow the real card links, retaining the selected visit.
   for(const card of ['context','notes','samples','week','conversation','visits']){
    await page.locator(`nav a[href*="card=${card}"]`).click();
    await expect(page.locator('nav a[aria-current="page"]')).toHaveAttribute('href',new RegExp(`card=${card}`));
    await assertPinned();
    if(card==='visits'){
     await expect(page.locator('#nurse-reply')).toHaveCount(0);
     await expect(page.getByRole('log')).toHaveCount(0);
    }else{
    const compose=page.locator('details:has(#nurse-reply)');
    if(!await compose.evaluate(node=>(node as HTMLDetailsElement).open))await compose.locator('summary').click();
    await page.locator('#nurse-reply').scrollIntoViewIfNeeded();
    await assertPinned();
    const composer=await page.locator('#nurse-reply').boundingBox(),banner=await line.boundingBox();
    assert.ok(composer&&banner&&composer.y>=banner.y+banner.height,'Pinned line does not cover the composer');
    }
    await line.locator('a').click();
    await expect(page.locator('#nurse-urgent-guidance')).toBeInViewport();
    await expect(page.locator('#nurse-urgent-guidance')).toContainText(language==='en'?urgent:'Մի սպասեք հետազոտություններին կամ հավելվածին։');
    await assertPinned();
   }
  }
  for(const state of ['off','missing','unavailable']){
   await page.goto(`${origin}?member=${id(1)}&source=appointment&visit=${id(2)}&card=week&state=${state}`);
   await expect(page.locator('[data-nurse-urgent-line]')).toBeInViewport({ratio:1});
  }
  await page.screenshot({path:`/tmp/noreon-nurse-chat-${width}.png`,fullPage:true});
  await page.close();
 }
 console.log('Nurse page browser checks passed: empty landing, one next step, Menu visits and top-of-visit entry; urgent line initially visible, two lines maximum, sticky after checklist/card changes, full guidance one tap away, composer unobscured, BP empty/off/unavailable at 390/1440px (en/hy/ru; actual components, synthetic reads).');
}finally{await browser.close();}
}
