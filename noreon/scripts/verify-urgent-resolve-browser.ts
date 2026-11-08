/** Actual doctor chat/form/styles, synthetic IO. Requests are fulfilled in memory; no server or external network. */
import assert from 'node:assert/strict';
import {webkit,chromium} from '@playwright/test';
import {startDoctorChatFixture} from '../e2e/doctor-chat-v2/server.mjs';
const fixture=await startDoctorChatFixture();
const engine=process.argv.includes('--chromium')?chromium:webkit;
let browser:Awaited<ReturnType<typeof webkit.launch>>|undefined;
try{browser=await engine.launch();}catch(error){await fixture.close();throw error;}
try{
 for(const width of [390,1280])for(const locale of ['en','hy','ru'] as const){
  const page=await browser!.newPage({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.fulfill(await fixture.respond(route.request().url())):route.abort());
  await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=notice-focus&locale=${locale}`);
  const card=page.locator('[data-resolve-form]').first();await card.waitFor({state:'attached'});
  const details=page.locator('details').filter({has:card});await details.locator('summary').click();
  await card.locator('[data-suggested="outcome"]').waitFor();
  assert.equal(await card.locator('select').inputValue(),'member_contacted');
  assert.match(await card.locator('textarea').inputValue(),/Nurse Example/);
  assert.match(await card.locator('[data-closing-as]').innerText(),/Aram Example/);
  assert.equal(await page.evaluate(()=>(window as unknown as {fixture:{alertCommands?:unknown[]}}).fixture.alertCommands?.length??0),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
  await page.screenshot({path:`/tmp/noreon-urgent-resolve-${locale}-${width}.png`,fullPage:true});
  await card.locator('select').selectOption('other');assert.equal(await card.locator('[data-suggested="outcome"]').count(),0);assert.equal(await card.locator('[data-suggested="reason"]').count(),1);
  await card.locator('textarea').fill('Recorded facts checked');assert.equal(await card.locator('[data-suggested]').count(),0);
  await card.getByRole('button').click();
  await page.waitForFunction(()=>(window as unknown as {fixture:{alertCommands?:unknown[]}}).fixture.alertCommands?.length===1);
  const commands=await page.evaluate(()=>(window as unknown as {fixture:{alertCommands:{press:string;resolution:string;note:string;seq:number}[]}}).fixture.alertCommands);
  assert.equal(commands[0].press,'resolve');assert.equal(commands[0].resolution,'other');assert.equal(commands[0].note,'Recorded facts checked');assert.equal(commands[0].seq,1);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Urgent Resolve browser: actual doctor chat, 390/1280, en/hy/ru prefill, field edits, named closer, one explicit confirm, no overflow or browser errors (synthetic IO; no iPhone keyboard proof).');
}finally{await browser?.close();await fixture.close();}
