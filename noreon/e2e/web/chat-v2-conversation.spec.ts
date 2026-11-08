import {test,expect,type Page} from '@playwright/test';
import {startChatFixture} from '../chat-v2/server.mjs';
import {URGENT_TEXT} from '../../lib/zoe/symptoms/intake';
let fixture:Awaited<ReturnType<typeof startChatFixture>>;
let transcript='Hello Zoe',urgent=false;let sends:Array<{text:string;voiceReceipt?:string}>=[],speech:string[]=[];
test.beforeAll(async()=>{fixture=await startChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{
 transcript='Hello Zoe';urgent=false;sends=[];speech=[];
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname!=='127.0.0.1'){await route.abort();return;}
  if(url.pathname==='/api/patient/zoe/voice'){await route.fulfill({json:{status:'ok',text:transcript,receipt:'synthetic-voice-receipt',urgent}});return;}
  if(url.pathname==='/api/patient/zoe/speech'){speech.push(JSON.parse(request.postData()!).text);await route.fulfill({json:{status:'ok',audioBase64:'YXVkaW8=',mime:'audio/mp3'}});return;}
  if(url.pathname==='/fixture/send')sends.push(JSON.parse(request.postData()!));
  if(url.pathname==='/api/patient/zoe/thread'){
   const response=fixture.respond(request.url(),request.method(),request.postData()??'');
   const thread=JSON.parse(response.body);if(sends.length&&!urgent)thread.answers=[{id:'10000000-0000-4000-8000-000000000001',text:'Here is Zoe’s reply.',at:new Date().toISOString()}];
   await route.fulfill({json:thread});return;
  }
  await route.fulfill(fixture.respond(request.url(),request.method(),request.postData()??''));
 });
 await page.addInitScript(()=>{
  const w=window as unknown as {level:number;plays:number;pauses:number;stops:number};w.level=0;w.plays=0;w.pauses=0;w.stops=0;
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>w.stops++}]})}});
  class Recorder{static isTypeSupported(type:string){return type==='audio/mp4';}state='inactive';mimeType='audio/mp4';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;start(){this.state='recording';}stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic'])});this.onstop?.();});}}
  class Context{resume(){return Promise.resolve();}close(){return Promise.resolve();}createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:(data:Float32Array)=>data.fill(w.level)};}createMediaStreamSource(){return {connect(){}};}}
  class Player{onended:(()=>void)|null=null;onerror:(()=>void)|null=null;play(){w.plays++;return Promise.resolve();}pause(){w.pauses++;}removeAttribute(){}load(){}}
  Object.defineProperty(window,'MediaRecorder',{value:Recorder});Object.defineProperty(window,'AudioContext',{value:Context});Object.defineProperty(window,'Audio',{value:Player});
 });
});
const turn=async(page:Page)=>{await page.evaluate(()=>(window as unknown as {level:number}).level=.15);await page.waitForTimeout(400);await page.evaluate(()=>(window as unknown as {level:number}).level=0);};
const start=async(page:Page)=>{await page.goto(fixture.url+'/patient/chat?empty&v3&voice&conversation');await page.getByRole('button',{name:'Start voice conversation',exact:true}).click();await expect(page.getByText('Listening. Pause when you finish.',{exact:true})).toBeVisible();};
test('editable countdown, normal send/reply, barge-in and narrow composer',async({page},info)=>{
 await start(page);await turn(page);await expect(page.getByRole('textbox')).toHaveValue('Hello Zoe');await page.getByRole('textbox').fill('Edited hello');await page.waitForTimeout(3300);expect(sends).toHaveLength(0);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect.poll(()=>sends.length).toBe(1);expect(sends[0].voiceReceipt).toBe('synthetic-voice-receipt');
 await expect.poll(()=>speech.length,{timeout:15000}).toBe(1);expect(speech[0]).toBe('Here is Zoe’s reply.');
 await expect(page.getByText('Zoe is speaking.',{exact:true})).toBeVisible();await page.evaluate(()=>(window as unknown as {level:number}).level=.15);await expect(page.getByText('Listening. Pause when you finish.',{exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as unknown as {pauses:number}).pauses)).toBeGreaterThan(0);
 await page.evaluate(()=>(window as unknown as {level:number}).level=0);await page.getByRole('button',{name:'End voice conversation',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const box=await page.getByRole('textbox').boundingBox();expect(box!.width).toBeGreaterThan(40);
 await page.screenshot({path:`/tmp/noreon-conversation-${info.project.name}.png`,fullPage:true});
});
test('countdown sends and hidden cancels the next pending send',async({page})=>{
 await start(page);await turn(page);await expect.poll(()=>sends.length,{timeout:10000}).toBe(1);await expect.poll(()=>speech.length,{timeout:15000}).toBe(1);
 await page.getByRole('button',{name:'End voice conversation',exact:true}).click();await page.getByRole('button',{name:'Start voice conversation',exact:true}).click();await turn(page);await expect(page.getByRole('textbox')).toHaveValue('Hello Zoe');
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.waitForTimeout(3300);expect(sends).toHaveLength(1);await expect(page.getByRole('button',{name:'Start voice conversation',exact:true})).toBeVisible();
});
test('urgent sends immediately and speaks only the shared fixed103 template',async({page})=>{
 transcript='I have chest pain right now';urgent=true;await start(page);await turn(page);await expect.poll(()=>sends.length,{timeout:4000}).toBe(1);await expect.poll(()=>speech.length).toBe(1);expect(speech).toEqual([URGENT_TEXT.en]);await expect(page.locator('[data-zoe-emergency-card]').first()).toBeVisible();
});
test('fresh send failure ends conversation and preserves failed-message UI',async({page})=>{
 transcript='offline';await start(page);await turn(page);await expect.poll(()=>sends.length,{timeout:10000}).toBe(1);await expect(page.getByText('Voice conversation stopped. You can type your message.',{exact:true})).toBeVisible();await expect(page.getByText('Not sent.',{exact:true})).toBeVisible();expect(speech).toEqual([]);
});
