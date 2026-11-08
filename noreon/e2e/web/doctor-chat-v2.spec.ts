import {test,expect,type Page} from '@playwright/test';
import type {FixtureState,ConversationFixture,LabFixture,AiPlanFixture} from '../doctor-chat-v2/actions';
import {startDoctorChatFixture} from '../doctor-chat-v2/server.mjs';

for(const [locale,choice] of [['en','Use the new text'],['hy','Օգտագործել նոր տեքստը'],['ru','Использовать новый текст']] as const)test(`Plan lab refresh keeps manual edits in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-ai-ready&locale=${locale}`);
 await page.waitForFunction(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert);
 await page.evaluate(()=>{(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert!.alert.state='resolved';});
 await page.getByRole('button',{name:locale==='en'?'Who needs me':locale==='hy'?'Ո՞ւմ է պետք իմ օգնությունը':'Кому нужна моя помощь',exact:true}).click();
 await page.locator('[data-inbox-id="plan-second"]').click();
 const card=planBlock(page),instructions=card.locator('textarea[name="instructions"]');
 await instructions.fill('Doctor manual instructions that must survive');
 await page.evaluate(()=>{
  const f=(window as unknown as {fixture:AiPlanFixture}).fixture;
  f.refreshedGeneration={id:'d6a00000-0000-4000-8000-000000000002',summary:'Refreshed synthetic draft',items:[],draft:{explanation:'New AI explanation',instructions:'New AI instructions',followUp:'New AI follow-up'}};
  document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));
 });
 await expect(card.getByRole('button',{name:choice,exact:true})).toBeVisible();
 await expect(instructions).toHaveValue('Doctor manual instructions that must survive');
 await expect(card.getByRole('status').filter({hasText:/newer prepared draft|ավելի նոր սևագիր|более новый черновик/u})).toBeVisible();
 await page.screenshot({path:`/tmp/doctor-plan-refresh-${locale}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await card.getByRole('button',{name:choice,exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/doctor-plan-refresh-${locale}-desktop.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await card.getByRole('button',{name:choice,exact:true}).click();
 await expect(instructions).toHaveValue('New AI instructions');
 expect((await aiPlanState(page)).aiPlanSaves).toEqual([]);
 expect((await planState(page)).planCommands).toEqual([]);
});

for(const [locale,command,named,save] of [
 ['en','Prepare care plan','Draft a care plan for Mariam Example','Use this draft'],
 ['hy','Պատրաստիր խնամքի պլան','Պատրաստիր խնամքի պլան Mariam Example-ի համար','Օգտագործել այս սևագիրը'],
 ['ru','Подготовь план лечения','Составь черновик плана ухода для Mariam Example','Использовать этот черновик'],
] as const)for(const target of ['open','named'] as const)test(`F-P0-2 typed ${target} preparation in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?history&state=plan-no-ai&locale=${locale}`);
 const type=async(text:string)=>{await page.locator('footer textarea').fill(text);await page.locator('footer button[type=submit]').click();};
 if(target==='open'){await type('Mariam');await expect(page.locator('[data-conversation-member]')).toBeVisible();}
 await type(target==='open'?command:named);
 const card=planBlock(page);await expect(card.locator('textarea[name="explanation"]')).toHaveValue('AI explanation for review');
 await expect(card.getByRole('button',{name:save,exact:true})).toBeDisabled();
 await expect(card.getByRole('status').filter({hasText:/Draft prepared|Սևագիրը պատրաստ է|Черновик подготовлен/u})).toBeVisible();
 const state=await aiPlanState(page);expect(state.aiPlanPrepares).toBe(1);expect(state.aiPlanSaves).toEqual([]);expect((await planState(page)).planCommands).toEqual([]);
 await card.locator('textarea[name="instructions"]').fill('Doctor reviewed instructions');
 await page.screenshot({path:`/tmp/doctor-plan-${locale}-${target}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await card.locator('textarea[name="explanation"]').scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/doctor-plan-${locale}-${target}-desktop.png`,fullPage:true});
 if(locale==='en'&&target==='open'){
  await card.getByRole('button',{name:'I checked all, accept all',exact:true}).click();
  await card.getByRole('button',{name:save,exact:true}).click();
  const approval=card.locator('[data-decision="regimen"]');await expect(approval).toBeVisible();
  await expect(approval).toContainText('Doctor reviewed instructions');
  const publish=approval.getByRole('button',{name:'Approve and publish this plan',exact:true});await expect(publish).toBeDisabled();
  await approval.getByRole('checkbox').check();await approval.getByRole('textbox').fill('Doctor entered replacement summary');
  await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.state='plan-refused';});
  await publish.click();await expect(approval.getByRole('alert')).toContainText('required laboratory result');
  expect((await planState(page)).planCommands).toHaveLength(1);
 }
});

for(const state of ['plan-ai-prepare-missing','plan-ai-prepare-off'])test(`F-P0-2 unreadable preparation shows retry: ${state}`,async({page})=>{
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=${state}`);
 await send(page,'Draft a care plan for Mariam Example');
 const card=planBlock(page);await expect(card.getByRole('alert').filter({hasText:/could not be opened|switched off/})).toBeVisible();
 await expect(card.getByText(/Draft prepared/)).toHaveCount(0);await expect(card.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
 expect((await aiPlanState(page)).aiPlanSaves).toEqual([]);
 await page.screenshot({path:`/tmp/doctor-plan-${state}.png`,fullPage:true});
});
test('F-P0-2 urgent member explains why preparation is unavailable',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=plan-no-ai');await openPlan(page);
 await expect(planBlock(page).getByRole('alert').filter({hasText:'An urgent alert is open'})).toBeVisible();
 await expect(planBlock(page).getByRole('button',{name:'Prepare care plan',exact:true})).toHaveCount(0);
 await page.screenshot({path:'/tmp/doctor-plan-urgent.png',fullPage:true});
});

let fixture:Awaited<ReturnType<typeof startDoctorChatFixture>>;
test.use({viewport:{width:402,height:714},isMobile:true,hasTouch:true});
test.beforeAll(async()=>{fixture=await startDoctorChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1')return route.abort();
  return route.fulfill(await fixture.respond(route.request().url()));
 });
});
const unchanged=async(page:Page,url:string)=>{await expect(page).toHaveURL(url);await expect(page.locator('a[href]')).toHaveCount(0);};
const bottom=(page:Page)=>page.locator('.cv2-thread').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
async function send(page:Page,text:string){
 const url=page.url();await page.getByRole('textbox',{name:'Your message',exact:true}).fill(text);await unchanged(page,url);
 await page.getByRole('button',{name:/^(Send|Save draft)$/}).click();await unchanged(page,url);
}

for(const [locale,label,openLabel] of [['en','My members','Open'],['hy','Իմ անդամները','Բացել'],['ru','Мои участники','Открыть']] as const)test(`menu browses members and opens your choice in ${locale} at 390 px`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`;await page.goto(url);
 await page.locator('.cv2-avatar').click();
 const menu=page.getByRole('dialog'),entry=menu.getByRole('button',{name:label,exact:true});
 await expect(entry).toBeVisible();expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await expect(menu.locator('form')).toHaveCount(2);
 await entry.click();await expect(menu).toHaveCount(0);
 const rows=page.locator('.dcv2-who .dcv2-row');await expect(rows).toHaveCount(3);
 for(const row of await rows.all()){
  await expect(row.getByText(openLabel,{exact:true})).toBeVisible();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 }
 const state=await fixtureState(page);expect(state.searchReads).toBe(1);expect(state.openReads).toBe(0);
 await page.screenshot({path:`/tmp/noreon-b-members-${locale}-390.png`});
 await rows.filter({hasText:'Mariam Example'}).click();
 await expect(page.locator('[data-conversation-member]')).toContainText('Mariam Example');
 expect((await fixtureState(page)).searchReads).toBe(1);expect((await fixtureState(page)).openReads).toBe(1);
 expect((await fixtureState(page)).composeCalls).toBe(0);expect((await fixtureState(page)).approveCalls).toBe(0);
 await unchanged(page,url);
 await page.setViewportSize({width:1280,height:800});await expect(page.locator('[data-conversation-member]')).toBeVisible();
 await page.screenshot({path:`/tmp/noreon-b-members-${locale}-desktop.png`});
});
for(const [locale,openLabel,ack,resolve] of [['en','Open member','Acknowledge','Resolve'],['hy','Բացել անդամին','Հաստատել','Լուծել'],['ru','Открыть участника','Подтвердить','Закрыть']] as const)for(const source of ['who','urgent'] as const)test(`${source} alert explicitly opens the member in ${locale} at 390 px`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`;if(source==='urgent')await page.clock.install();await page.goto(url);
 if(source==='who')await page.getByRole('button',{name:locale==='en'?'Who needs me':locale==='hy'?'Ո՞ւմ է պետք իմ օգնությունը':'Кому нужна моя помощь',exact:true}).click();
 else{
  await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.newAlert=true;});
  await page.clock.runFor(60_000);
 }
 const card=page.locator(source==='who'?'.dcv2-alert-row':'.dcv2-alert').last(),open=card.getByRole('button',{name:openLabel,exact:true});
 await expect(open).toBeVisible();await expect(card.getByRole('button',{name:ack,exact:true})).toBeVisible();await expect(card.getByRole('button',{name:resolve,exact:true})).toBeVisible();
 expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.screenshot({path:`/tmp/noreon-b-alert-${source}-${locale}-390.png`});
 await open.click();await expect(page.locator('[data-conversation-member="d1a00000-0000-4000-8000-000000000001"]').last()).toBeVisible();
 expect((await fixtureState(page)).openReads).toBe(1);expect((await commandState(page)).alertCommands??[]).toEqual([]);
 await card.locator('.dcv2-row').click();expect((await fixtureState(page)).openReads).toBe(2);
 await unchanged(page,url);
 await page.setViewportSize({width:1280,height:800});await card.scrollIntoViewIfNeeded();await expect(open).toBeVisible();
 await page.screenshot({path:`/tmp/noreon-b-alert-${source}-${locale}-desktop.png`});
});

for(const [locale,next] of [['en','Review the open 103 alert'],['hy','Վերանայեք 103-ի բաց ահազանգը'],['ru','Проверьте открытое оповещение 103']] as const)test(`member summary precedes messages in five short lines at 390 px (${locale})`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}&history`;
 await page.goto(url);
 const open=async()=>{await page.getByRole('textbox').fill('Find Mariam');await page.locator('footer button[type=submit]').click();};
 await open();
 const id='d1a00000-0000-4000-8000-000000000002';
 await expect(page.locator('[data-draft]')).toHaveCount(1);
 await expect(page.locator('.dcv2-member-summary')).toHaveCount(0);
 await page.evaluate(id=>{
  const f=(window as unknown as {fixture:ConversationFixture}).fixture,view=f.members[id];
  view.reply={card:null,prepare:view.reply!.prepare};
  view.urgentOpen=true;view.urgentSince='2026-11-02T08:00:00Z';
  view.summary={replyWaiting:'message',latestFileAt:'2026-11-02T08:00:00Z',resultsWaiting:true};
 },id);
 await open();
 const conversation=page.locator(`[data-conversation-member="${id}"]`).last(),summary=conversation.locator('.dcv2-member-summary');
 await expect(summary).toContainText('Mariam Example');await expect(summary).toContainText(next);
 await expect(summary.locator('time')).toHaveCount(2);await expect(summary.locator('[data-urgent-window]')).toHaveCount(1);
 expect(await summary.evaluate(el=>el.compareDocumentPosition(el.parentElement!.querySelector('.dcv2-entries')!)&Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
 await summary.scrollIntoViewIfNeeded();
 const geometry=await summary.evaluate(el=>({height:el.getBoundingClientRect().height,overflows:el.scrollWidth>el.clientWidth}));
 expect(geometry.overflows).toBe(false);expect(geometry.height).toBeLessThanOrEqual(190);
 await page.screenshot({path:`/tmp/noreon-member-summary-${locale}-390.png`});
 await expect(conversation.getByRole('button',{name:locale==='en'?'Reply':locale==='hy'?'Պատասխանել':'Ответить',exact:true})).toBeEnabled();
 await expect(conversation.getByRole('button',{name:locale==='en'?'Care plan':locale==='hy'?'Խնամքի պլան':'План лечения',exact:true})).toBeEnabled();
 await page.setViewportSize({width:1280,height:800});await summary.scrollIntoViewIfNeeded();
 await expect(summary).toContainText(next);await page.screenshot({path:`/tmp/noreon-member-summary-${locale}-desktop.png`});
 await unchanged(page,url);
});

test('empty start, suggestion and typed input stay in one local thread',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2';await page.goto(url);
 await expect(page.getByRole('log')).toHaveCount(1);
 await expect(page.locator('[data-message-key]')).toHaveCount(0);
 await expect(page.getByText('Hello, Aram Example. Who needs you today?')).toBeVisible();
 await expect(page.locator('ul')).toHaveCount(0);await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-empty-phone.png'});
 const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
 await page.getByRole('button',{name:'Who needs me',exact:true}).click();
 await expect(page.locator('[data-message-key].cv2-me').last()).toHaveText('Who needs me');
 await expect(page.locator('.dcv2-who')).toBeVisible();await unchanged(page,url);
 await expect(page.getByRole('textbox')).toBeFocused();
 await expect(page.getByRole('button',{name:'Who needs me',exact:true})).toHaveCount(0);
 await send(page,'Who needs me');await expect(page.locator('.dcv2-who')).toHaveCount(2);
 await send(page,'Find Mariam');await expect(page.locator('[data-conversation-member]')).toHaveCount(1);
 await expect(page.getByText('Hello, Aram Example. Who needs you today?')).toHaveCount(1);
 expect(requests).toEqual([]);await expect(page.getByRole('log')).toHaveCount(1);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-phone.png'});
 await page.setViewportSize({width:1280,height:800});await expect(page.getByRole('textbox')).toBeVisible();await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-desktop.png'});
 await page.reload();await expect(page.locator('[data-message-key]')).toHaveCount(0);
 await expect(page.getByText('Hello, Aram Example. Who needs you today?')).toBeVisible();await unchanged(page,url);
});

test('long page-state thread opens newest and follows to the end after the doctor sends from higher up',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);
 await expect(page.getByText('Earlier reply 99')).toBeVisible();await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.waitForTimeout(100);
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await page.setViewportSize({width:402,height:620});
 await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'));});
 await page.waitForTimeout(100);expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await send(page,'Who needs me');
 await expect(page.locator('.dcv2-who')).toBeVisible();await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await expect(page.getByRole('button',{name:'New message',exact:true})).toHaveCount(0);
 const keys=await page.locator('[data-message-key]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-key')));
 expect(new Set(keys).size).toBe(keys.length);
 await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
});

test('phone has one scroller, growing 16px composer, coarse Enter and focus-preserving send',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);
 const geometry=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.querySelector('textarea')!).fontSize),
  scrollers:[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className),
  bottom:document.querySelector('.cv2-composer')!.getBoundingClientRect().bottom,
  expected:innerHeight-parseFloat(getComputedStyle(document.querySelector('.cv2-bottom')!).paddingBottom)}));
 expect(geometry.font).toBeGreaterThanOrEqual(16);expect(geometry.scrollers).toEqual(['cv2-thread']);expect(geometry.bottom).toBeCloseTo(geometry.expected,0);
 const field=page.getByRole('textbox'),height=(await field.boundingBox())!.height;
 await field.fill('A long message. '.repeat(35));expect((await field.boundingBox())!.height).toBeGreaterThan(height*2);await unchanged(page,url);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(field).toBeFocused();await expect(field).toHaveValue('');await unchanged(page,url);
 await field.fill('First line');await field.press('Enter');await expect(field).toHaveValue('First line\n');await unchanged(page,url);
 await field.press('Control+Enter');await expect(field).toHaveValue('');await expect(field).toBeFocused();await unchanged(page,url);
 await expect(field).toHaveCSS('height',`${height}px`);expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('language sheet translates the screen without links and restores focus',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2';await page.goto(url);
 // Safari never focuses a tapped button, so restoring focus is a keyboard behaviour.
 await page.locator('.cv2-avatar').focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await unchanged(page,url);
 await page.getByRole('button',{name:'Հայերեն',exact:true}).click();await expect(page.locator('[data-doctor-chat-v2]')).toHaveAttribute('lang','hy');await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-language-hy.png'});
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.cv2-avatar')).toBeFocused();await unchanged(page,url);
 await expect(page.getByText('Բարև, Aram Example։ Ո՞ւմ է այսօր պետք ձեր օգնությունը։')).toBeVisible();
 await page.getByRole('button',{name:'Ո՞ւմ է պետք իմ օգնությունը',exact:true}).click();
 await expect(page.locator('.dcv2-who')).toBeVisible();await expect(page.locator('[data-alert-field="severity"]').first()).toContainText('Շտապ');await unchanged(page,url);
 await page.locator('.cv2-avatar').click();await page.getByRole('button',{name:'Русский',exact:true}).click();
 await expect(page.locator('[data-doctor-chat-v2]')).toHaveAttribute('lang','ru');await unchanged(page,url);
 await page.keyboard.press('Escape');await expect(page.locator('[data-alert-field="severity"]').first()).toContainText('Срочно');
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-ru.png'});
 await page.locator('.cv2-avatar').click();await page.mouse.click(200,120);await expect(page.getByRole('dialog')).toHaveCount(0);await unchanged(page,url);
});

test('language failure stays in the sheet with retry feedback',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?state=language-failed';await page.goto(url);
 await page.locator('.cv2-avatar').click();await page.getByRole('button',{name:'Հայերեն',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Could not save the language. Try again.');
 await expect(page.locator('[data-doctor-chat-v2]')).toHaveAttribute('lang','en');await unchanged(page,url);
});


test('waiting list is inline, alerts first, rows append local turns and no navigation',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?state=loading';await page.goto(url);
 await page.getByRole('button',{name:'Who needs me',exact:true}).click();
 const loading=page.getByRole('status');await expect(loading).toHaveText('Checking who needs you…');
 const key=await loading.locator('..').getAttribute('data-message-key');
 await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.releaseDay?.();});
 await expect(page.locator('.dcv2-who')).toBeVisible();
 await expect(page.locator(`[data-message-key="${key}"] .dcv2-who`)).toHaveCount(1);
 const rows=page.locator('.dcv2-who .dcv2-row');await expect(rows).toHaveCount(10);
 await expect(rows.first()).toHaveAttribute('data-urgent','true');await expect(rows.first()).toContainText('Ani Example');
 await expect(rows.nth(1)).toContainText('Mariam Example');await expect(rows.nth(1)).toContainText('Zoe drafted a reply');
 // The joiner between date and time (", " or " at ") depends on the ICU data of the machine, so only the parts that matter are pinned.
 await expect(rows.first().locator('time')).toHaveText(/^Nov 2(,| at) 12:00$/);
 expect(await rows.evaluateAll(nodes=>nodes.every(el=>el.getBoundingClientRect().height>=44))).toBe(true);
 const asked=page.locator('.dcv2-asked');expect(await asked.evaluate(el=>el.clientHeight)).toBeLessThanOrEqual(46);
 await expect(page.getByText('Also waiting: 3 other items.')).toBeVisible();
 const calls=await page.evaluate(()=>({day:(window as unknown as {fixture:FixtureState}).fixture.dayReads,poll:(window as unknown as {fixture:FixtureState}).fixture.pollReads}));
 await rows.nth(1).click();
 await expect(page.locator('[data-message-key].cv2-me').last()).toHaveText('Open Mariam Example');
 await expect(page.locator('[data-conversation-member]')).toBeVisible();
 await expect(page.locator('[data-conversation-member]')).toContainText('Can you help me understand my plan?');
 expect(await page.evaluate(()=>({day:(window as unknown as {fixture:FixtureState}).fixture.dayReads,poll:(window as unknown as {fixture:FixtureState}).fixture.pollReads}))).toEqual(calls);
 await expect(rows).toHaveCount(10);await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-list-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'e2e/.state/doctor-chat-v2-list-desktop.png'});
});

test('new urgent poll preserves a scrolled reader and announces once',async({page})=>{
 await page.clock.install();
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);
 await expect(page.getByText('Earlier reply 99')).toBeVisible();
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;el.dispatchEvent(new Event('scroll'));});
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.newAlert=true;});await page.clock.runFor(60_000);
 await expect(page.locator('.dcv2-alert')).toHaveCount(1);await expect(page.locator('.dcv2-alert')).toHaveAttribute('role','alert');
 await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await page.clock.runFor(60_000);await expect(page.locator('.dcv2-alert')).toHaveCount(1);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await page.screenshot({path:'e2e/.state/doctor-chat-v2-unread-alert.png'});
 await page.getByRole('button',{name:'New message',exact:true}).click();await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await page.locator('.dcv2-alert .dcv2-row').click();await expect(page.locator('[data-message-key].cv2-me').last()).toHaveText('Open Lilit Example');await unchanged(page,url);
});

test('long waiting list scrolls only in the thread',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?long';await page.goto(url);
 await send(page,'Who needs me');await expect(page.locator('.dcv2-who .dcv2-row')).toHaveCount(77);
 await expect(page.getByText('Only the first items are shown.')).toBeVisible();
 const scrollers=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className));
 expect(scrollers).toEqual(['cv2-thread']);
 await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=0;});await expect(page.getByText('Hello, Aram Example. Who needs you today?')).toBeVisible();
 await expect(page.locator('.dcv2-who .dcv2-row').first()).toBeVisible();expect(await page.evaluate(()=>scrollY)).toBe(0);await unchanged(page,url);
});

for(const state of ['unavailable','refused','empty','incomplete','poll-failed'])test(`waiting state: ${state}`,async({page})=>{
 const url=fixture.url+`/staff/real/doctor-chat-v2?state=${state}`;await page.goto(url);
 await send(page,'Who needs me');
 const expected={unavailable:'The waiting list could not be read. Try “Who needs me” again.',refused:'Not done, because access is unavailable. Re-open the member to check access.',empty:'Nobody is waiting for you right now.',incomplete:'Some sources are unavailable: urgent alerts. These counts are incomplete.','poll-failed':'Urgent alerts could not be checked.'}[state]!;
 if(state==='incomplete'||state==='poll-failed'){
  await expect(page.locator('.dcv2-who')).toBeVisible();
  await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=0;});
 }
 await expect(page.getByText(expected,{exact:true})).toBeVisible();
 if(state!=='empty')await expect(page.getByText(expected,{exact:true})).toHaveAttribute('role','alert');
 await unchanged(page,url);
});

for(const locale of ['en','hy','ru']as const)for(const width of [390,1280])test(`urgent completeness ${locale} at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.clock.install();
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=non-urgent-incomplete&locale=${locale}`);
 const failure={en:'Urgent alerts could not be checked.',hy:'Շտապ ահազանգերը չհաջողվեց ստուգել։',ru:'Не удалось проверить срочные оповещения.'}[locale];
 await expect(page.locator('.dcv2-alert')).toHaveCount(1);
 await expect(page.getByText(failure,{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:{en:'Who needs me',hy:'Ո՞ւմ է պետք իմ օգնությունը',ru:'Кому нужна моя помощь'}[locale],exact:true}).click();
 await expect(page.getByText({en:'Some sources are unavailable: saved plans, member uploads. These counts are incomplete.',hy:'Որոշ աղբյուրներ անհասանելի են՝ պահպանված պլաններ, անդամների վերբեռնած ֆայլեր։ Քանակները թերի են։',ru:'Некоторые источники недоступны: сохранённые планы, файлы участников. Количество неполное.'}[locale],{exact:true})).toBeVisible();
 await expect(page.getByText(failure,{exact:true})).toHaveCount(0);
 await expect(page.locator('.dcv2-who')).not.toContainText(/saved_plans|uploads_waiting|staff_chat_member_identities/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/doctor-source-names-${locale}-${width}.png`,fullPage:true});
 await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.state='incomplete';});
 await page.clock.runFor(60_000);
 await expect(page.getByText({en:'Some sources are unavailable: urgent alerts. These counts are incomplete.',hy:'Որոշ աղբյուրներ անհասանելի են՝ շտապ ահազանգեր։ Քանակները թերի են։',ru:'Некоторые источники недоступны: срочные оповещения. Количество неполное.'}[locale],{exact:true})).toBeVisible();
 await expect(page.getByText(failure,{exact:true})).toHaveCount(1);
 await page.clock.runFor(60_000);
 await expect(page.getByText(failure,{exact:true})).toHaveCount(1);
 await expect(page.locator('.dcv2-alert')).toHaveCount(1);
});

// Block B: actual member reads and commands, through the isolated local entry point.
const mariam='d1a00000-0000-4000-8000-000000000002';
const conversation=(page:Page)=>page.locator(`[data-conversation-member="${mariam}"]`).last();
const fixtureState=(page:Page)=>page.evaluate(()=>(window as unknown as {fixture:FixtureState&ConversationFixture}).fixture);
async function openMariam(page:Page,query=''){
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2'+query);
 await send(page,'Who needs me');
 await page.locator('.dcv2-who .dcv2-row').filter({hasText:'Mariam Example'}).first().click();
 await expect(conversation(page)).toBeVisible();
}
async function approve(page:Page){
 await conversation(page).getByRole('button',{name:/Send this reply/}).click();
}

test('member opens inline, approval appends doctor turn before acknowledgement',async({page})=>{
 await openMariam(page);const url=page.url();
 await expect(conversation(page)).toContainText('Your doctor can review this with you.');
 await expect(conversation(page)).toContainText('Your readings are ready for review.');
 await expect(conversation(page).locator('[data-draft]')).toContainText("Zoe's draft");
 await approve(page);
 await expect(conversation(page).locator('[data-draft]')).toHaveCount(0);
 await expect.poll(async()=>(await fixtureState(page)).approveCalls).toBe(1);
 const turns=await page.locator('[data-message-key]').allTextContents();
 expect(turns.at(-2)).toBe('You can keep following your agreed care plan and send your home readings.');
 expect(turns.at(-1)).toMatch(/queued|Queued|sent|Sent/);
 await unchanged(page,url);await expect(page.getByRole('log')).toHaveCount(1);
 await page.setViewportSize({width:1280,height:800});await expect(conversation(page)).toBeVisible();await unchanged(page,url);
});

test('change saves one revised draft, keeps it unsent and approval uses revised text',async({page})=>{
 await openMariam(page);const url=page.url(),body='Please send your readings tomorrow morning.';
 await conversation(page).getByRole('button',{name:'Change',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Reply to Mariam Example');
 await page.getByRole('textbox').fill(body);await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Done: Saved, not sent yet.',{exact:true})).toBeVisible();
 await expect(page.getByText(body,{exact:true})).toHaveCount(1);
 await expect(conversation(page).locator('[data-draft]').getByText(body,{exact:true})).toHaveCount(0);
 expect((await fixtureState(page)).approveCalls).toBe(0);
 await approve(page);
 expect((await fixtureState(page)).reviseCalls).toBe(1);
 await expect(conversation(page).locator('[data-draft]')).toHaveCount(0);
 await expect(page.locator('[data-message-key].cv2-me').filter({hasText:body})).toHaveCount(1);
 await send(page,'Open Mariam');
 await expect(conversation(page).locator('[data-draft]')).toHaveCount(0);
 await expect(page.locator('[data-draft]')).toHaveCount(0);await unchanged(page,url);
});

test('saved reply returns after reload with its one send step at 390px',async({page})=>{
 await page.setViewportSize({width:390,height:844});await openMariam(page);
 const body='Please send your home readings tomorrow.';
 await conversation(page).getByRole('button',{name:'Change',exact:true}).click();
 await page.getByRole('textbox').fill(body);
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Done: Saved, not sent yet.',{exact:true})).toBeVisible();
 const saved=await fixtureState(page);expect(saved.approveCalls).toBe(0);
 // The synthetic backend normally resets on reload. Keep its saved records outside the page, just as the server does.
 await page.route('**/staff/real/doctor-chat-v2',async route=>{
  const response=await fixture.respond(route.request().url());
  await route.fulfill({...response,body:String(response.body).replace('</script><script src=',`;window.fixture.members=${JSON.stringify(saved.members)}</script><script src=`)});
 });
 await page.reload();
 await expect(conversation(page).locator('[data-draft]')).toContainText(body);
 await expect(conversation(page).getByRole('button',{name:/Send this reply/})).toBeEnabled();
 await expect(page.getByText('Done: Saved, not sent yet.',{exact:true})).toBeVisible();
 const restored=await fixtureState(page);
 expect([restored.composeCalls,restored.reviseCalls,restored.approveCalls]).toEqual([0,0,0]);
 expect(restored.openReads).toBe(1);
 await page.screenshot({path:'/tmp/noreon-reply-restored-390.png'});
 await send(page,'Open Mariam');await expect(page.locator('[data-draft]')).toHaveCount(1);
 await page.setViewportSize({width:1280,height:800});
 await expect(conversation(page).locator('[data-draft]')).toContainText(body);
 await page.screenshot({path:'/tmp/noreon-reply-restored-desktop.png'});
});

for(const [locale,reply,plan,save] of [['en','Reply','Care plan','Save draft'],['hy','Պատասխանել','Խնամքի պլան','Պահել նախագիծը'],['ru','Ответить','План лечения','Сохранить черновик']] as const)test(`reply chips stay usable in one row at 390px in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`);
 await page.getByRole('textbox').fill('Open Ani');await page.locator('footer button[type=submit]').click();
 const member=page.locator('[data-conversation-member]').last();
 const replyButton=member.getByRole('button',{name:reply,exact:true}),planButton=member.getByRole('button',{name:plan,exact:true});
 await replyButton.click();await page.getByRole('textbox').fill('A reply to review.');
 await expect(replyButton).toBeEnabled();await expect(planButton).toBeEnabled();
 await expect(page.getByRole('button',{name:save,exact:true})).toBeEnabled();
 const a=(await replyButton.boundingBox())!,b=(await planButton.boundingBox())!;
 expect(a.y).toBe(b.y);expect(a.height).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);
 await expect(replyButton).toHaveCSS('opacity','1');await expect(planButton).toHaveCSS('opacity','1');
 await page.screenshot({path:`/tmp/noreon-reply-chips-${locale}-390.png`});
});

test('Reply without a draft saves a proposal and Close reply restores ordinary composer',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');await send(page,'Who needs me');
 await page.locator('.dcv2-who .dcv2-row').filter({hasText:'Member Example 1'}).first().click();
 const member=page.locator('[data-conversation-member]').last(),url=page.url();
 await expect(member.locator('[data-draft]')).toHaveCount(0);
 await member.getByRole('button',{name:'Reply',exact:true}).click();
 await expect(page.getByText('Replying to Member Example 1',{exact:true})).toBeVisible();
 await page.getByRole('textbox').fill('An unfinished reply');
 await page.getByRole('button',{name:'Close reply',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Ask Zoe about Member Example 1');
 await expect(page.getByRole('textbox')).toHaveValue('');
 await member.getByRole('button',{name:'Reply',exact:true}).click();
 await page.getByRole('textbox').fill('Your new reply is ready for your approval.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Your new reply is ready for your approval.',{exact:true})).toHaveCount(1);
 await expect(member.locator('[data-draft]')).toContainText('Done: Saved, not sent yet.');
 expect((await fixtureState(page)).composeCalls).toBe(1);expect((await fixtureState(page)).approveCalls).toBe(0);
 await unchanged(page,url);
});

test('plain words with no member: the queue, missing blood pressure and a phone ending open inline, none asks who you mean',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');const url=page.url();
 for(const words of ['Բարի լույս, Zoe։ Այսօր ումի՞ց սկսեմ, գիշերվանից շտապ բան կա՞','кто срочный? что было ночью']){
  await send(page,words);await expect(page.locator('.dcv2-who').last()).toBeVisible();
  await expect(page.locator('[data-message-key]').last()).not.toContainText(/Who do you mean|Which member/);
 }
 await send(page,'anyone hasnt logged bp this week');
 const last=page.locator('[data-message-key]').last();
 await expect(last).toContainText('No BP readings recorded');await expect(last.getByRole('button',{name:/Ani Example/})).toBeVisible();
 await send(page,'открой пациента с телефоном на 0104');
 await expect(page.locator('[data-conversation-member]').last()).toContainText('Ani Example');
 await send(page,'Вчера что я одобрил и что реально ушло?');
 await expect(page.locator('[data-message-key]').last()).toContainText('Your approvals and actions');
 await unchanged(page,url);
});
test('approvals history stays read-only, shows delivery outcomes and opens the member inline',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?long');const url=page.url();
 for(const words of ['what did I approve yesterday and what actually went out?','Երեկ ինչ եմ հաստատել','Вчера что я одобрил и что реально ушло?']){
  await send(page,words);
  const history=page.locator('[data-approvals-history]').last();
  await expect(history).toHaveAttribute('data-approvals-history','yesterday');
  for(const text of ["Delivered to the member's chat",'Held','Not delivered','Unknown, check the conversation','Only the first 100 are shown.','As of'])await expect(history).toContainText(text);
  await expect(history.getByRole('button')).toHaveCount(100);
 }
 const history=page.locator('[data-approvals-history]').last();
 await history.getByRole('button',{name:/Mariam Example/}).first().click();
 await expect(conversation(page)).toContainText('Mariam Example');await unchanged(page,url);
 const f=await page.evaluate(()=>window.fixture as unknown as ConversationFixture&{approvalsReads:number});
 expect(f.approvalsReads).toBe(3);expect(f.approveCalls??0).toBe(0);expect(f.composeCalls??0).toBe(0);expect(f.reviseCalls??0).toBe(0);
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=empty');
 await send(page,'what did I approve yesterday?');await expect(page.locator('[data-message-key]').last()).toContainText('You approved nothing yesterday.');
 await send(page,'what did I approve today?');await expect(page.locator('[data-approvals-history]').last()).toHaveAttribute('data-approvals-history','today');
 await expect(page.locator('[data-message-key]').last()).toContainText('You approved nothing today.');
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=approvals-unavailable');
 await send(page,'what did I approve yesterday?');await expect(page.locator('[data-message-key]').last()).toContainText('Your approvals history could not be read. Try again.');
});
test('name search opens one result and offers a choice or no result inline',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');const url=page.url();
 await send(page,'Open Mariam');await expect(conversation(page)).toBeVisible();
 await send(page,'Find Example');
 const last=page.locator('[data-message-key]').last();
 await expect(last.getByRole('button',{name:/Mariam Example/})).toBeVisible();
 await expect(last.getByRole('button',{name:/Ani Example/})).toBeVisible();
 await last.getByRole('button',{name:/Ani Example/}).click();
 await expect(page.locator('[data-conversation-member]').last()).toContainText('Ani Example');
 await send(page,'Find Nobody');await expect(page.locator('[data-message-key]').last()).toContainText(/No|no|could not find/);
 await unchanged(page,url);expect((await fixtureState(page)).searchReads).toBe(3);
});

test('conversation polling preserves a scrolled reader, appends once and has no overlap',async({page})=>{
 await page.clock.install();await openMariam(page,'?long');const url=page.url();
 await expect(conversation(page).locator('[data-entry-key]')).toHaveCount(30);
 await conversation(page).getByRole('button',{name:'Earlier messages',exact:true}).click();
 await expect(conversation(page).locator('[data-entry-key]')).toHaveCount(100);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;el.dispatchEvent(new Event('scroll'));});
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await page.evaluate(()=>{const f=(window as unknown as {fixture:FixtureState&ConversationFixture}).fixture;f.newMessage=true;f.holdRead=true;});
 await page.clock.runFor(60_000);await page.clock.runFor(60_000);
 expect((await fixtureState(page)).maxReadActive).toBe(1);
 await page.evaluate(()=>{const f=(window as unknown as {fixture:FixtureState&ConversationFixture}).fixture;f.holdRead=false;f.releaseRead?.();});
 await expect(page.getByText('A new message while you were reading.',{exact:true})).toHaveCount(1);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await page.clock.runFor(60_000);
 await expect(page.getByText('A new message while you were reading.',{exact:true})).toHaveCount(1);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 const geometry=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.querySelector('textarea')!).fontSize),scrollers:[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className)}));
 expect(geometry.font).toBeGreaterThanOrEqual(16);expect(geometry.scrollers).toEqual(['cv2-thread']);await unchanged(page,url);
});

for(const state of ['approve-stale','approve-failed','approve-unknown'])test(`approval failure is inline and never reports success: ${state}`,async({page})=>{
 await openMariam(page,`?state=${state}`);const url=page.url();await approve(page);
 const expected=state==='approve-stale'?'Not done, because this card has changed. Nothing was applied. Reload and review the current record.':state==='approve-unknown'?'Not done, because the outcome is not known. Reload and check the record before trying again.':'Not done, because the save failed. Reload and try again.';
 await expect(page.getByText(expected,{exact:true})).toBeVisible();
 await expect(page.getByText('Done: Reply approved and queued. Delivery is not yet confirmed.',{exact:true})).toHaveCount(0);
 expect((await fixtureState(page)).approveCalls).toBe(1);
 if(state==='approve-unknown'){await expect(conversation(page).getByRole('button',{name:/Send this reply/})).toBeDisabled();await expect(conversation(page).getByRole('button',{name:'Change',exact:true})).toBeDisabled();}
 await unchanged(page,url);
});

for(const state of ['save-stale','save-failed','save-unknown'])test(`save failure preserves the reply and never sends: ${state}`,async({page})=>{
 await openMariam(page,`?state=${state}`);const url=page.url();
 await conversation(page).getByRole('button',{name:'Change',exact:true}).click();
 await page.getByRole('textbox').fill('Keep this reply available after a failed save.');
 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(page.getByText('Done: Saved, not sent yet.',{exact:true})).toHaveCount(0);
 const expected=state==='save-stale'?'Not done, because this card has changed. Nothing was applied. Reload and review the current record.':state==='save-unknown'?'Not done, because the outcome is not known. Reload and check the record before trying again.':'Not done, because the save failed. Reload and try again.';
 await expect(page.getByRole('alert').filter({hasText:expected}).last()).toHaveText(expected);
 await expect(page.getByRole('textbox')).toHaveValue('Keep this reply available after a failed save.');
 await expect(page.getByText('Replying to Mariam Example',{exact:true})).toBeVisible();
 for(const send of await page.getByRole('button',{name:/Send this reply/}).all())await expect(send).toBeDisabled();
 expect((await fixtureState(page)).approveCalls).toBe(0);expect((await fixtureState(page)).reviseCalls).toBe(1);await unchanged(page,url);
});

test('lab rows, PDF sheet and individual reviews stay in the thread and preserve other edits',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);
 await send(page,'Who needs me');
 const rows=page.locator('.dcv2-who .dcv2-row');
 await expect(rows).toHaveCount(10);
 await expect(rows.nth(4)).toHaveAttribute('data-inbox-id','lab-attention');
 await expect(rows.nth(5)).toHaveAttribute('data-inbox-id','lab-sheet');
 await rows.nth(4).click();
 await expect(page.locator('.cv2-me').last()).toHaveText("Review Mariam Example's lab sheet");
 const lab=page.locator('[data-lab-file]');
 await expect(lab).toContainText('Doctor attention: lab marked it critical');
 await expect(lab.getByText('Open the PDF first, then review.',{exact:true})).toBeVisible();
 const values=lab.locator('li').filter({has:page.getByRole('button',{name:'Correct',exact:true})});
 await values.nth(1).getByRole('button',{name:'Correct',exact:true}).click();
 await lab.getByLabel('Correct value',{exact:true}).fill('139');
 await lab.getByLabel('Note (optional)',{exact:true}).fill('Keep this correction');
 await lab.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(lab.getByLabel('Correct value',{exact:true})).toHaveValue('139');
 await expect(lab.getByLabel('Note (optional)',{exact:true})).toHaveValue('Keep this correction');
 await expect(lab.getByLabel('Correct value',{exact:true})).toHaveCSS('font-size','16px');
 await unchanged(page,url);
 let pdfGets=0;
 await page.route('**/documents/*',async route=>{
  pdfGets++;
  // Synthetic audit of the local fixture GET. Production uses the unchanged audited route.
  await page.evaluate(()=>{(window as unknown as {fixture:FixtureState&LabFixture}).fixture.pdfOpened=true;});
  return route.fulfill(await fixture.respond(route.request().url()));
 });
 await lab.getByRole('button',{name:'Show page 2',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Lab PDF',exact:true});
 await expect(sheet).toBeVisible();await expect(sheet.locator('iframe')).toHaveAttribute('src',/\?page=2$/);
 await expect.poll(()=>pdfGets).toBe(1);await unchanged(page,url);
 await sheet.getByRole('button',{name:'Next',exact:true}).click();await expect(sheet.locator('iframe')).toHaveAttribute('src',/\?page=3$/);await expect(sheet.getByText('Page 3 of 3',{exact:true})).toBeVisible();await expect(sheet.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await expect.poll(()=>pdfGets).toBe(2);
 await page.screenshot({path:'/tmp/noreon-doctor-lab-pdf.png'});
 await sheet.getByRole('button',{name:'Close PDF',exact:true}).click();await expect(sheet).toHaveCount(0);
 // Open-first failure message remains in the edited value until its retry, but the block reminder clears.
 await expect(lab.getByText('Not done, because the action could not be completed. Open the PDF first, then review.',{exact:true})).toHaveCount(1);
 await expect(lab.getByLabel('Correct value',{exact:true})).toHaveValue('139');
 await lab.getByRole('button',{name:'Confirm',exact:true}).first().click();
 await expect(page.locator('.cv2-me').last()).toHaveText('Done: LDL 3.1 mmol/L confirmed');
 await expect(lab.getByLabel('Correct value',{exact:true})).toHaveValue('139');
 await expect(page.locator('[data-message-key]').last().getByLabel('Note (optional)',{exact:true})).toHaveValue('Keep this correction');
 await lab.getByRole('button',{name:'Save correction',exact:true}).click();
 await expect(page.locator('.cv2-me').last()).toHaveText('Done: Sodium corrected to 139 mmol/L');
 await lab.getByRole('button',{name:'Reject (does not apply)',exact:true}).click();
 await expect(page.locator('.cv2-me').last()).toHaveText('Done: ALT rejected');
 await expect(lab.getByText('All values on this sheet are reviewed.',{exact:true})).toHaveCount(1);
 await expect(lab.getByRole('button',{name:/^(Confirm|Correct|Reject \(does not apply\))$/})).toHaveCount(0);
 await expect(lab).toContainText('Nothing is released to the member here.');
 const commands=await page.evaluate(()=>(window as unknown as {fixture:LabFixture}).fixture.labCommands);
 expect(commands.map(c=>c.action)).toEqual(['correct','confirm','correct','reject']);
 expect(commands[0].submissionId).toBe(commands[2].submissionId);
 await unchanged(page,url);
 await page.screenshot({path:'/tmp/noreon-doctor-lab-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/noreon-doctor-lab-desktop.png'});
 const scrollers=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className));
 expect(scrollers).toEqual(['cv2-thread']);
});

async function openPlan(page:Page){
 await page.getByRole('button',{name:'Who needs me',exact:true}).click();
 expect(await page.locator('[data-inbox-id^="plan-"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-inbox-id')))).toEqual(['plan-second','plan-first']);
 await page.locator('[data-inbox-id="plan-second"]').click();
}
test('a saved plan with no AI draft is reachable from the member',async({page})=>{
 await openMariam(page);const url=page.url();
 await conversation(page).getByRole('button',{name:'Care plan',exact:true}).click();
 await expect(page.locator('.cv2-me').last()).toHaveText('Review Mariam Example\'s plan');
 await expect(page.locator('[data-plan-member]').last().locator('[data-decision="regimen"]')).toBeVisible();await unchanged(page,url);
});
const planState=(page:Page)=>page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').PlanFixture}).fixture);

test('plan block preserves the saved plan, explicit press and dialog order on phone and desktop',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);await openPlan(page);
 const block=page.locator('[data-plan-member]').last(),consultation=block.locator('[data-decision="consultation"]'),regimen=block.locator('[data-decision="regimen"]');
 await expect(regimen.getByText('Exact saved explanation')).toBeVisible();
 await expect(regimen.getByText('Exact saved care instructions')).toBeVisible();
 await expect(regimen.getByText('Exact saved follow-up')).toBeVisible();
 await expect(regimen.getByText('Previous dose').first()).toBeVisible();
 expect(await block.locator('[data-decision]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-decision')))).toEqual(['consultation','regimen']);
 expect((await planState(page)).planCommands).toEqual([]);await unchanged(page,url);
 expect(await consultation.getByRole('combobox').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 await expect(consultation.getByRole('combobox')).toHaveValue('');
 await expect(consultation.getByRole('textbox')).toHaveValue('');
 await consultation.getByRole('combobox').selectOption('not-required');await consultation.getByRole('textbox').fill('Doctor entered reason');
 await consultation.getByRole('button',{name:'Save consultation decision'}).click();
 await expect(consultation).toHaveCount(0);await expect(regimen).toHaveCount(1);
 await expect(page.locator('[data-message-key]').nth(-2)).toHaveText('Consultation not required');
 await expect(page.locator('[data-message-key]').last()).toHaveText('Done: Review saved. Reload the case before the next step.');
 await block.getByRole('button',{name:'Check again',exact:true}).click();
 const fresh=page.locator('[data-plan-member]').last(),plan=fresh.locator('[data-decision="regimen"]');
 await expect(fresh.locator('[data-decision="consultation"]')).toHaveCount(0);
 const approve=plan.getByRole('button',{name:'Approve and publish this plan'});
 await expect(approve).toBeDisabled();await expect(plan.getByRole('checkbox')).not.toBeChecked();
 await plan.getByRole('checkbox').check();await expect(approve).toBeDisabled();
 await plan.getByRole('textbox').fill('Exact doctor change summary');await expect(approve).toBeEnabled();
 await page.screenshot({path:'/tmp/noreon-plan-phone.png'});
 await page.setViewportSize({width:1280,height:800});await plan.scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/noreon-plan-desktop.png'});await unchanged(page,url);
 await approve.click();await expect(plan).toHaveCount(0);
 await expect(page.locator('[data-message-key]').nth(-2)).toHaveText('Plan approved and published');
 await expect(page.locator('[data-message-key]').last()).toHaveText('Done: Care plan published. Any notice depends on your member’s saved messaging consent.');
 const commands=(await planState(page)).planCommands;expect(commands.map(c=>c.kind)).toEqual(['consultation-decision','regimen']);
 expect(commands[1]).toMatchObject({approved:true,changeSummary:'Exact doctor change summary',regimenHash:'b'.repeat(32),context:{revision:4,evidenceToken:'a'.repeat(32)}});
 await unchanged(page,url);
});

for(const state of ['plan-refused','plan-unknown'])test(`plan ${state} freezes the used card and Check again appends a new block`,async({page})=>{
 const url=fixture.url+`/staff/real/doctor-chat-v2?state=${state}`;await page.goto(url);await openPlan(page);
 const old=page.locator('[data-plan-member]').first(),plan=old.locator('[data-decision="regimen"]');
 await plan.getByRole('checkbox').check();await plan.getByRole('textbox').fill('Retained change summary');
 await plan.getByRole('button',{name:'Approve and publish this plan'}).click();
 await expect(plan.getByRole('alert')).toHaveText(state==='plan-refused'?'Not done, because the action could not be completed. Not published: a required laboratory result has not been received yet.':'Not done, because the action could not be completed. The outcome is unknown. Reload and check the record before trying again.');
 await expect(plan.getByRole('button',{name:'Approve and publish this plan'})).toBeDisabled();
 await expect(plan.getByRole('textbox')).toHaveValue('Retained change summary');await expect(plan.getByRole('textbox')).toBeDisabled();
 await old.getByRole('button',{name:'Check again',exact:true}).click();
 await expect(page.locator('[data-plan-member]')).toHaveCount(2);
 expect((await planState(page)).planReads).toBe(2);expect((await planState(page)).planCommands).toHaveLength(1);
 await expect(page.locator('[data-message-key]').nth(-2)).toHaveText('Check again');
 await expect(page.locator('[data-message-key]').last().locator('[data-plan-member]')).toHaveCount(1);
 await expect(old.locator('[data-decision="regimen"]')).toHaveCount(1);await unchanged(page,url);
});

for(const [state,message] of [
 ['plan-ai-only','Zoe prepared a plan draft for Ani Example. It has not been saved as a plan yet.'],
 ['plan-off','Not done, because this action is switched off. Try again when it is available.'],
 ['plan-unavailable','Not done, because the plan cannot be approved in this chat yet. Check again before continuing.'],
 ['plan-access','Not done, because access is unavailable. Re-open the member to check access.'],
])test(`plan stop state ${state} stays a plain reply`,async({page})=>{
 const url=fixture.url+`/staff/real/doctor-chat-v2?state=${state}`;await page.goto(url);await openPlan(page);
 await expect(page.locator('[data-message-key]').last()).toContainText(message);
 await expect(page.locator('[data-decision]')).toHaveCount(0);expect((await planState(page)).planCommands).toEqual([]);await unchanged(page,url);
});


const aiPlanState=(page:Page)=>page.evaluate(()=>(window as unknown as {fixture:AiPlanFixture}).fixture);
const planBlock=(page:Page)=>page.locator('[data-plan-member]').last();
async function openAiPlan(page:Page,state='plan-ai-only',urgent=false){
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?history&state=${state}`);
 if(!urgent){
  await page.waitForFunction(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert);
  await page.evaluate(()=>{(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert!.alert.state='resolved';});
 }
 await openPlan(page);
 await expect(planBlock(page)).toBeVisible();
}
const aiExplanation=(page:Page)=>planBlock(page).locator('textarea[name="explanation"]');
const useAiDraft=(page:Page)=>planBlock(page).getByRole('button',{name:'Use this draft',exact:true});

test('answer-first alerts stay above the unchanged draft at 390 px and open the member conversation',async({page})=>{
 await page.setViewportSize({width:390,height:714});
 await openAiPlan(page,'plan-ai-only',true);const url=page.url(),block=planBlock(page),first=block.locator('.dcv2-answer-first');
 await first.scrollIntoViewIfNeeded();
 await expect(first.getByRole('heading',{name:'Answer these first',exact:true})).toBeVisible();
 await expect(first.locator('li')).toHaveCount(1);
 await expect(first).toContainText('Message matched the urgent word list');
 await expect(first.locator('time')).toHaveAttribute('datetime','2026-11-02T08:00:00Z');
 await expect(aiExplanation(page)).toHaveValue('AI explanation for review');
 await expect(useAiDraft(page)).toBeDisabled();
 const geometry=await block.evaluate(el=>{
  const first=el.querySelector('.dcv2-answer-first')!.getBoundingClientRect();
  const draft=el.querySelector('.dcv2-ai-plan')!.getBoundingClientRect();
  const form=el.querySelector('form')!.getBoundingClientRect();
  return {bottom:first.bottom,height:first.height,draftTop:draft.top,formTop:form.top,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 expect(geometry.height).toBeLessThan(220);expect(geometry.bottom).toBeLessThanOrEqual(geometry.draftTop);
 expect(geometry.bottom).toBeLessThanOrEqual(geometry.formTop);expect(geometry.overflow).toBe(false);
 await page.screenshot({path:'/tmp/noreon-answer-first-phone.png'});
 await page.setViewportSize({width:1280,height:800});await first.scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/noreon-answer-first-desktop.png'});
 await first.getByRole('button',{name:'Open conversation',exact:true}).click();
 await expect(page.locator('[data-conversation-member="d1a00000-0000-4000-8000-000000000001"]')).toBeVisible();
 await expect(page.locator('.cv2-me').last()).toHaveText('Open Ani Example');await unchanged(page,url);
});

test('a member without open alerts has no answer-first section',async({page})=>{
 await openMariam(page);await conversation(page).getByRole('button',{name:'Care plan',exact:true}).click();
 await expect(planBlock(page).locator('[data-decision="regimen"]')).toBeVisible();
 await expect(planBlock(page).locator('.dcv2-answer-first')).toHaveCount(0);
});

test('saved plan row opens approval without an AI inbox item or navigation',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');const url=page.url();
 await page.getByRole('button',{name:'Who needs me',exact:true}).click();
 const row=page.locator('[data-inbox-id^="saved-plan:"]');await expect(row).toHaveCount(1);
 await expect(row).toContainText('Member Example 1');
 expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await row.click();await expect(planBlock(page).locator('[data-decision="regimen"]')).toBeVisible();
 await expect(page.locator('.cv2-me').last()).toHaveText("Review Member Example 1's plan");await unchanged(page,url);
});

test('AI draft requires field review, saves guarded provenance and becomes a fresh approval at the end',async({page})=>{
 await openAiPlan(page);const url=page.url();
 await expect(aiExplanation(page)).toHaveValue('AI explanation for review');
 await expect(useAiDraft(page)).toBeDisabled();
 const block=planBlock(page),form=block.locator('form').filter({has:page.locator('textarea[name="explanation"]')});
 await expect(form.getByRole('button',{name:'Accept',exact:true})).toHaveCount(3);
 await form.getByRole('button',{name:'Accept',exact:true}).first().click();
 await block.locator('textarea[name="instructions"]').fill('Doctor edited care instructions');
 await form.getByRole('button',{name:'Reject',exact:true}).last().click();
 await expect(block.locator('textarea[name="followUp"]')).toHaveValue('');
 await expect(useAiDraft(page)).toBeEnabled();
 expect(await aiExplanation(page).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 await page.setViewportSize({width:1280,height:800});await expect(aiExplanation(page)).toBeVisible();
 await page.setViewportSize({width:402,height:714});
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=0;});
 await useAiDraft(page).click();
 await expect(aiExplanation(page)).toHaveCount(0);
 await expect(page.locator('[data-plan-member]')).toHaveCount(1);
 await expect(page.locator('[data-message-key]').nth(-2)).toHaveText('Use this draft');
 await expect(page.locator('[data-message-key]').last().locator('[data-plan-member]')).toHaveCount(1);
 await expect(planBlock(page).locator('[data-decision="regimen"]')).toContainText('Doctor edited care instructions');
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 const state=await aiPlanState(page);
 expect(state.aiPlanSaves).toHaveLength(1);
 expect(state.aiPlanSaves[0]).toMatchObject({id:'d1a00000-0000-4000-8000-000000000001',revision:'4',token:'a'.repeat(32),aiGeneration:'d6a00000-0000-4000-8000-000000000001',explanation:'AI explanation for review',instructions:'Doctor edited care instructions',followUp:''});
 expect(state.aiPlanAdoptions).toEqual([{id:'d6a00000-0000-4000-8000-000000000001',fields:['explanation','instructions']}]);
 expect(state.aiPlanReads).toBeGreaterThanOrEqual(2);
 expect((await planState(page)).planReads).toBeGreaterThanOrEqual(2);
 expect((await planState(page)).planCommands).toEqual([]);
 const scrollers=await page.evaluate(()=>[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className));
 expect(scrollers).toEqual(['cv2-thread']);await unchanged(page,url);
});

test('accept all is explicit and a stale AI draft cannot be saved before preparing again',async({page})=>{
 await openAiPlan(page,'plan-ai-stale');const url=page.url();
 await expect(useAiDraft(page)).toBeDisabled();
 await planBlock(page).getByRole('button',{name:'I checked all, accept all',exact:true}).click();
 await expect(useAiDraft(page)).toBeDisabled();
 expect((await aiPlanState(page)).aiPlanSaves).toEqual([]);
 await planBlock(page).getByRole('button',{name:'Prepare again',exact:true}).click();
 await expect.poll(async()=>(await aiPlanState(page)).aiPlanPrepares).toBe(1);
 await expect(page.locator('.cv2-me').last()).toHaveText('Prepare again');
 await expect(page.locator('[data-message-key]').last().locator('[data-plan-member]')).toHaveCount(1);
 await expect(page.locator('[data-plan-member]')).toHaveCount(1);await unchanged(page,url);
});

for(const state of ['plan-no-ai','plan-no-regimen'])test(`prepare care plan is reachable without a regimen approval: ${state}`,async({page})=>{
 await openAiPlan(page,state);const url=page.url();
 await expect(planBlock(page).locator('[data-decision="regimen"]')).toHaveCount(0);
 await page.evaluate(()=>{(window as unknown as {fixture:AiPlanFixture}).fixture.holdPrepare=true;});
 const key=await planBlock(page).locator('xpath=..').getAttribute('data-message-key');
 await planBlock(page).getByRole('button',{name:'Prepare care plan',exact:true}).click();
 await expect.poll(async()=>(await aiPlanState(page)).aiPlanPrepares).toBe(1);
 await expect(page.locator('[data-plan-member]')).toHaveCount(1);
 expect(await planBlock(page).locator('xpath=..').getAttribute('data-message-key')).toBe(key);
 await expect(planBlock(page).getByRole('button',{name:/Preparing/})).toBeDisabled();
 await page.evaluate(()=>{(window as unknown as {fixture:AiPlanFixture}).fixture.releasePrepare?.();});
 await expect(page.locator('.cv2-me').last()).toHaveText('Prepare care plan');
 await expect(page.locator('[data-message-key]').last().locator('[data-plan-member]')).toHaveCount(1);
 await expect(planBlock(page).getByRole('button',{name:'Prepare again',exact:true})).toBeVisible();
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await unchanged(page,url);
});

test('refused AI draft save retains doctor edits and reads current evidence without reporting success',async({page})=>{
 await openAiPlan(page,'plan-ai-save-refused');const url=page.url();
 await aiExplanation(page).fill('Keep this doctor explanation after refusal');
 await planBlock(page).getByRole('button',{name:'I checked all, accept all',exact:true}).click();
 await useAiDraft(page).click();
 await expect(aiExplanation(page)).toHaveValue('Keep this doctor explanation after refusal');
 await expect(planBlock(page).getByRole('alert').filter({hasText:/Source evidence changed/})).toBeVisible();
 await expect.poll(async()=>(await aiPlanState(page)).aiPlanReads).toBeGreaterThanOrEqual(2);
 await expect(useAiDraft(page)).toBeDisabled();
 expect((await aiPlanState(page)).aiPlanSaves).toHaveLength(1);
 expect((await aiPlanState(page)).aiPlanAdoptions).toEqual([]);
 expect((await planState(page)).planCommands).toEqual([]);
 await expect(page.locator('.cv2-me').filter({hasText:'Use this draft'})).toHaveCount(0);
 await unchanged(page,url);
});

test('upload queue opens the existing approval in-thread, preview and doctor turn precede the approved sentence',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);await send(page,'Who needs me');
 await page.locator('[data-upload-job]').click();
 const upload=page.locator('[data-upload-document]');await expect(upload).toBeVisible();
 await expect(upload).toContainText('Your check before the member sees it');
 await upload.getByRole('button',{name:'Open file',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'Member upload'});await expect(sheet).toBeVisible();
 await expect(sheet.locator('iframe')).toHaveAttribute('src',/member-uploads\/.*\?page=1$/);
 await sheet.getByRole('button',{name:'Next',exact:true}).click();await expect(sheet.locator('iframe')).toHaveAttribute('src',/page=2$/);
 await sheet.getByRole('button',{name:'Close file',exact:true}).click();
 await expect(upload.getByRole('textbox').first()).toHaveCSS('font-size','16px');
 await upload.getByRole('textbox',{name:'English',exact:true}).fill('Exact doctor text kept for the member.');
 await page.screenshot({path:'/tmp/noreon-upload-phone.png'});
 await page.setViewportSize({width:1280,height:800});await upload.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/noreon-upload-desktop.png'});
 await upload.getByRole('button',{name:'Approve and show to the member',exact:true}).click();
 await expect(upload).toHaveCount(0);await expect(page.locator('[data-upload-job]')).toHaveCount(0);
 await expect(page.locator('[data-message-key]').nth(-2)).toHaveText("Approved Mariam Example's upload");
 await expect(page.locator('[data-message-key]').last()).toHaveText('Done: Upload approved. The member sees the kept values and the text below.');
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await unchanged(page,url);
 const commands=await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').UploadFixture}).fixture.uploadCommands);
 expect(commands).toHaveLength(1);expect(commands[0].interpretationEn).toBe('Exact doctor text kept for the member.');
});

test('conversation Uploads opens inline and uncertain approval preserves the exact retry',async({page})=>{
 await openMariam(page,'?state=upload-approve-outcome-unknown');const url=page.url();
 await conversation(page).getByRole('button',{name:'Uploads',exact:true}).click();
 const upload=page.locator('[data-upload-document]');await expect(upload).toBeVisible();
 await upload.getByRole('textbox',{name:'English',exact:true}).fill('Retain this text.');
 const approve=upload.getByRole('button',{name:'Approve and show to the member',exact:true});await approve.click();
 await expect(upload.getByRole('alert')).toHaveText('Not done, because the action could not be completed. Not sure it was saved. Try again: a repeat is safe.');
 await expect(upload.getByRole('textbox',{name:'English',exact:true})).toHaveValue('Retain this text.');
 await approve.click();
 const commands=await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').UploadFixture}).fixture.uploadCommands);
 expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
 await expect(page.getByText("Approved Mariam Example's upload",{exact:true})).toHaveCount(0);await unchanged(page,url);
});

for(const state of ['upload-off','upload-access','upload-unavailable','upload-identity','upload-photo','upload-approve-stale'])test(`upload state ${state}`,async({page})=>{
 await openMariam(page,`?state=${state}`);const url=page.url();await conversation(page).getByRole('button',{name:'Uploads',exact:true}).click();
 const upload=page.locator('[data-upload-document]');
 if(state==='upload-identity'){await expect(upload).toContainText('Waiting for the member to say whether the sheet is theirs. You can approve after that.');await expect(upload.getByRole('button',{name:'Approve and show to the member',exact:true})).toHaveCount(0);}
 else if(state==='upload-photo'){await page.route('**/member-uploads/*',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+c7k8AAAAASUVORK5CYII=','base64')}));await upload.getByRole('button',{name:'Open file',exact:true}).click();await expect(page.getByRole('dialog').locator('img')).toBeVisible();await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0);}
 else if(state==='upload-approve-stale'){await upload.getByRole('button',{name:'Approve and show to the member',exact:true}).click();await expect(upload.getByRole('alert')).toHaveText('Not done, because the action could not be completed. This reading changed since you opened it. Reload the page.');await upload.getByRole('button',{name:'Reload',exact:true}).click();await expect(upload.getByRole('alert')).toHaveCount(0);}
 else {await expect(page.locator('[data-message-key]').last()).toContainText(state==='upload-access'?'Not done, because access is unavailable. Re-open the member to check access.':state==='upload-off'?'Not done, because this action is switched off. Try again when it is available.':'Not done, because the upload is unavailable. Reload to try again.');await expect(upload).toHaveCount(0);}
 await unchanged(page,url);
});
const commandState=(page:Page)=>page.evaluate(()=>(window as unknown as {fixture:FixtureState&ConversationFixture&import('../doctor-chat-v2/actions').AlertFixture}).fixture);
test('alert acknowledge stays visible, Other uses the composer and resolution retires controls',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const url=fixture.url+'/staff/real/doctor-chat-v2?history';await page.goto(url);await send(page,'Who needs me');
 const old=page.locator('.dcv2-alert-row').first();
 await old.getByRole('button',{name:'Acknowledge',exact:true}).click();
 await expect(old.getByRole('button',{name:'Acknowledge',exact:true})).toHaveCount(0);
 await expect(old.getByRole('button',{name:'Resolve',exact:true})).toHaveCount(0);
 await expect(page.getByText("Acknowledged Ani Example's alert",{exact:true})).toBeVisible();
 await expect(page.getByText('Done: Alert acknowledged. It stays in the list until you resolve it.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Acknowledge',exact:true})).toHaveCount(0);
 await expect.poll(()=>bottom(page)).toBeLessThan(4);
 await page.getByRole('button',{name:'Resolve',exact:true}).click();
 await page.getByRole('button',{name:'Other (see note)',exact:true}).click();
 await expect(page.getByRole('textbox')).toBeFocused();await expect(page.getByRole('textbox')).toHaveAttribute('maxlength','1000');
 expect((await commandState(page)).alertCommands).toHaveLength(1);
 await page.keyboard.insertText('Checked the current signal.');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.getByText("Resolved Ani Example's alert: Other (see note)",{exact:true})).toBeVisible();
 await expect(page.locator('[data-message-key]').last()).toHaveText('Done: Alert resolved.');
 await expect(page.getByRole('button',{name:'Resolve',exact:true})).toHaveCount(0);
 expect((await commandState(page)).alertCommands).toEqual([{press:'acknowledge',alertId:'a1a00000-0000-4000-8000-000000000001',seq:1},{press:'resolve',alertId:'a1a00000-0000-4000-8000-000000000001',seq:2,resolution:'other',note:'Checked the current signal.'}]);
 await unchanged(page,url);await page.screenshot({path:'/tmp/noreon-doctor-alert-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/noreon-doctor-alert-desktop.png'});
});
for(const state of ['alert-changed','alert-unknown','alert-resolved'])test(`alert ${state} reports current truth and requires a read before another press`,async({page})=>{
 const url=fixture.url+`/staff/real/doctor-chat-v2?state=${state}`;await page.goto(url);await send(page,'Who needs me');
 await page.getByRole('button',{name:'Acknowledge',exact:true}).click();
 await expect(page.getByRole('button',{name:'Acknowledge',exact:true})).toHaveCount(0);
 await expect(page.getByText('Done: Alert acknowledged. It stays in the list until you resolve it.',{exact:true})).toHaveCount(0);
 const reply=page.locator('[data-message-key]').last();
 await expect(reply).toContainText(state==='alert-changed'?'Not done, because this alert changed while you were looking at it, for example the member wrote again. Check it and try again.':state==='alert-resolved'?'Not done, because this alert is already resolved. Already resolved by':'Not done, because the outcome is not known. Reload and check the record before trying again.');
 if(state==='alert-resolved'){await expect(reply).toContainText('Doctor Earlier');await expect(reply.locator('time')).toHaveAttribute('datetime','2026-11-02T09:00:00Z');}
 else{await reply.getByRole('button',{name:'Check again',exact:true}).click();await expect(page.getByRole('button',{name:'Acknowledge',exact:true})).toBeVisible();expect((await commandState(page)).alertReads).toBe(1);}
 expect((await commandState(page)).alertCommands).toHaveLength(1);await unchanged(page,url);
});
for(const state of ['alert-changed','alert-unknown'])test(`${state} keeps an unsaved resolution note for the retry and resends nothing by itself`,async({page})=>{
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=${state}`);await send(page,'Who needs me');
 await page.getByRole('button',{name:'Resolve',exact:true}).click();await page.getByRole('button',{name:'Other (see note)',exact:true}).click();
 await page.keyboard.insertText('Exact unsaved note.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.locator('[data-message-key]').last().getByRole('button',{name:'Check again',exact:true}).click();
 expect((await commandState(page)).alertCommands).toHaveLength(1);
 await page.getByRole('button',{name:'Resolve',exact:true}).click();await page.getByRole('button',{name:'Other (see note)',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveValue('Exact unsaved note.');
 expect((await commandState(page)).alertCommands).toHaveLength(1);
});
test('reopened alert announces its new sequence without moving a scrolled reader',async({page})=>{
 await page.clock.install();await page.goto(fixture.url+'/staff/real/doctor-chat-v2?history');
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=650;el.dispatchEvent(new Event('scroll'));});
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await page.evaluate(()=>{(window as unknown as {fixture:FixtureState}).fixture.newAlert=true;});await page.clock.runFor(60_000);
 await expect(page.locator('[data-inbox-id="new-alert"]')).toHaveCount(1);
 await page.evaluate(()=>{const a=(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.pollAlert!.alert;a.state='acknowledged';a.stateSeq=2;});await page.clock.runFor(60_000);
 await expect(page.locator('[data-inbox-id="new-alert"]')).toHaveCount(1);
 await page.evaluate(()=>{const a=(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.pollAlert!.alert;a.state='open';a.stateSeq=3;});await page.clock.runFor(60_000);
 await expect(page.locator('[data-inbox-id="new-alert"]')).toHaveCount(2);await page.clock.runFor(60_000);await expect(page.locator('[data-inbox-id="new-alert"]')).toHaveCount(2);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
});
test('takeover offers hand-back here, confirms once and appends a fresh compact block',async({page})=>{
 await openMariam(page,'?history');const url=page.url();await approve(page);
 const block=conversation(page);await expect(block.getByRole('button',{name:'Hand back to Zoe',exact:true})).toBeVisible();
 await block.getByRole('button',{name:'Hand back to Zoe',exact:true}).click();
 await expect(block).toContainText('Zoe will answer again and a hand-back notice will be queued for this member.');
 expect((await commandState(page)).handBackCalls??0).toBe(0);
 await block.getByRole('button',{name:'Confirm hand-back',exact:true}).click();
 await expect(page.locator('[data-message-key].cv2-me').last()).toHaveText('Hand back to Zoe');
 await expect(page.getByText('Done: Zoe is answering again. The hand-back notice is queued; delivery is not confirmed.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Hand back to Zoe',exact:true})).toHaveCount(0);
 await expect(conversation(page).locator('h2')).toHaveCount(0);expect((await commandState(page)).handBackCalls).toBe(1);await unchanged(page,url);
});
for(const state of ['hand-disabled','hand-inactive','hand-changed','hand-unknown'])test(`hand-back ${state} preserves its existing outcome sentence`,async({page})=>{
 await openMariam(page,`?state=${state}`);const url=page.url(),block=conversation(page);
 if(state==='hand-disabled'){await expect(block).toContainText('Zoe is disabled or this member’s consent has been withdrawn. You are still answering.');await expect(block.getByRole('button',{name:'Hand back to Zoe',exact:true})).toHaveCount(0);}
 else{
  await block.getByRole('button',{name:'Hand back to Zoe',exact:true}).click();await block.getByRole('button',{name:'Confirm hand-back',exact:true}).click();
  await expect(page.getByText(state==='hand-inactive'?'Not done, because Zoe is disabled or this member’s consent has been withdrawn. You are still answering.':state==='hand-changed'?'Not done, because the conversation changed. Reload the conversation before continuing.':'Not done, because the result is unknown. Reload the conversation to check before making another change.',{exact:true})).toBeVisible();
  expect((await commandState(page)).handBackCalls).toBe(1);
 }
 await unchanged(page,url);
});

// Zoe uses the browser fetch seam; reply commands remain separate even for intent-shaped text.
const zoeState=(page:Page)=>page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/zoe').ZoeFixture&ConversationFixture}).fixture);
const asking=(page:Page)=>page.getByText('Asking Zoe about Mariam Example',{exact:true});
const privateAnswer=(page:Page)=>page.getByText("Zoe · read from Mariam Example's record. The member does not see this.",{exact:true});
async function selectZoe(page:Page,state=''){
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2'+(state?`?state=${state}`:''));
 await send(page,'Open Mariam');await expect(asking(page)).toBeVisible();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Ask Zoe about Mariam Example');
}
const noReplyWrites=async(page:Page)=>{const f=await fixtureState(page);expect([f.composeCalls??0,f.reviseCalls??0,f.approveCalls??0]).toEqual([0,0,0]);};

for(const locale of ['en','hy','ru'] as const)for(const theme of ['light','dark'] as const)test(`BP chart at 390px: ${locale}, ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:theme});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?history&locale=${locale}`);
 await page.getByRole('textbox').fill('Open Mariam');await page.locator('button[type="submit"]').click();
 await expect(page.locator('[data-conversation-member]')).toHaveCount(1);
 await page.getByRole('textbox').fill(locale==='hy'?'ճնշման գրաֆիկ':locale==='ru'?'график давления':'show his blood pressure chart');
 await page.locator('button[type="submit"]').click();
 const card=page.getByTestId('zoe-card-bp'),chart=card.getByRole('img'),table=card.getByRole('table');
 await expect(chart).toBeVisible();await expect(table).toBeVisible();await expect(table.getByRole('row')).toHaveCount(9);
 await expect(table).toContainText('00:05');await expect(table).toContainText('128/82');
 expect(await chart.locator('polyline').count()).toBe(2);
 const scroll=card.getByRole('region');
 expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});expect(await scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const bounds=await card.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
 const f=await zoeState(page);expect(f.zoeFetchCalls??[]).toHaveLength(0);expect(f.zoeOpenCalls??[]).toHaveLength(0);await noReplyWrites(page);
 await chart.scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/noreon-bp-${locale}-${theme}-390.png`});
 await page.setViewportSize({width:1280,height:900});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/noreon-bp-${locale}-${theme}-desktop.png`});
});

test('typed reply prefills verbatim without a model or reply save, then Save draft saves for exact-text approval',async({page})=>{
 const body='continue the same dose, see you in 2 weeks\nKeep  THIS punctuation: «yes».',request=`reply to him: ${body}`;
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');
 await send(page,request);
 await expect(page.getByText('Not done, because you have not selected a member. Open the member first, then type the reply.',{exact:true})).toBeVisible();
 expect((await fixtureState(page)).openReads??0).toBe(0);await noReplyWrites(page);
 expect((await zoeState(page)).zoeFetchCalls??[]).toHaveLength(0);

 await openMariam(page);const reads=(await fixtureState(page)).openReads;
 await send(page,request);
 await expect(page.getByRole('textbox')).toHaveValue(body);
 await expect(page.getByRole('textbox')).toBeFocused();
 await expect(page.getByText('Replying to Mariam Example',{exact:true})).toBeVisible();
 await expect(page.getByText('Done: Draft ready in the reply box. Nothing is sent yet: check the text, press Save draft, then Send this reply.',{exact:true})).toBeVisible();
 expect((await fixtureState(page)).openReads).toBe(reads+1);await noReplyWrites(page);
 expect((await zoeState(page)).zoeFetchCalls??[]).toHaveLength(0);

 await page.getByRole('button',{name:'Save draft',exact:true}).click();
 await expect(conversation(page).locator('[data-draft]')).toContainText('Done: Saved, not sent yet.');
 await expect(conversation(page).getByRole('button',{name:/Send this reply/})).toBeEnabled();
 await expect(page.getByText(body,{exact:true})).toHaveCount(1);
 await expect(page.getByRole('textbox')).toHaveValue('');
 const saved=await fixtureState(page);
 expect([saved.composeCalls,saved.reviseCalls,saved.approveCalls]).toEqual([0,1,0]);
 expect(saved.members[mariam].reply?.card?.body).toBe(body);
 expect((await zoeState(page)).zoeFetchCalls??[]).toHaveLength(0);
});

test('Zoe reads cards before a split answer and retains target with private labels and composer focus',async({page})=>{
 await selectZoe(page,'zoe-delayed');const url=page.url();
 await send(page,'What are the recorded blood pressure readings?');
 await expect(page.getByText('To Zoe',{exact:true})).toBeVisible();
 await expect(page.getByText('120/80 mmHg',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
 await expect(privateAnswer(page)).toBeVisible();await expect(page.getByRole('textbox')).toBeFocused();
 expect((await zoeState(page)).zoeFetchCalls).toEqual([expect.objectContaining({conversationId:'f1a00000-0000-4000-8000-000000000001',text:'What are the recorded blood pressure readings?',intent:null})]);
 await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/zoe').ZoeFixture}).fixture.releaseZoe?.());
 await expect(page.getByText('Recorded blood pressure: 120/80 mmHg',{exact:true})).toBeVisible();
 await expect(asking(page)).toBeVisible();await noReplyWrites(page);await unchanged(page,url);
 await page.screenshot({path:'/tmp/noreon-doctor-zoe-phone.png'});
 await page.setViewportSize({width:1280,height:800});await expect(asking(page)).toBeVisible();await page.screenshot({path:'/tmp/noreon-doctor-zoe-desktop.png'});
});

test('reply mode keeps intent-shaped text out of Zoe, then close returns to retained asking target',async({page})=>{
 await selectZoe(page);await conversation(page).getByRole('button',{name:'Change',exact:true}).click();
 await expect(page.getByText('Replying to Mariam Example',{exact:true})).toBeVisible();
 await send(page,'Who needs me');expect((await zoeState(page)).zoeFetchCalls).toEqual([]);
 expect((await fixtureState(page)).reviseCalls).toBe(1);expect((await fixtureState(page)).approveCalls).toBe(0);
 await conversation(page).getByRole('button',{name:'Change',exact:true}).click();
 await page.getByRole('button',{name:'Close reply',exact:true}).click();
 await expect(asking(page)).toBeVisible();await send(page,'What is recorded?');await expect(privateAnswer(page)).toBeVisible();
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);expect((await fixtureState(page)).reviseCalls).toBe(1);
});

test('Who needs me and search intents keep their own reads while bare names select the asking target',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');await send(page,'Who needs me');await expect(page.locator('.dcv2-who')).toBeVisible();
 await send(page,'Find Example');await expect(page.locator('[data-message-key]').last().getByRole('button',{name:/Mariam Example/})).toBeVisible();
 await send(page,'Mariam');await expect(asking(page)).toBeVisible();
 expect((await zoeState(page)).zoeFetchCalls).toEqual([]);await noReplyWrites(page);
});

for(const [question,fetches] of [['What is recorded for Mariam Example?',1],['What is recorded for Mariam and Ani?',0],['What is recorded?',0]] as const)test(`without a target: ${question}`,async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');await send(page,question);
 if(fetches){await expect(privateAnswer(page)).toBeVisible();await expect(asking(page)).toBeVisible();}
 else{await expect(page.locator('[data-message-key]').last()).toContainText(/member|Who|who|one|choose|Choose/);await expect(asking(page)).toHaveCount(0);}
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(fetches);expect((await zoeState(page)).zoeQuestionCalls).toEqual([question]);await noReplyWrites(page);
});

for(const code of ['access','off','busy','replayed','invalid','unavailable'])test(`Zoe ${code} refuses inline and releases composer without writing replies`,async({page})=>{
 await selectZoe(page,`zoe-refused-${code}`);await send(page,'What is recorded?');
 await expect(page.locator('[data-message-key]').last()).toContainText(/access|permission|off|busy|progress|already|again|unavailable|try|question|request|sent|enabled/i);
 await page.getByRole('textbox').fill('A follow-up');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);await noReplyWrites(page);
});
for(const state of ['zoe-held','zoe-fetch-thrown'])test(`${state} reports its outcome and retains target`,async({page})=>{
 await selectZoe(page,state);await send(page,'What is recorded?');
 await expect(page.locator('[data-message-key]').last()).toContainText(state==='zoe-held'?'The answer was held. Read the recorded evidence below.':/could not|unavailable|try again/i);
 await expect(asking(page)).toBeVisible();await noReplyWrites(page);
});

test('answer arrival preserves a scrolled reader and offers New message',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?history&state=zoe-delayed');await send(page,'Open Mariam');await send(page,'What is recorded?');
 await expect(page.getByText('120/80 mmHg',{exact:true})).toBeVisible();
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=500;el.dispatchEvent(new Event('scroll'));});
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/zoe').ZoeFixture}).fixture.releaseZoe?.());
 await expect(page.getByText('Recorded blood pressure: 120/80 mmHg',{exact:true})).toHaveCount(1);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New message',exact:true}).click();await expect.poll(()=>bottom(page)).toBeLessThan(4);
});

test('saved Zoe history shows chronological questions with saved times and restores last target',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=zoe-history');
 await expect(page.getByText('Saved question 18',{exact:true})).toBeVisible();
 const questions=await page.locator('[data-message-key].cv2-me').allTextContents();
 expect(questions.map(text=>text.match(/Saved question \d+/)?.[0])).toEqual(Array.from({length:10},(_,i)=>`Saved question ${i*2}`));
 await expect(page.locator('[data-message-key]').filter({hasText:'Saved question 18'}).locator('time')).toHaveAttribute('datetime','2026-11-02T06:18:00.000Z');
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Ask Zoe about Member Example 1');
 expect((await zoeState(page)).zoeFetchCalls).toEqual([]);expect((await zoeState(page)).zoeHistoryReads).toBe(1);
});
test('failed Zoe history is explicit and ordinary work remains available',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=zoe-history-failed');
 await expect(page.getByText('Earlier answers could not be loaded.',{exact:true})).toBeVisible();
 await send(page,'Who needs me');await expect(page.locator('.dcv2-who')).toBeVisible();expect((await zoeState(page)).zoeFetchCalls).toEqual([]);
});
test('clear member removes the asking target and follow-up needs an explicit member again',async({page})=>{
 await selectZoe(page);await page.getByRole('button',{name:'Clear member',exact:true}).click();
 await expect(asking(page)).toHaveCount(0);await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Ask Zoe…');await expect(page.getByRole('textbox')).toBeFocused();
 await send(page,'What is recorded?');expect((await zoeState(page)).zoeFetchCalls).toEqual([]);await noReplyWrites(page);
});
test('selected target does not intercept waiting-list or explicit search intents',async({page})=>{
 await selectZoe(page);await send(page,'Who needs me');await expect(page.locator('.dcv2-who')).toBeVisible();
 await send(page,'Find Example');await expect(page.locator('[data-message-key]').last().getByRole('button',{name:/Ani Example/})).toBeVisible();
 expect((await zoeState(page)).zoeFetchCalls).toEqual([]);await noReplyWrites(page);
});

test('a second question about the same member is refused while the first stream is pending',async({page})=>{
 await selectZoe(page,'zoe-delayed');await send(page,'What is recorded?');await expect(page.getByTestId('zoe-card-bp')).toBeVisible();
 await send(page,'What are the latest readings?');await expect(page.locator('[data-message-key]').last()).toContainText('Zoe is still on your last question.');
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);await noReplyWrites(page);
 await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/zoe').ZoeFixture}).fixture.releaseZoe?.());
 await expect(page.getByText('Recorded blood pressure: 120/80 mmHg',{exact:true})).toBeVisible();
});


for(const restored of [false,true])test(`${restored?'restored':'selected'} target resolves a named member and holds an uncertain question until a single choice`,async({page})=>{
 if(restored)await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=zoe-history');else await selectZoe(page);
 const current=restored?'d1a00000-0000-4000-8000-000000000003':'d1a00000-0000-4000-8000-000000000002';
 await send(page,'What is recorded?');await expect.poll(async()=>(await zoeState(page)).zoeFetchCalls.length).toBe(1);
 expect((await zoeState(page)).zoeQuestionTargets.at(-1)).toBe(current);
 await send(page,'What is recorded for Ani Example?');
 await expect(page.getByText('Asking Zoe about Ani Example',{exact:true})).toBeVisible();
 await expect(page.locator('.dcv2-zoe-label').last()).toHaveText("Zoe · read from Ani Example's record. The member does not see this.");
 if(!restored){expect((await zoeState(page)).zoeOpenCalls.at(-1)).toBe('d1a00000-0000-4000-8000-000000000001');expect((await zoeState(page)).zoeFetchCalls.at(-1)?.conversationId).toBe('f1a00000-0000-4000-8000-000000000003');}
 const opensBefore=(await zoeState(page)).zoeOpenCalls.length;
 const question='What is recorded for Mariam and Ani?';await send(page,question);
 const list=page.locator('[data-message-key]').last();await expect(list).toContainText('Which member do you mean?');
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(2);
 expect((await zoeState(page)).zoeOpenCalls).toHaveLength(opensBefore);
 const key=await list.getAttribute('data-message-key'),choice=list.getByRole('button',{name:'Mariam Example',exact:true});
 expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await choice.click();await expect(page.locator('[data-message-key].cv2-me').last()).toContainText('Ask about Mariam Example');
 await expect(page.locator(`[data-message-key="${key}"]`).getByRole('button')).toHaveCount(0);
 await expect(asking(page)).toBeVisible();await expect(page.locator('.dcv2-zoe-label').last()).toHaveText("Zoe · read from Mariam Example's record. The member does not see this.");
 const calls=(await zoeState(page)).zoeFetchCalls;expect(calls).toHaveLength(3);expect(calls.filter(call=>call.text===question)).toHaveLength(1);
 expect(calls.at(-1)?.conversationId).toBe('f1a00000-0000-4000-8000-000000000001');
 await expect(page.getByRole('textbox')).toBeFocused();await noReplyWrites(page);
 await page.screenshot({path:`/tmp/noreon-za-${restored?'restored':'selected'}-phone.png`});
 await page.setViewportSize({width:1280,height:800});await expect(asking(page)).toBeVisible();await page.screenshot({path:`/tmp/noreon-za-${restored?'restored':'selected'}-desktop.png`});
});
for(const restored of [false,true])for(const state of ['zoe-question-ambiguous','zoe-question-invalid','zoe-question-failed'])test(`${restored?'restored':'selected'} target fails closed on ${state}`,async({page})=>{
 if(restored)await page.goto(fixture.url+'/staff/real/doctor-chat-v2?state=zoe-history');else await selectZoe(page);
 await page.evaluate(state=>{(window as unknown as {fixture:{state:string}}).fixture.state=state;},state);
 await send(page,'What is recorded for Ani?');await expect(page.locator('[data-message-key]').last()).toContainText("I read one member's record at a time. Who do you mean?");
 expect((await zoeState(page)).zoeFetchCalls).toEqual([]);expect((await zoeState(page)).zoeOpenCalls).toEqual([]);
});
for(const [locale,prompt,label] of [['en','Which member do you mean?','Ask about Ani Example'],['hy','Ո՞ր անդամին նկատի ունեք։','Հարցնել Ani Example-ի մասին'],['ru','Какого участника вы имеете в виду?','Спросить об участнике Ani Example']] as const)test(`member choice holds the question in ${locale}`,async({page})=>{
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`);
 await page.getByRole('textbox').fill('What is recorded for Ani?');await page.locator('footer button[type=submit]').click();
 const list=page.locator('[data-message-key]').last();await expect(list).toContainText(prompt);expect((await zoeState(page)).zoeFetchCalls).toEqual([]);
 const key=await list.getAttribute('data-message-key');await list.getByRole('button',{name:'Ani Example',exact:true}).click();
 await expect(page.locator('[data-message-key].cv2-me').last()).toContainText(label);
 await expect(page.locator(`[data-message-key="${key}"]`).getByRole('button')).toHaveCount(0);
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);expect((await zoeState(page)).zoeFetchCalls[0].text).toBe('What is recorded for Ani?');
 await expect(page.getByRole('textbox')).toBeFocused();
});

test('reviewed lipids, SCORE2 dialog turn and report approval stay in the chat',async({page})=>{
 const url=fixture.url+'/staff/real/doctor-chat-v2?state=results&history';await page.goto(url);
 await send(page,'Mariam');
 const results=page.getByRole('region',{name:'Results and report',exact:true});
 await expect(results).toBeVisible();await expect(results).toContainText('3.3 mmol/L');
 await expect(results).toContainText('No category can be assigned');
 const report=results.locator('.dcv2-full-report');await expect(report).not.toHaveAttribute('open','');
 await expect(results.getByRole('checkbox')).not.toBeVisible();
 const score=results.locator('form').filter({has:page.getByText('SCORE2 (%)',{exact:true})});
 await score.locator('input[inputmode=decimal]').fill('6');await score.getByLabel('Observation date',{exact:true}).fill('2026-11-02');
 // Act on an older block after another turn, then require the doctor's words and reply at the end.
 await send(page,'What happens next?');
 await score.getByRole('button',{name:'Save result',exact:true}).click();
 const turns=page.locator('[data-message-key]');
 await expect(turns.nth(-2)).toHaveClass(/cv2-me/);await expect(turns.nth(-2)).toContainText('SCORE2 6%, 2 Nov');
 await expect(turns.last().locator('.dcv2-results')).toHaveCount(1);await expect(page.locator('.dcv2-results')).toHaveCount(1);
 await expect(results.locator('dl.dcv2-results-facts > div').filter({has:page.getByText('Risk category',{exact:true})})).toContainText('High');await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await report.getByText('Review full report',{exact:true}).click();
 await expect(results.getByRole('checkbox')).toBeVisible();
 await results.getByRole('checkbox').check();await results.getByRole('button',{name:'Approve this report',exact:true}).click();
 await expect(results).toHaveCount(0);await expect(turns.last()).toHaveText('Done: Report version 1 approved. Nothing was sent.');
 const state=await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').ResultsFixture}).fixture);
 expect(state.resultSaves).toBe(1);expect(state.reportApprovals).toBe(1);await unchanged(page,url);
});


for(const [locale,planAsk,resultAsk,missingPlan,missingResults,prepare,review] of [
 ['en','show him the plan','show results for this member','No plan is published for Mariam Example yet.','Mariam Example has no results yet.','Prepare care plan','Review upload'],
 ['hy','ցույց տուր պլանը','ցույց տուր նրա արդյունքները','Mariam Example-ի համար պլան դեռ հրապարակված չէ։','Mariam Example-ի արդյունքները դեռ չկան։','Պատրաստել խնամքի պլան','Վերանայել վերբեռնումը'],
 ['ru','покажи его план','покажи его результаты','Для Mariam Example пока нет опубликованного плана.','Результатов Mariam Example пока нет.','Подготовить план ухода','Проверить файл'],
] as const){
 const type=async(page:Page,text:string)=>{await page.getByRole('textbox').fill(text);await page.locator('footer button[type=submit]').click();};
 test(`typed missing plan gives a reason and existing next action in ${locale}`,async({page})=>{
  const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}&state=plan-no-ai`;await page.goto(url);
  await type(page,'Open Mariam');await expect(page.locator('[data-conversation-member]')).toBeVisible();
  await type(page,planAsk);const plan=page.locator('[data-plan-member]');
  await expect(plan).toContainText(missingPlan);await expect(plan.getByRole('button',{name:prepare,exact:true})).toBeVisible();
  expect((await zoeState(page)).zoeFetchCalls).toEqual([]);expect((await planState(page)).planCommands).toEqual([]);
  const state=await page.evaluate(()=>(window as unknown as {fixture:AiPlanFixture}).fixture);
  expect(state.aiPlanPrepares).toBe(0);expect(state.aiPlanSaves).toEqual([]);await noReplyWrites(page);await unchanged(page,url);
 });
 test(`typed missing and present results stay local in ${locale}`,async({page})=>{
  const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}&state=results-none&history`;await page.goto(url);
  await type(page,'Open Mariam');await expect(page.locator('[data-conversation-member]')).toBeVisible();
  await type(page,resultAsk);const empty=page.locator('[data-message-key]').last();
  await expect(empty).toContainText(missingResults);await expect(empty.getByRole('button',{name:review,exact:true})).toBeVisible();
  await expect(page.locator('[data-testid="zoe-answer"]')).toHaveCount(0);await expect(page.locator('.dcv2-results')).toHaveCount(0);
  await page.getByRole('textbox').focus();await page.screenshot({path:`/tmp/noreon-empty-results-${locale}-phone.png`});
  await page.setViewportSize({width:1280,height:800});await expect(empty).toBeVisible();await page.screenshot({path:`/tmp/noreon-empty-results-${locale}-desktop.png`});
  await page.evaluate(()=>{(window as unknown as {fixture:{state:string}}).fixture.state='results';});
  await type(page,resultAsk);await expect(page.locator('.dcv2-results')).toContainText('3.3 mmol/L');
  expect((await zoeState(page)).zoeFetchCalls).toEqual([]);
  const state=await page.evaluate(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').ResultsFixture}).fixture);
  expect([state.resultSaves,state.reportApprovals]).toEqual([0,0]);await noReplyWrites(page);await unchanged(page,url);
 });
}

test('plain chat gets fixed words with and without a member open, with no Zoe call',async({page})=>{
 await page.goto(fixture.url+'/staff/real/doctor-chat-v2');
 await send(page,'hello');
 await expect(page.getByText('Hello. I am here and ready.',{exact:true})).toBeVisible();
 await send(page,'What can you do?');
 await expect(page.getByText(/I never approve, send or change anything myself/)).toBeVisible();
 await expect(page.getByText('Try: “Who needs me”, “What did I approve yesterday” or “Show Anna”.',{exact:true}).last()).toBeVisible();
 await expect(page.getByText('What you asked is not in what I read.')).toHaveCount(0);
 await selectZoe(page);
 await send(page,'can you talk?');
 await expect(page.getByText('Yes, I am here and I can talk.',{exact:true})).toBeVisible();
 await expect(page.getByText('What you asked is not in what I read.')).toHaveCount(0);
 expect((await zoeState(page)).zoeFetchCalls??[]).toHaveLength(0);await noReplyWrites(page);
});

for(const locale of ['en','hy','ru'] as const)test(`alert cards show five readable lines at phone and desktop sizes (${locale})`,async({page})=>{
 const url=fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`;await page.goto(url);
 await page.setViewportSize({width:390,height:844});
 // Typed entry exercises the real local waiting-list journey in every locale.
 const input=page.locator('.cv2-composer textarea');
 await input.fill('Who needs me');await page.locator('.cv2-composer button[type=submit]').click();
 const card=page.locator('[data-alert-card]').first();await expect(card).toBeVisible();
 await expect(card.locator('[data-alert-field]')).toHaveCount(5);
 await expect(card).not.toContainText(/RF-\d|_|care_alert|NRN|zoe\.|rule/i);
 for(const width of [390,1280]){
  await page.setViewportSize({width,height:844});await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  for(const line of await card.locator('[data-alert-field]').all())await expect(line).toBeVisible();
  await page.screenshot({path:`/tmp/noreon-alert-card-${locale}-${width}.png`});
 }
 await expect(page).toHaveURL(url);
});

for(const locale of ['en','hy','ru'] as const)test(`Fresh-eyes consultation refresh keeps edits and targets its own card in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=plan-consultation-stale&locale=${locale}`);
 await page.waitForFunction(()=>(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert);
 await page.evaluate(()=>{(window as unknown as {fixture:import('../doctor-chat-v2/actions').AlertFixture}).fixture.alert!.alert.state='resolved';});
 const t=(en:string,hy:string,ru:string)=>locale==='en'?en:locale==='hy'?hy:ru;
 await page.getByRole('button',{name:t('Who needs me','Ո՞ւմ է պետք իմ օգնությունը','Кому нужна моя помощь'),exact:true}).click();
 await page.locator('[data-inbox-id="plan-second"]').click();
 const block=planBlock(page),regimen=block.locator('[data-decision="regimen"]');
 await regimen.getByRole('button',{name:t('Record whether a consultation is needed','Գրանցեք՝ արդյոք խորհրդատվություն անհրաժեշտ է','Укажите, нужна ли консультация'),exact:true}).click();
 const consultation=block.locator('[data-decision="consultation"]');
 await expect(consultation.getByRole('combobox')).toBeFocused();
 await consultation.getByRole('combobox').selectOption('not-required');
 await consultation.getByRole('textbox').fill('Doctor reason');
 await consultation.getByRole('button',{name:t('Save consultation decision','Պահպանել խորհրդատվության որոշումը','Сохранить решение о консультации'),exact:true}).click();
 const notice=t('The draft is out of date because the consultation decision changed.','Սևագիրը հնացել է, քանի որ խորհրդատվության որոշումը փոխվել է։','Черновик устарел, потому что решение о консультации изменилось.');
 await expect(regimen).toContainText(notice);
 await block.locator('textarea[name="instructions"]').fill('Older card edits');
 await block.getByRole('button',{name:t('Check again','Ստուգել կրկին','Проверить снова'),exact:true}).click();
 const newest=planBlock(page);
 await expect(page.locator('[data-plan-member]')).toHaveCount(2);
 await newest.locator('textarea[name="instructions"]').fill('Newest card edits');
 const refresh=newest.getByRole('button',{name:t('Refresh draft','Թարմացնել սևագիրը','Обновить черновик'),exact:true});
 await expect(refresh).toHaveCount(1);
 expect(await refresh.evaluate(button=>(button as HTMLButtonElement).form===button.closest('[data-plan-member]')?.querySelector('form.dcv2-draft'))).toBe(true);
 expect(await page.locator('form.dcv2-draft').evaluateAll(forms=>new Set(forms.map(f=>f.id)).size)).toBe(2);
 await refresh.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/publish-stale-${locale}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});await refresh.scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/publish-stale-${locale}-desktop.png`,fullPage:true});
 await refresh.click();
 await expect(newest.locator('[data-decision="regimen"]')).toContainText('Newest card edits');
 await expect(newest).not.toContainText(notice);
 const saved=await aiPlanState(page);expect(saved.aiPlanSaves).toHaveLength(1);expect(saved.aiPlanSaves[0].instructions).toBe('Newest card edits');
 expect((await planState(page)).planCommands.filter(c=>c.kind==='regimen')).toHaveLength(0);
 const publish=newest.getByRole('button',{name:t('Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план'),exact:true});
 await expect(publish).toBeDisabled();
 const text=await newest.innerText();expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|revision|d5a00000/i);
});

for(const width of [390,1280])for(const locale of ['en','hy','ru'] as const)test(`same-name identity choices and sticky switch banner (${locale}, ${width})`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:800});
 const url=fixture.url+`/staff/real/doctor-chat-v2?state=identity-same-name&locale=${locale}&history`;
 await page.goto(url);
 const browse=async()=>{
  await page.getByRole('textbox').fill('Find Same Name');
  await page.locator('footer button[type=submit]').click();
  const choices=page.locator('[data-member-disambiguation]').last();
  await expect(choices.getByRole('button')).toHaveCount(2);
  await expect(choices).toContainText('6');await expect(choices).toContainText('1986');await expect(choices).toContainText('1992');
  await expect(choices).toContainText('Linked identity clinic');await expect(choices).toContainText('+37499123456');
  await expect(choices).toContainText('00000002');await expect(choices).toContainText('00000003');
  return choices;
 };
 const first=await browse();expect((await fixtureState(page)).openReads).toBe(0);
 await first.getByRole('button').first().click();
 const banner=page.locator('footer [data-current-member]');
 await expect(banner).toHaveAttribute('data-current-member','d1a00000-0000-4000-8000-000000000002');
 await expect(banner).toContainText('1986');await expect(banner).toContainText('00000002');
 const header=page.locator('.dcv2-member-header').last();
 await expect(header).toContainText('Linked identity clinic');
 await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=0;});
 await expect(banner).toBeVisible();
 const second=await browse();expect((await fixtureState(page)).openReads).toBe(1);
 await second.getByRole('button').last().click();
 await expect(banner).toHaveAttribute('data-current-member','d1a00000-0000-4000-8000-000000000003');
 await expect(banner).toContainText('1992');await expect(banner).toContainText('00000003');await expect(banner).not.toContainText('00000002');
 await expect(page.locator('.dcv2-member-header').last()).toContainText('1992');
 expect((await fixtureState(page)).openReads).toBe(2);
 await page.screenshot({path:`/tmp/noreon-identity-switch-${locale}-${width}.png`});
 await unchanged(page,url);
});

for(const locale of ['en','hy','ru'] as const)for(const width of [390,1280])test(`Known other work has no unavailable banner in ${locale} at ${width} px`,async({page})=>{
 await page.setViewportSize({width,height:844});
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?locale=${locale}`);
 const label={en:'Who needs me',hy:'Ո՞ւմ է պետք իմ օգնությունը',ru:'Кому нужна моя помощь'}[locale];
 await page.getByRole('button',{name:label,exact:true}).click();
 const answer=page.locator('.dcv2-who');
 await expect(answer).toBeVisible();await expect(answer.getByRole('alert')).toHaveCount(0);
 const line={en:'Also waiting: 3 other items (first notes, medicine questions, hand-overs).',hy:'Նաև սպասում են՝ 3 այլ գործ (առաջին գրառումներ, դեղերի մասին հարցեր, փոխանցումներ)։',ru:'Также ожидают: 3 другие записи (первые сообщения, вопросы о лекарствах, передачи).'}[locale];
 await expect(answer.getByText(line,{exact:true})).toBeVisible();
 await page.screenshot({path:`/tmp/others-rest-${locale}-${width}.png`,fullPage:true});
});

for(const [state,clicks] of [['lab-all-auto',1],['lab-two-eyes',3]] as const)test(`lab row to reviewed: ${state}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 // Model the audited document GET, so the real controls can confirm after the inline PDF loads.
 await page.route('**/documents/*',async route=>{
  await page.evaluate(()=>{(window as unknown as {fixture:LabFixture}).fixture.pdfOpened=true;});
  return route.fulfill(await fixture.respond(route.request().url()));
 });
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?state=${state}`);
 await page.getByRole('button',{name:'Who needs me',exact:true}).click();
 const row=page.locator('[data-inbox-id="lab-attention"]');await row.click();
 const link=await page.evaluate(()=>(window as unknown as {fixture:{navigations:string[]}}).fixture.navigations.at(-1));
 expect(link).toMatch(/^\/staff\/real\/doctor-chat-v2\/patient\/[\da-f-]+\?lab=[\da-f-]+$/);
 // Fixture router records navigation; the real server page's access validation is covered in the mounted suite.
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=${state}&lab=${link!.split('?lab=')[1]}`);
 const card=page.locator('[data-lab-file]');await expect(card).toBeVisible();
 await expect(card.getByText('Open the PDF first, then review.',{exact:true})).toHaveCount(0);
 await expect(card.getByRole('button',{name:'This PDF belongs to this member',exact:true})).toHaveCount(0);
 const auto=card.locator('details').filter({has:page.locator('summary',{hasText:'Unflagged values confirmed by the rules'})});
 await expect(auto).not.toHaveAttribute('open');
 const values=card.locator('section').filter({has:page.getByRole('heading',{name:'Values',exact:true})});
 const ldl=values.locator('li').filter({has:page.getByText('LDL',{exact:true})});
 await expect(ldl).toBeVisible();await expect(ldl).toContainText('Critical');
 await expect(auto.getByText('LDL',{exact:true})).toHaveCount(0);
 await expect(values.locator('li').filter({has:page.locator('button')}).first()).toContainText('LDL');
 await expect(auto.locator('summary')).toHaveText(`Unflagged values confirmed by the rules (${state==='lab-all-auto'?2:1})`);
 if(state==='lab-all-auto')await expect(ldl).toContainText('AI-read · not checked by a doctor');
 let count=1;
 if(state==='lab-two-eyes'){
  const confirm=card.getByRole('button',{name:'Confirm',exact:true});
  await confirm.first().click();count++;
  await confirm.first().click();count++;
 }
 await expect(card.getByText('All values on this sheet are reviewed.',{exact:true})).toBeVisible();
 expect(count).toBe(clicks);
 await page.screenshot({path:`/tmp/lab-confirm-${state}-mobile.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.setViewportSize({width:1280,height:900});
 await card.getByText('All values on this sheet are reviewed.',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`/tmp/lab-confirm-${state}-desktop.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const locale of ['en','hy','ru'] as const)test(`bulk lab confirm retains expanded list in ${locale}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/documents/*',async route=>{
  await page.evaluate(()=>{(window as unknown as {fixture:LabFixture}).fixture.pdfOpened=true;});
  return route.fulfill(await fixture.respond(route.request().url()));
 });
 await page.goto(fixture.url+`/staff/real/doctor-chat-v2?patient&state=lab-bulk&locale=${locale}&lab=e1a00000-0000-4000-8000-000000000001`);
 const card=page.locator('[data-lab-file]'),auto=card.locator('details');
 await expect(auto).toBeVisible();await auto.locator('summary').click();await expect(auto).toHaveAttribute('open','');
 const label={en:'Confirm all 2 that pass the rules',hy:'Հաստատել կանոններին համապատասխանող բոլոր 2 արժեքները',ru:'Подтвердить все 2 показателя, прошедшие правила'}[locale];
 const confirm=card.getByRole('button',{name:label,exact:true});await expect(confirm).toBeVisible();
 await page.screenshot({path:`/tmp/noreon-bulk-${locale}-phone-before.png`,fullPage:true});
 await confirm.click();
 const retry=card.getByRole('button',{name:{en:'Check again',hy:'Կրկին ստուգել',ru:'Проверить ещё раз'}[locale],exact:true});
 await expect(retry).toBeVisible();await expect(auto).toHaveAttribute('open','');await retry.click();
 await expect(card.getByText({en:'Already saved. 2 confirmed. 2 still need you.',hy:'Արդեն պահպանված է։ 2 արժեք հաստատված է։ 2 արժեքի համար դեռ ձեր ստուգումն է պետք։',ru:'Уже сохранено. Подтверждено: 2. Ещё требуют вашей проверки: 2.'}[locale],{exact:true})).toBeVisible();
 await expect(confirm).toHaveCount(0);await expect(auto).toHaveAttribute('open','');
 await expect(card.locator('[data-reviewed-value]')).toHaveCount(2);
 const state=await page.evaluate(()=>(window as unknown as {fixture:LabFixture}).fixture);
 expect(state.bulkCommands).toHaveLength(2);expect(state.bulkCommands[0]).toEqual(state.bulkCommands[1]);expect(state.labCommands).toHaveLength(0);
 expect(state.lab.values[0].status).toBe('unverified');expect(state.lab.values[4].status).toBe('unverified');
 // The remaining flagged row rejects immediately, without a note or another dialog.
 await card.getByRole('button',{name:{en:'Reject (does not apply)',hy:'Մերժել (կիրառելի չէ)',ru:'Отклонить (не относится)'}[locale],exact:true}).first().click();
 await expect(auto).toHaveAttribute('open','');
 expect(await page.evaluate(()=>(window as unknown as {fixture:LabFixture}).fixture.labCommands.map(c=>({action:c.action,note:c.note})))).toEqual([{action:'reject',note:undefined}]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/noreon-bulk-${locale}-phone-after.png`,fullPage:true});
 await page.setViewportSize({width:1280,height:900});await auto.scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/noreon-bulk-${locale}-desktop.png`,fullPage:true});
});
