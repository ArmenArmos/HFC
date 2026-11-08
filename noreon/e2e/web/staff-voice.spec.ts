import {test,expect} from '@playwright/test';
import {startNurseChatFixture} from '../nurse-chat-v2/server.mjs';
import {startDoctorChatFixture} from '../doctor-chat-v2/server.mjs';
let nurse:Awaited<ReturnType<typeof startNurseChatFixture>>,doctor:Awaited<ReturnType<typeof startDoctorChatFixture>>;
const labels={en:['Start voice conversation','End voice conversation'],hy:['Սկսել ձայնային զրույցը','Ավարտել ձայնային զրույցը'],ru:['Начать голосовой разговор','Завершить голосовой разговор']};
test.beforeAll(async()=>{nurse=await startNurseChatFixture();doctor=await startDoctorChatFixture();});
test.afterAll(async()=>{await nurse?.close();await doctor?.close();});
let voiceRequests=0;
test.beforeEach(async({page})=>{
 voiceRequests=0;
 await page.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/api/staff/zoe/voice'){voiceRequests++;return route.fulfill({json:{status:'ok',text:'Synthetic dictated question',receipt:'synthetic-receipt'}});}
  if(url.pathname==='/api/staff/zoe/speech')return route.fulfill({json:{status:'ok',audioBase64:'YXVkaW8=',mime:'audio/wav'}});
  const f=page.url().includes('nurse-chat-v2')||url.pathname.includes('nurse-chat-v2')?nurse:doctor;
  return route.fulfill(await f.respond(r.url(),r.method(),r.postData()??''));
 });
 await page.addInitScript(()=>{
  const w=window as unknown as {level:number;captures:number;stops:number;deny:boolean};w.level=0;w.captures=0;w.stops=0;w.deny=false;
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{w.captures++;if(w.deny)throw Error('Synthetic denied');return {getTracks:()=>[{stop:()=>w.stops++}]};}}});
  class Recorder{static isTypeSupported(type:string){return type==='audio/mp4';}state='inactive';mimeType='audio/mp4';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic'])});this.onstop?.();});}}
  class Context{resume(){return Promise.resolve();}close(){return Promise.resolve();}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:(data:Float32Array)=>data.fill(w.level)};}createMediaStreamSource(){return {connect(){}};}}
  class Player{onended:(()=>void)|null=null;onerror:(()=>void)|null=null;play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}}
  Object.defineProperty(window,'MediaRecorder',{value:Recorder});Object.defineProperty(window,'AudioContext',{value:Context});Object.defineProperty(window,'Audio',{value:Player});
 });
});
for(const screen of ['nurse','doctor','patient'] as const)for(const locale of ['en','hy','ru'] as const)test(`${screen}: ${locale} voice toggle, permission and text fallback`,async({page},info)=>{
 const path=screen==='nurse'?'/staff/real/nurse-chat-v2':'/staff/real/doctor-chat-v2';
 await page.goto('http://127.0.0.1'+path+`?voice&locale=${locale}${screen==='patient'?'&patient':''}`);
 const toggle=page.getByRole('button',{name:labels[locale][0],exact:true}),composer=page.locator('footer textarea');
 await expect(toggle).toBeVisible();await expect(composer).toBeVisible();await expect(toggle).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>(window as unknown as {captures:number}).captures)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(locale==='en')await page.screenshot({path:`/private/tmp/staff-voice-${screen}-${info.project.name}-idle.png`,fullPage:true});
 await toggle.click();await expect(page.getByRole('button',{name:labels[locale][1],exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {captures:number}).captures)).toBe(1);
 if(locale==='en'){
  await page.evaluate(()=>(window as unknown as {level:number}).level=.15);await page.waitForTimeout(400);await page.evaluate(()=>(window as unknown as {level:number}).level=0);
  await expect(composer).toHaveValue('Synthetic dictated question');expect(voiceRequests).toBe(1);
  // Editing interrupts the real countdown so no fixture action is submitted implicitly.
  await composer.fill('Edited typed question');
  await expect(composer).toHaveValue('Edited typed question');
  await page.screenshot({path:`/private/tmp/staff-voice-${screen}-${info.project.name}-edited.png`,fullPage:true});
 }
 await page.getByRole('button',{name:labels[locale][1],exact:true}).click();
 await composer.fill('');await page.evaluate(()=>(window as unknown as {deny:boolean}).deny=true);
 await page.getByRole('button',{name:labels[locale][0],exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();await composer.fill('Typing still works');await expect(composer).toHaveValue('Typing still works');
});
test('production rendered reply excludes hidden identity and closed details',async({page})=>{
 await page.goto('http://127.0.0.1/staff/real/doctor-chat-v2?voice');await expect(page.locator('footer textarea')).toBeVisible();
 const result=await page.evaluate(()=>{
  const root=document.createElement('div');root.innerHTML='<article data-message-key="reply"><p>Mariam Example</p><p>Shown reply</p><span hidden>Hidden secret</span><span style="display:none">Display secret</span><span style="visibility:hidden">Visibility secret</span><span aria-hidden="true">Aria secret</span><span class="sr-only">Screen reader secret</span><span data-member-identity>Phone 1234 DOB 1986-01-01</span><span class="member-identity">Identity secret</span><details><summary>Shown summary</summary><p>Closed secret</p></details><details open><summary>Open summary</summary><p>Open detail</p></details><button>Button secret</button></article>';document.body.append(root);
  const read=(window as unknown as {renderedStaffReply:(r:HTMLElement,k:string)=>string}).renderedStaffReply;
  return {text:read(root,'reply'),missing:read(root,'missing')};
 });
 expect(result).toEqual({text:'Mariam Example Shown reply Shown summary Open summary Open detail',missing:''});
});
