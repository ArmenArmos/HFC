import {test,expect,type Page} from '@playwright/test';
import {startChatFixture} from '../chat-v2/server.mjs';
let fixture:Awaited<ReturnType<typeof startChatFixture>>;
test.use({viewport:{width:402,height:714},isMobile:true,hasTouch:true});
test.beforeAll(async()=>{fixture=await startChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??'')));
  await page.addInitScript(()=>{
    const w=window as unknown as {recordRequests:number;stops:number;spoken:string[];cancelled:number;voiceList:SpeechSynthesisVoice[]};
    w.recordRequests=0;w.stops=0;w.spoken=[];w.cancelled=0;
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{w.recordRequests++;return {getTracks:()=>[{stop:()=>w.stops++}]};}}});
    class Recorder {
      static isTypeSupported(type:string){return type==='audio/mp4';}
      mimeType='audio/mp4';state='inactive';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
      start(){this.state='recording';}
      stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic audio'],{type:this.mimeType})});this.onstop?.();}
    }
    Object.defineProperty(window,'MediaRecorder',{value:Recorder});
    w.voiceList=[{lang:'en-GB',localService:true} as SpeechSynthesisVoice];
    Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>w.voiceList,addEventListener:()=>{},removeEventListener:()=>{},cancel:()=>w.cancelled++,speak:(u:SpeechSynthesisUtterance)=>w.spoken.push(u.text)}});
  });
});
const record=async(page:Page,cancel=false)=>{
  const mic=page.getByRole('button',{name:'Hold to record',exact:true});
  const box=(await mic.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect(page.getByRole('button',{name:'Release to review',exact:true})).toBeVisible();
  await page.waitForTimeout(50);
  if(cancel)await page.mouse.move(box.x-100,box.y);
  await page.mouse.up();
};
test('off and unconfigured never expose or request the microphone',async({page})=>{
  for(const query of ['?empty&voice','?empty&v3']){
    await page.goto(fixture.url+'/patient/chat'+query);
    await expect(page.getByRole('textbox')).toBeVisible();
    await expect(page.getByRole('button',{name:'Hold to record',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>(window as unknown as {recordRequests:number}).recordRequests)).toBe(0);
    if(!query.includes('v3'))await expect(page.getByRole('button',{name:'Listen to this message',exact:true})).toHaveCount(0);
  }
});
test('transcription stays editable and unsaved; Send opens the existing reading card',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&voice');
  await record(page);
  await expect(page.getByRole('textbox')).toHaveValue('145/92');
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).measurements).toEqual([]);
  await expect(page.locator('.cv2-me')).toHaveCount(0);
  expect(await page.evaluate(()=>Object.values(sessionStorage).join(' '))).not.toContain('145/92');
  await page.getByRole('textbox').fill('146/93');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-zoe-card="bp"]')).toBeVisible();
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).opens.at(-1).voiceConfirmed).toBeUndefined();
  await expect(page.locator('[data-zoe-card="bp"] [aria-label="From your recording"]')).toHaveCount(0);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).measurements).toEqual([]);
  await page.getByRole('button',{name:'Save reading',exact:true}).click();
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).measurements.length).toBe(1);
  await expect(page.locator('[data-zoe-bp-saved]')).toBeVisible();
});
test('unchanged transcript recovers voice provenance from the stored message',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&voice');
  await record(page);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-zoe-card="bp"] [aria-label="From your recording"]')).toBeVisible();
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).opens.at(-1).voiceConfirmed).toBeUndefined();
});
test('slide cancels and stops tracks without transcription',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&voice');await record(page,true);
  await expect(page.getByRole('textbox')).toHaveValue('');
  expect(await page.evaluate(()=>(window as unknown as {stops:number}).stops)).toBeGreaterThan(0);
});
test('speaker requires a local voice for the language, never autoplays and stops on leave',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&locale=hy');
  await expect(page.getByRole('button',{name:/Listen|Լսել|Прослушать/})).toHaveCount(0);
  await page.goto(fixture.url+'/patient/chat?empty&v3');
  const speaker=page.getByRole('button',{name:'Listen to this message',exact:true});
  await expect(speaker).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken)).toEqual([]);
  await speaker.click();
  expect(await page.evaluate(()=>(window as unknown as {spoken:string[]}).spoken.length)).toBe(1);
  const before=await page.evaluate(()=>(window as unknown as {cancelled:number}).cancelled);
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  expect(await page.evaluate(()=>(window as unknown as {cancelled:number}).cancelled)).toBeGreaterThan(before);
});
