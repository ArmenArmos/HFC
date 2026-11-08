/** Focused, offline rendered journey using real components/styles and synthetic IO. */
import assert from 'node:assert/strict';
import {webkit,chromium,type Browser} from '@playwright/test';
import {startDoctorChatFixture} from '../e2e/doctor-chat-v2/server.mjs';
const fixture=await startDoctorChatFixture();
const chromiumMode=process.argv.includes('--chromium');
let browser:Browser|undefined;
try{
 browser=await (chromiumMode?chromium:webkit).launch();
 for(const size of [{width:402,height:714},{width:1280,height:800}]){
  const page=await browser.newPage({viewport:size,isMobile:size.width<500,hasTouch:size.width<500});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fulfill(await fixture.respond(route.request().url())):route.abort());
  await page.goto(fixture.url+'/staff/real/doctor-chat-v2?history');
  const field=page.getByRole('textbox');
  const send=async(text:string)=>{await field.fill(text);await page.locator('.cv2-composer button').click();};
  await send('hand over to the nurse: Call tomorrow');
  await page.getByText('Open the member first',{exact:true}).waitFor();
  await send('Find Mariam');await page.locator('[data-conversation-member]').waitFor();
  await send('hand over to the nurse: Call tomorrow.\nKeep THIS wording.');
  const cards=page.locator('[data-doctor-handover]');
  await cards.last().getByText('Nurse Example',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>((window as unknown as {fixture:{handovers?:unknown[]}}).fixture.handovers??[]).length),0);
  await page.screenshot({path:`/tmp/noreon-doctor-handover-${size.width}.png`});
  assert.ok(await cards.last().getByRole('button',{name:'Send',exact:true}).isVisible());
  await cards.last().getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>((window as unknown as {fixture:{handovers?:unknown[]}}).fixture.handovers??[]).length),0);
  await send('hand over to the nurse: Keep this note');
  await page.evaluate(()=>{(window as unknown as {fixture:{handoverFail:boolean}}).fixture.handoverFail=true;});
  await cards.last().getByRole('button',{name:'Send',exact:true}).click();
  await cards.last().getByRole('alert').waitFor();assert.match(await cards.last().innerText(),/Keep this note/);
  await page.evaluate(()=>{(window as unknown as {fixture:{handoverFail:boolean}}).fixture.handoverFail=false;});
  await cards.last().getByRole('button',{name:'Check or retry this handover',exact:true}).click();
  await cards.last().getByText('Sent to Nurse Example',{exact:true}).waitFor();
  const commands=await page.evaluate(()=>(window as unknown as {fixture:{handovers:unknown[]}}).fixture.handovers);
  assert.equal(commands.length,2);assert.deepEqual(commands[0],commands[1]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log(`Doctor handover rendered: ${chromiumMode?'Chromium':'WebKit'} phone/desktop confirm, cancel, exact failure retry, no overflow or browser errors passed (synthetic IO; no iPhone keyboard proof).`);
}finally{await browser?.close();await fixture.close();}
