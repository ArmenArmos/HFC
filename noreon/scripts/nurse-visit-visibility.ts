// Browser regression: node --import ./scripts/register-alias.mjs scripts/nurse-visit-visibility.ts
// Kept separate from the Node-only check runner; requires Playwright Chromium.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium,expect,type Locator} from '@playwright/test';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const source=ts.transpileModule(readFileSync('components/staff/nurse-visit-actions.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const deps:Record<string,unknown>={
 'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'next/navigation':{useRouter:()=>({refresh(){}})},'lucide-react':await import('lucide-react'),
 './bp-high-warning':{BpHighWarning:()=>null},'@/lib/nurse-visit/copy':await import('@/lib/nurse-visit/copy'),'@/lib/nurse-visit/collection':await import('@/lib/nurse-visit/collection'),'@/lib/staff/staff-locale-copy':await import('@/lib/staff/staff-locale-copy'),'@/lib/patient/catalogue-label':await import('@/lib/patient/catalogue-label'),'@/lib/nurse-visit/actions':{recordNurseVisitCollect:async()=>({status:'saved'}),refreshNurseVisit:async()=>null},
 './shell':{fieldClass:'field',buttonClass:'button'},'@/lib/staff/yerevan-time':await import('@/lib/staff/yerevan-time'),'./nurse-visit-timeline':await import('@/components/staff/nurse-visit-timeline'),
 '@/lib/nurse-visit/schema':await import('@/lib/nurse-visit/schema'),'@/lib/locale':await import('@/lib/locale'),
};
const card:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/nurse-chat-v2/sample-collection.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:card,crypto,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
deps['@/components/nurse-chat-v2/sample-collection']=card;
new vm.Script(source).runInNewContext({exports,crypto:globalThis.crypto,Date,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const Component=exports.NurseVisitActions as React.ComponentType<Record<string,unknown>>;
const urgent='Ask about chest pain, severe breathlessness, new neurological symptoms, confusion or sudden worsening of vision. If any is present, get urgent medical help now (call 103). Do not wait for tests or the app.';
const severeBP='If systolic is 180 or higher, or diastolic 110 or higher: have the member rest 5 minutes and measure again. With symptoms, call 103 now. Without symptoms, if the repeat is systolic 180 or higher, or diastolic 120 or higher, contact the assigned doctor today; otherwise the doctor within 48 hours.';
const rest='The member is seated and rested before you measure, and you use the correct technique.';
const fasting='Fasting glucose is ordered: confirm the member has had no food with calories for at least 8 hours.';
const check=(checkId:string,section:string,text:string)=>({kind:'check',key:`check:${checkId}`,checkId,section,version:'protocol-draft-1',label:{en:text,hy:text},source:'Existing protocol',mark:null});
const data={visit:{memberName:'Fictional member',bookingStatus:'confirmed',memberId:'aa110000-0000-4000-8000-000000000001',source:'appointment',id:'aa110000-0000-4000-8000-000000000002',startsAt:'2026-11-01T08:00:00Z'},today:'2026-11-01',items:[
 {kind:'sample',key:'sample:hba1c-glucose',testId:'hba1c-glucose',title:'Fasting glucose',mark:null},
 {kind:'measurement',field:'bp',key:'measure:bp',mark:null},
 check('urgent-symptoms','safety',urgent),check('severe-bp-contact','safety',severeBP),check('bp-seated-rest','bp',rest),check('fasting-8h','sampling',fasting),
],steps:[{step:'confirmed',at:'2026-11-01T07:00:00Z',by:'Fictional nurse'}],completion:null,checklistVersion:'protocol-draft-1'};
// Use the app's CSS and native disclosures: DOM/string checks miss hidden instructions.
const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
const css=await postcss([require('@tailwindcss/postcss')()]).process(readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
const browser=await chromium.launch();
async function visibleBefore(instruction:Locator,action:Locator){
 await expect(instruction).toBeVisible();
 await instruction.scrollIntoViewIfNeeded();
 await expect(instruction).toBeInViewport();
 assert.ok(await instruction.evaluate((node,target)=>Boolean(node.compareDocumentPosition(target as Node)&Node.DOCUMENT_POSITION_FOLLOWING),await action.elementHandle()),'Instruction precedes its action');
}
try{
 for(const width of [390,1440])for(const inline of [true,false])for(const locale of ['en','hy','ru']){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.route('**/*',route=>route.abort());
  const html=renderToStaticMarkup(React.createElement(Component,{data,locale,inline,completeIds:{},mark:async()=>({status:'saved'}),step:async()=>({status:'saved'}),complete:async()=>({status:'saved'})}));
  await page.setContent(`<style>${css.css}</style><main class="mx-auto max-w-3xl p-4">${html}</main>`);
  const safety=page.getByText(urgent,{exact:true}),bpSafety=page.getByText(severeBP,{exact:true});
  const assertSafety=async()=>{
   await visibleBefore(safety,page.locator('#nv-samples'));
   await expect(bpSafety).toBeVisible();
   assert.equal(await safety.evaluate(node=>node.closest('details')!==null),false,'Safety stays outside all disclosures');
  };
  const openSection=async(id:string)=>{
   if(inline&&!await page.locator(`#${id}`).evaluate(node=>(node.parentElement as HTMLDetailsElement).open))await page.locator(`#${id}`).click();
  };
  await assertSafety();
  if(inline){
   assert.equal(await page.locator('details[aria-labelledby^="nv-"]').count(),4);
   assert.equal(await page.locator('details[aria-labelledby^="nv-"][open]').count(),1);
  }
  // Change away and back before each recording action, including reopening an editor.
  for(const id of ['nv-measures','nv-devices','nv-samples','nv-steps','nv-measures','nv-samples']){
   await openSection(id);
   await assertSafety();
   if(id!=='nv-samples'&&id!=='nv-measures')continue;
   const item=page.locator('li[aria-labelledby="nv-measure-bp-title"]');
   if(id==='nv-measures'){
    const editor=item.locator('details');
    if(!await editor.evaluate(node=>(node as HTMLDetailsElement).open))await editor.locator('summary').click();
   }
   const action=id==='nv-samples'?page.locator('[data-sample-collection] .ncv2-sample-confirm'):item.locator('button').filter({has:page.locator('svg.lucide-check')});
   await expect(action).toBeVisible();
   await visibleBefore(page.getByText(id==='nv-samples'?fasting:rest,{exact:true}),action);
  }
  await openSection('nv-samples');
  const confirm=page.locator('[data-sample-collection] .ncv2-sample-confirm');
  await expect(confirm).toBeEnabled();
  assert.ok((await confirm.boundingBox())!.height>=44,'Collection keeps a 44 px target outside the chat stylesheet');
  const confirmation=page.getByRole('button',{name:({en:'I confirmed the visit with the member',hy:'Ես հաստատել եմ այցը անդամի հետ',ru:'Подтверждено с участником'} as Record<string,string>)[locale],exact:true});
  assert.equal(await confirmation.count(),0,'Saved confirmation is shown in the timeline');
  const unconfirmed=renderToStaticMarkup(React.createElement(Component,{data:{...data,steps:[]},locale,inline,completeIds:{},mark:async()=>({status:'saved'}),step:async()=>({status:'saved'}),complete:async()=>({status:'saved'})}));
  await page.setContent(`<style>${css.css}</style><main class="mx-auto max-w-3xl p-4">${unconfirmed}</main>`);
  await openSection('nv-samples');
  await expect(page.locator('[data-sample-collection] .ncv2-sample-confirm')).toBeDisabled();
  await expect(page.getByText(({en:'Confirm the visit with the member first.',hy:'Նախ հաստատեք այցը անդամի հետ։',ru:'Сначала подтвердите визит с участником.'} as Record<string,string>)[locale],{exact:true})).toBeVisible();
  assert.equal(await page.locator('[data-sample-collection] button:not([disabled])').count(),0);
  assert.equal(await page.locator('li[aria-labelledby="nv-sample-hba1c-glucose-title"]').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'No horizontal overflow');
  if(locale==='en')await page.screenshot({path:`/tmp/sample-collection-${width}-${inline?'inline':'standalone'}.png`,fullPage:true});
  await page.close();
 }
 console.log('Visit disclosures: visible safety/103 above sample and measurement actions and preparation before sample/BP recording, after section changes, at 390/1440px in inline/standalone en/hy/ru renders (synthetic data).');
}finally{await browser.close();}
