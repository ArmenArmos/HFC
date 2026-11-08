import {test,expect} from '@playwright/test';
import {startDoctorChatFixture} from '../doctor-chat-v2/server.mjs';

let fixture:Awaited<ReturnType<typeof startDoctorChatFixture>>;
test.beforeAll(async()=>{fixture=await startDoctorChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1')return route.abort();
  return route.fulfill(await fixture.respond(route.request().url()));
 });
});
type SearchState={searchQueries?:string[];navigations?:string[]};
const memberPath='/staff/real/doctor-chat-v2/patient/d1a00000-0000-4000-8000-000000000002';

for(const [locale,find,noMatch,invalid] of [
 ['en','Find a member','No member of yours matches.','Enter a valid date of birth.'],
 ['hy','Գտնել անդամին','Ձեր անդամներից ոչ մեկը չի համապատասխանում։','Մուտքագրեք ծննդյան վավեր ամսաթիվ։'],
 ['ru','Найти участника','Среди ваших участников совпадений нет.','Введите корректную дату рождения.'],
] as const){
 test.describe(locale,()=>{
  test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  test('find chip, touch newline and send arrow with search outcomes',async({page})=>{
   const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${fixture.url}/staff/real/doctor-chat-v2?state=find-member&locale=${locale}`);
   const field=page.locator('footer textarea'),send=page.locator('footer button[type=submit]');
   await expect(send).toBeDisabled();
   await page.getByRole('button',{name:find,exact:true}).click();await expect(field).toBeFocused();
   const hint=page.locator('#doctor-member-search-hint');await expect(hint).toBeVisible();
   expect(await hint.innerText()).toBe(await field.getAttribute('placeholder'));
   await page.screenshot({path:`/tmp/noreon-find-${locale}-mobile.png`,fullPage:true});
   await field.fill('9929');await expect(send).toBeEnabled();
   expect(await send.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
   expect(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches)).toBe(true);
   await field.press('Enter');await expect(field).toHaveValue('9929\n');
   expect(await page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.searchQueries??[])).toEqual([]);
   // Use the actual arrow, including its pointer-down behavior.
   await field.fill('9929');await send.click();
   await expect.poll(()=>page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.navigations)).toEqual([memberPath]);
   await field.fill('15.03.1968');await send.click();
   await expect.poll(()=>page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.navigations?.length)).toBe(2);
   await field.fill('1234');await send.click();
   await expect(page.locator('[data-member-disambiguation]').last()).toBeVisible();
   expect(await page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.navigations?.length)).toBe(2);
   await page.locator('[data-member-disambiguation]').last().getByRole('button').first().click();
   await expect.poll(()=>page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.navigations?.length)).toBe(3);
   await field.fill('0000');await send.click();await expect(page.getByText(noMatch,{exact:true})).toBeVisible();
   await field.fill('31.02.1968');await send.click();await expect(page.getByText(invalid,{exact:true})).toBeVisible();
   expect(await page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.searchQueries)).toEqual(['9929','15.03.1968','1234','0000','31.02.1968']);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`/tmp/noreon-find-${locale}-outcomes.png`,fullPage:true});
   expect(errors).toEqual([]);
  });
 });
}

test('desktop find action and keyboard search',async({page})=>{
 await page.setViewportSize({width:1280,height:900});
 await page.goto(`${fixture.url}/staff/real/doctor-chat-v2?state=find-member`);
 await page.getByRole('button',{name:'Find a member',exact:true}).click();
 const field=page.locator('footer textarea');await expect(field).toBeFocused();
 await page.screenshot({path:'/tmp/noreon-find-desktop.png',fullPage:true});
 await field.fill('Mariam');await field.press('Enter');
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {fixture:SearchState}).fixture.navigations)).toEqual([memberPath]);
});
