import {test,expect,type Page} from '@playwright/test';
import {startNurseChatFixture} from '../nurse-chat-v2/server.mjs';

let fixture:Awaited<ReturnType<typeof startNurseChatFixture>>;
test.use({viewport:{width:402,height:714},isMobile:true,hasTouch:true});
test.beforeAll(async()=>{fixture=await startNurseChatFixture();});
test.afterAll(async()=>{await fixture?.close();});
test.beforeEach(async({page})=>{
 await page.route('**/*',async route=>{
  if(new URL(route.request().url()).hostname!=='127.0.0.1')return route.abort();
  return route.fulfill(await fixture.respond(route.request().url(),route.request().method(),route.request().postData()??''));
 });
});
const unchanged=async(page:Page,url:string)=>{await expect(page).toHaveURL(url);await expect(page.locator('a[href]')).toHaveCount(0);};
const bottom=(page:Page)=>page.locator('.cv2-thread').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);
async function send(page:Page,text:string){
 const url=page.url();
 await page.getByRole('textbox').fill(text);await unchanged(page,url);
 // A reply to the member (a conversation is open and the composer is the plain "Your message") asks first; the journeys here mean to send it.
 const toMember=await page.getByRole('button',{name:'Close conversation',exact:true}).count()>0&&await page.getByRole('textbox').getAttribute('aria-label')==='Your message';
 await page.getByRole('button',{name:'Send',exact:true}).click();
 if(toMember)await page.getByRole('button',{name:'Send to member',exact:true}).click({timeout:2000}).catch(()=>{});
 await unchanged(page,url);
}
/** The first Send of a reply to the member only asks; this stops there. */
async function sendOnly(page:Page,text:string){
 await page.getByRole('textbox').fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();
}

test('today, name search, member selection and unsupported requests stay in one thread',async({page})=>{
 const url=fixture.url+'/staff/real/nurse-chat-v2';await page.goto(url);
 await expect(page.locator('[data-message-key]')).toHaveCount(0);
 await expect(page.getByText('Hello. Start with today or a member’s name.')).toBeVisible();
 await unchanged(page,url);
 await page.getByRole('button',{name:'Today',exact:true}).click();
 await expect(page.locator('.cv2-me').last()).toHaveText('Today');
 await expect(page.getByText('Visits today', {exact:true})).toBeVisible();
 await expect(page.locator('[data-today-reply]')).toContainText('Ani Example · 1 Jan 1986 · •••• 1234');
 await expect(page.locator('[data-today-task]').first()).toContainText('•••• 1234');
 await expect(page.locator('[data-today-visit]').first()).toContainText('•••• 1234');
 await expect(page.getByText('Confirm the visit time', {exact:true})).toBeVisible();
 await expect(page.getByText('Future task', {exact:true})).toHaveCount(0);
 await expect(page.getByText('Older Example', {exact:false})).toHaveCount(0);
 await unchanged(page,url);
 await send(page,'today');await expect(page.locator('[data-today-reply]')).toHaveCount(2);await unchanged(page,url);
 await send(page,'What do I have today?');await expect(page.locator('[data-today-reply]')).toHaveCount(3);await expect(page.locator('.cv2-me').last()).toHaveText('What do I have today?');await unchanged(page,url);
 await send(page,'Prescribe something for her headache');await expect(page.getByText('I can’t prescribe, change a dose, diagnose or delete a record.',{exact:false})).toBeVisible();await unchanged(page,url);
 await send(page,'my visits');await expect(page.locator('[data-visit-list]')).toHaveCount(1);await unchanged(page,url);
 await send(page,'Ani');
 await unchanged(page,url);
 await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await expect(page.getByText('You reply as the assigned nurse.',{exact:false})).toHaveCount(1);
 await expect(page.locator('[data-message-key].cv2-me').last()).toHaveText('Ani Example · 1 Jan 1986 · •••• 1234');await expect(page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
 await page.getByRole('button',{name:'Close conversation',exact:true}).click();await unchanged(page,url);
 await send(page,'What can you do?');
 await expect(page.getByText('Which member do you mean?',{exact:true})).toBeVisible();await unchanged(page,url);
 await send(page,'Nobody');
 await expect(page.getByText('No matching assigned members. Try another name.')).toBeVisible();await unchanged(page,url);
 await send(page,'who hasnt logged bp this week');await expect(page.locator('[data-nurse-missing-bp]')).toContainText('Ani Example');await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/nurse-chat-v2-phone.png'});
 await page.setViewportSize({width:1280,height:800});
 await expect(page.getByRole('textbox')).toBeVisible();await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/nurse-chat-v2-desktop.png'});
});

test('identity read failure keeps Today tasks and visits usable without an error',async({page})=>{
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2?state=identity-failed');
 await send(page,'today');
 await expect(page.locator('[data-today-task]').first()).toContainText('Ani Example');
 await expect(page.locator('[data-today-visit]').first()).toContainText('Ani Example');
 await expect(page.locator('[data-today-reply]')).not.toContainText('••••');
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.locator('[data-today-visit]').first().getByRole('button').click();
 await expect(page.locator('[data-visit-question]')).toHaveCount(1);
});

test('today failure, incomplete sources, visits off and search failure are messages',async({page})=>{
 for(const state of ['failed','partial','visits-off','empty','search-failed']){
  const url=fixture.url+'/staff/real/nurse-chat-v2?state='+state;await page.goto(url);
  await send(page,state==='search-failed'?'Ani':'today');
  const copy={failed:'Your work list is unavailable. Try today again.',partial:'Visits could not be read. Do not assume none are due.','visits-off':'Visits are switched off.','empty':'No due tasks in the available list.','search-failed':'Member search is unavailable. Try the name again.'}[state]!;
  await expect(page.getByText(copy,{exact:true})).toBeVisible();await unchanged(page,url);
 }
});

test('a reply to the member asks before it sends, and editing closes the ask',async({page})=>{
 const url=await openMember(page);const sent=()=>fixture.requests.length;
 const before=sent();
 await sendOnly(page,'Please measure again tonight');
 const confirm=page.locator('[data-reply-confirm]');
 await expect(confirm).toBeVisible();await expect(confirm).toContainText('They will see it in their chat');
 await expect(page.locator('[data-conversation-item]').last()).not.toContainText('Please measure again tonight');
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(confirm).toHaveCount(0);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(confirm).toBeVisible();
 await page.getByRole('textbox').fill('Please measure again tonight, twice');await expect(confirm).toHaveCount(0);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByRole('button',{name:'Send to member',exact:true}).click();
 await expect(page.locator('[data-conversation-item]').last()).toContainText('Please measure again tonight, twice');
 expect(sent()).toBeGreaterThan(before);
});

test('urgent alerts on her members sit above the counts in Today, and a failed alert read is said out loud',async({page})=>{
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2?state=urgent');await send(page,'today');
 const box=page.locator('[data-urgent-alerts="ready"]');
 await expect(box).toBeVisible();await expect(box).toContainText('Test Patient');await expect(box).toContainText('wrote about self-harm');
 const order=await page.locator('[data-today-reply]').evaluate(el=>{const nodes=[...el.querySelectorAll('[data-urgent-alerts], p')];return nodes.findIndex(n=>n.hasAttribute('data-urgent-alerts'))<nodes.findIndex(n=>/ open · /.test(n.textContent??''));});
 expect(order).toBe(true);
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2?state=alerts-failed');await send(page,'today');
 await expect(page.locator('[data-urgent-alerts="unavailable"]')).toContainText('Do not assume there are none');
});

test('long page-state thread opens newest, a reply never moves a reader, and the nurse\'s own send follows to the end',async({page})=>{
 const url=fixture.url+'/staff/real/nurse-chat-v2?history';await page.goto(url);
 await expect(page.getByText('Earlier reply 99')).toBeVisible();await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await send(page,'today');await expect(page.getByText('Loading your work…')).toBeVisible();
 await expect(page.getByText('Earlier reply 1',{exact:true})).toHaveCount(1);
 const keys=await page.locator('[data-message-key]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-message-key')));
 expect(new Set(keys).size).toBe(keys.length);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.waitForTimeout(100);
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
 await page.waitForTimeout(1000);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await page.setViewportSize({width:402,height:620});
 await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'));});
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await page.getByRole('button',{name:'New message',exact:true}).click();await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await send(page,'What works?');await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await expect(page.locator('.cv2-me').last()).toContainText('What works?');await unchanged(page,url);
});

test('phone has one scroller, a growing 16px composer, keyboard-safe send and a language sheet',async({page})=>{
 const url=fixture.url+'/staff/real/nurse-chat-v2?history';await page.goto(url);
 const geometry=await page.evaluate(()=>({font:parseFloat(getComputedStyle(document.querySelector('textarea')!).fontSize),
  scrollers:[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className),
  bottom:document.querySelector('.cv2-composer')!.getBoundingClientRect().bottom,
  expected:innerHeight-parseFloat(getComputedStyle(document.querySelector('.cv2-bottom')!).paddingBottom)}));
 expect(geometry.font).toBeGreaterThanOrEqual(16);expect(geometry.scrollers).toEqual(['cv2-thread']);expect(geometry.bottom).toBeCloseTo(geometry.expected,0);
 const field=page.getByRole('textbox'),height=(await field.boundingBox())!.height;
 await field.fill('A long message. '.repeat(35));expect((await field.boundingBox())!.height).toBeGreaterThan(height*2);
 await page.getByRole('button',{name:'Send',exact:true}).click();await expect(field).toBeFocused();await expect(field).toHaveValue('');
 expect(await page.evaluate(()=>scrollY)).toBe(0);await unchanged(page,url);
 await page.locator('.cv2-avatar').click();await expect(page.getByRole('dialog')).toBeVisible();await unchanged(page,url);
 await page.getByRole('button',{name:'Հայերեն',exact:true}).click();await expect(page.locator('[data-nurse-chat-v2]')).toHaveAttribute('lang','hy');await unchanged(page,url);
 await page.getByRole('button',{name:'Русский',exact:true}).click();await expect(page.locator('[data-nurse-chat-v2]')).toHaveAttribute('lang','ru');await unchanged(page,url);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('.cv2-avatar').click();await page.mouse.click(200,120);await expect(page.getByRole('dialog')).toHaveCount(0);await unchanged(page,url);
});

async function openMember(page:Page,state=''){
 const url=fixture.url+'/staff/real/nurse-chat-v2'+(state?'?state='+state:'');
 await page.goto(url);await send(page,'Ani');
 await page.getByRole('textbox').fill('A draft for nobody');
 await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await expect(page.getByText('Responsible doctor: Doctor Example',{exact:true})).toHaveCount(1);
 await expect(page.getByRole('textbox')).toHaveValue('');await expect(page.getByRole('textbox')).toHaveAttribute('maxlength','4096');
 await unchanged(page,url);return url;
}

test('member turns, urgent guidance, reply routing, close and reopen stay inside the thread',async({page})=>{
 const url=await openMember(page);
 await expect(page.locator('[data-nurse-urgent-line]')).toHaveText('In an emergency, call 103. Guidance');
 await expect(page.getByText('You reply as the assigned nurse.',{exact:false})).toHaveCount(1);
 await expect(page.getByText('You reply in the member’s app conversation.',{exact:false})).toHaveCount(1);
 await expect(page.locator('[data-conversation-item]')).toHaveCount(120);
 for(const role of ['Member','Doctor','Nurse','AI assistant'])await expect(page.locator('[data-conversation-item]').filter({hasText:' · '+role+' · '}).first()).toHaveCount(1);
 await page.locator('[data-nurse-urgent-line]').click();await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByText('Do not wait for tests or the app.',{exact:false})).toBeVisible();await unchanged(page,url);
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
 await send(page,'today');
 await expect(page.locator('[data-conversation-item]').last()).toContainText('today');
 await expect(page.locator('[data-pending-reply]')).toHaveCount(0);await expect(page.getByRole('textbox')).toBeFocused();
 await expect.poll(()=>bottom(page)).toBeLessThan(2);expect(fixture.requests.at(-1)?.body).toBe('today');
 await page.getByRole('textbox').fill('Unsent draft');
 await page.getByRole('button',{name:'Close conversation',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveValue('');await expect(page.locator('[data-conversation-item]')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Conversation with Ani Example',exact:true})).toBeVisible();await unchanged(page,url);
 const reads=fixture.reads;
 await page.getByRole('button',{name:'Conversation with Ani Example',exact:true}).click();
 await expect(page.locator('[data-conversation-item]')).toHaveCount(121);expect(fixture.reads).toBe(reads+1);
 await expect(page.getByRole('textbox')).toBeFocused();await expect.poll(()=>bottom(page)).toBeLessThan(2);await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/nurse-conversation-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'e2e/.state/nurse-conversation-desktop.png'});await unchanged(page,url);
});

test('the menu keeps a way back to the previous nurse screen',async({page})=>{
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2');
 await page.locator('.cv2-avatar').click();
 await page.getByRole('button',{name:'Open the previous nurse screen',exact:true}).click();
 await expect(page).toHaveURL(/\/staff\/real\/nurse-chat\?previous=1$/);
});

test('polling preserves the scrolled-up reader; own reply follows to the end',async({page})=>{
 const url=await openMember(page);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.waitForTimeout(100);const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 fixture.incoming();
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await unchanged(page,url);
 await page.getByRole('button',{name:'New message',exact:true}).click();await expect.poll(()=>bottom(page)).toBeLessThan(2);await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await send(page,'My reply');await expect(page.locator('[data-conversation-item]').last()).toContainText('My reply');
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
});

test('a poll does not count as read for a scrolled-up nurse, and sign-out waits for an unknown send',async({page})=>{
 let url=await openMember(page);const first=fixture.requests.length;
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});await page.waitForTimeout(100);
 fixture.incoming();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
 await send(page,'Written before reading it');
 expect(fixture.requests[first].expectedVersion).toBe(1);
 await expect(page.getByText('A new member message arrived. Read it before sending your reply.',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox')).toHaveValue('Written before reading it');
 await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByRole('button',{name:'Send to member',exact:true}).click();
 await expect(page.locator('[data-conversation-item]').last()).toContainText('Written before reading it');
 expect(fixture.requests.at(-1).expectedVersion).toBe(2);await unchanged(page,url);
 url=await openMember(page,'thrown-once');await send(page,'Lost reply');
 await expect(page.getByText('The send result is unknown.',{exact:false})).toBeVisible();
 await page.locator('.cv2-avatar').click();
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Open the previous nurse screen',exact:true})).toBeDisabled();
 await expect(page.getByText('Your reply has no result yet. Check it before signing out.',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await page.getByRole('button',{name:'Check or retry this reply',exact:true}).click();
 await expect(page.getByRole('textbox')).toBeEnabled();await page.locator('.cv2-avatar').click();
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeEnabled();await page.keyboard.press('Escape');await unchanged(page,url);
});

test('stale restores the untouched draft and an unknown result retries the exact request once',async({page})=>{
 let url=await openMember(page,'stale-once');const draft='  Read this first\nsecond line  ';
 await send(page,draft);await expect(page.getByRole('textbox')).toHaveValue(draft);
 await expect(page.getByText('A new member message arrived. Read it before sending your reply.',{exact:true})).toBeVisible();
 await expect(page.locator('[data-conversation-item]').last()).toContainText('A new member message');
 expect(fixture.requests).toHaveLength(1);expect(fixture.requests[0].body).toBe(draft.trim());
 await expect(page.locator('[data-conversation-item].cv2-me').filter({hasText:'Read this first'})).toHaveCount(0);await unchanged(page,url);
 url=await openMember(page,'thrown-once');await send(page,'Reply after a lost response');
 await expect(page.getByText('The send result is unknown.',{exact:false})).toBeVisible();
 await expect(page.getByRole('textbox')).toBeDisabled();await expect(page.getByRole('button',{name:'Close conversation',exact:true})).toBeDisabled();
 const original={...fixture.requests[0]},reads=fixture.reads;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(fixture.reads).toBe(reads);
 await page.getByRole('button',{name:'Check or retry this reply',exact:true}).click();
 await expect(page.getByRole('textbox')).toBeEnabled();await expect(page.getByRole('textbox')).toBeFocused();
 expect(fixture.requests).toHaveLength(2);expect(fixture.requests[1]).toEqual(original);
 await expect(page.locator('[data-conversation-item]').filter({hasText:'Reply after a lost response'})).toHaveCount(1);
 await expect(page.locator('[data-pending-reply]')).toHaveCount(0);await unchanged(page,url);
});

test('empty, read-only, incomplete history and access failures are conversation replies',async({page})=>{
 for(const state of ['empty','read-only','media','over-limit','denied','off','unavailable']){
  const url=fixture.url+'/staff/real/nurse-chat-v2?state='+state;await page.goto(url);await send(page,'Ani');
  await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
  const copy={empty:'No messages yet.', 'read-only':'Reading only.',media:'Some member messages could not be read or saved', 'over-limit':'Some member messages could not be read or saved',denied:'Access denied.',off:'Nurse chat is switched off',unavailable:'The conversation is unavailable.'}[state]!;
  await expect(page.getByText(copy,{exact:false})).toHaveCount(1);
  if(state==='read-only')await expect(page.getByRole('textbox')).toBeDisabled();
  if(['denied','off','unavailable'].includes(state))await expect(page.getByRole('button',{name:'Close conversation',exact:true})).toHaveCount(0);
  await unchanged(page,url);
 }
});

async function startHandoff(page:Page){
 const item=page.locator('[data-conversation-item]').first();
 await item.scrollIntoViewIfNeeded();await item.getByRole('button').click();
 await page.getByRole('button',{name:'Hand over to doctor',exact:true}).click();
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.getByRole('button',{name:'Blood pressure',exact:true}).click();
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await expect(page.getByText('Your observation for the doctor',{exact:true})).toBeVisible();
 await expect(page.getByRole('textbox')).toHaveAttribute('maxlength','2000');
}

test('handoff uses selected turns, leaves used controls, cancels without sending and keeps the keyboard',async({page})=>{
 const url=await openMember(page);
 const item=page.locator('[data-conversation-item]').first();await item.scrollIntoViewIfNeeded();
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop+=100;el.dispatchEvent(new Event('touchend'));});
 await expect(page.getByRole('button',{name:'Hand over to doctor',exact:true})).toHaveCount(0);
 await startHandoff(page);
 await expect(page.locator('[data-handoff-turn="start"]')).toHaveClass(/cv2-me/);
 await expect(page.locator('[data-handoff-turn="topic"]')).toContainText('Blood pressure');
 await expect(page.getByRole('button',{name:'Blood pressure',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Hand over to doctor',exact:true})).toHaveCount(0);
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await expect(page.getByRole('textbox')).toBeFocused();
 await page.getByRole('textbox').fill('Nothing sent');
 await page.getByRole('button',{name:'Close note for the doctor',exact:true}).click();
 await expect(page.locator('[data-handoff-turn]')).toHaveCount(0);expect(fixture.handoffRequests).toHaveLength(0);
 await expect(page.getByRole('textbox')).toHaveValue('');await unchanged(page,url);
});

test('stale handoff restores words and a new request; unknown outcome retries the exact request once',async({page})=>{
 let url=await openMember(page,'handoff-stale');await startHandoff(page);
 const words='  Observation kept exactly  ';await send(page,words);
 await expect(page.getByRole('textbox')).toHaveValue(words);await expect(page.getByText('A new member message arrived.',{exact:false})).toBeVisible();
 await expect(page.locator('[data-handoff-saved]')).toHaveCount(0);expect(fixture.handoffRequests).toHaveLength(1);
 const old=fixture.handoffRequests[0];await send(page,words);
 await expect(page.locator('[data-handoff-saved]')).toHaveCount(1);expect(fixture.handoffRequests[1].requestId).not.toBe(old.requestId);
 expect(fixture.handoffRequests[1].expectedVersion).toBeGreaterThan(old.expectedVersion);await unchanged(page,url);
 url=await openMember(page,'handoff-thrown');await startHandoff(page);await send(page,'One observation');
 await expect(page.getByText('The result is unknown.',{exact:false})).toBeVisible();await expect(page.getByRole('textbox')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Close note for the doctor',exact:true})).toBeDisabled();
 const request={...fixture.handoffRequests[0]};await page.getByRole('button',{name:'Check or retry this handoff',exact:true}).click();
 await expect(page.locator('[data-handoff-saved]')).toHaveCount(1);expect(fixture.handoffRequests).toHaveLength(2);expect(fixture.handoffRequests[1]).toEqual(request);
 await expect(page.locator('[data-handoff-turn]')).toHaveCount(0);await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
});

test('server handovers and member arrivals are in time order, and handed over messages offer no action',async({page})=>{
 const url=await openMember(page,'handed-over');
 const item=page.locator('[data-conversation-item]').first();await item.scrollIntoViewIfNeeded();await item.getByRole('button').click();
 await expect(item).toContainText('Handed over');await expect(page.getByRole('button',{name:'Hand over to doctor',exact:true})).toHaveCount(0);
 const order=await page.locator('[data-conversation-item], [data-handoff-saved]').evaluateAll(nodes=>nodes.map(n=>n.textContent));
 expect(order[1]).toContain('Earlier saved observation');
 const other=page.locator('[data-conversation-item]').nth(1);await other.scrollIntoViewIfNeeded();await other.getByRole('button').click();
 await page.getByRole('button',{name:'Hand over to doctor',exact:true}).click();
 fixture.incoming();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('A new member message',{exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'Blood pressure',exact:true}).click();
 const turns=await page.locator('[data-handoff-turn], [data-conversation-item]').evaluateAll(nodes=>nodes.map(n=>n.textContent));
 expect(turns.findIndex(t=>t?.includes('Hand over\n')||t?.startsWith('Hand over'))).toBeLessThan(turns.findIndex(t=>t?.includes('A new member message')));
 expect(turns.at(-1)).toBe('Blood pressure');await unchanged(page,url);
});


test('handoff read failure stays optional, a saved unread turn reconciles and read-only chat can hand over',async({page})=>{
 let url=await openMember(page,'handoffs-unavailable');await startHandoff(page);
 await expect(page.getByRole('textbox')).toBeEnabled();await unchanged(page,url);
 await page.getByRole('button',{name:'Close note for the doctor',exact:true}).click();
 url=await openMember(page,'handoff-read-fails');await startHandoff(page);
 await page.getByRole('textbox').fill('Saved after reading older messages');
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('[data-handoff-unread]')).toHaveCount(1);await expect.poll(()=>bottom(page)).toBeLessThan(2);
 const source=page.locator('[data-conversation-item]').first();await source.scrollIntoViewIfNeeded();await source.getByRole('button').click();
 await expect(page.getByRole('button',{name:'Hand over to doctor',exact:true})).toHaveCount(0);
 await page.evaluate(()=>fetch('/fixture/recover-handoffs',{method:'POST'}));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('[data-handoff-unread]')).toHaveCount(0);await expect(page.locator('[data-handoff-saved]')).toHaveCount(1);await unchanged(page,url);
 url=await openMember(page,'read-only');await startHandoff(page);await expect(page.getByRole('textbox')).toBeEnabled();
 await send(page,'Observation from reading only');await expect(page.locator('[data-handoff-saved]')).toHaveCount(1);
 await expect(page.getByRole('textbox')).toBeDisabled();await unchanged(page,url);
});

test('already existing and other refused handovers retain words correctly; revoked access closes',async({page})=>{
 for(const state of ['handoff-exists','handoff-refused','handoff-denied','handoff-off']){
  const url=await openMember(page,state);await startHandoff(page);await send(page,'Words for the doctor');
  if(state==='handoff-exists'){
   await expect(page.locator('[data-handoff-state="failed"]')).toContainText('Words for the doctor');
   await expect(page.getByText('This message already has a handoff.',{exact:false})).toBeVisible();
   await expect(page.getByRole('button',{name:'Close note for the doctor',exact:true})).toHaveCount(0);
  }else if(state==='handoff-refused'){
   await expect(page.getByRole('textbox')).toHaveValue('Words for the doctor');
   await expect(page.getByText('The handoff was refused.',{exact:false})).toBeVisible();
  }else{
   await expect(page.getByRole('button',{name:'Close note for the doctor',exact:true})).toHaveCount(0);
   await expect(page.getByText(state==='handoff-denied'?'Access denied.':'Nurse chat is switched off',{exact:false})).toBeVisible();
  }
  await unchanged(page,url);
 }
});


test('a saved handover is read once after reload and polling, with the same task time and source marker',async({page})=>{
 const url=await openMember(page);await startHandoff(page);await send(page,'Persisted server observation');
 const saved=page.locator('[data-handoff-saved]');await expect(saved).toHaveCount(1);
 const task=await saved.getAttribute('data-handoff-saved'),words=await saved.textContent();
 fixture.retainNextOpen();await page.reload();await send(page,'Ani');
 await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await expect(saved).toHaveCount(1);await expect(saved).toHaveAttribute('data-handoff-saved',task!);await expect(saved).toHaveText(words!);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(saved).toHaveCount(1);
 const source=page.locator('[data-conversation-item]').first();await source.scrollIntoViewIfNeeded();await source.getByRole('button').click();
 await expect(page.getByRole('button',{name:'Hand over to doctor',exact:true})).toHaveCount(0);await unchanged(page,url);
 await page.setViewportSize({width:1280,height:800});
 const text=page.locator('[data-conversation-item]').nth(1).locator('.ncv2-body');await text.scrollIntoViewIfNeeded();
 await text.dblclick();expect(await page.evaluate(()=>window.getSelection()?.toString().length??0)).toBeGreaterThan(0);
 await page.screenshot({path:'e2e/.state/nurse-handoff-desktop.png'});
});

const taskUnknown='The result could not be confirmed. Load current task history before retrying. Your entries are retained.';
const taskRow=(page:Page)=>page.locator(`[data-today-task="${fixture.taskId}"]`);
async function openTodayTask(page:Page,state='',history=false){
 const url=fixture.url+'/staff/real/nurse-chat-v2'+((state||history)?'?'+new URLSearchParams({...state?{state}:{},...history?{history:'1'}:{}}):'');
 await page.goto(url);await send(page,'today');await expect(taskRow(page)).toBeVisible();
 return url;
}
async function startTask(page:Page){
 await taskRow(page).first().getByRole('button',{name:'Mark done',exact:true}).click();
 await expect(page.locator('[data-task-turn="start"]')).toContainText('Done: Confirm the visit time');
 await expect(page.locator('[data-task-turn="prompt"]')).toContainText('Completion note');
 await expect(page.getByRole('textbox')).toHaveAttribute('maxlength','2000');
 await expect(page.getByRole('textbox')).toBeFocused();
}

test('Today shows five sorted active tasks and completion follows TaskRow eligibility',async({page})=>{
 const url=await openTodayTask(page);
 await expect(page.locator('[data-today-task]')).toHaveCount(5);
 await expect(page.locator('[data-today-task] [data-task-card] > button')).toHaveText(['Collect home readings','Confirm the visit time','Doctor review requested','Referral still open','Assign a new nurse']);
 for(const title of ['Confirm the visit time','Collect home readings']){
  const row=page.locator('[data-today-task]').filter({has:page.getByRole('button',{name:title,exact:true})});
  await expect(row.getByRole('button',{name:'Mark done',exact:true})).toHaveCount(1);
 }
 for(const title of ['Doctor review requested','Referral still open','Assign a new nurse']){
  const row=page.locator('[data-today-task]').filter({has:page.getByRole('button',{name:title,exact:true})});
  await expect(row).toHaveCount(1);await expect(row.getByRole('button',{name:'Mark done',exact:true})).toHaveCount(0);
 }
 // These active rows fall after the five-task slice, rather than being ineligible.
 for(const title of ['Future task','Awaiting doctor task','Completed task','Cancelled task'])await expect(page.getByRole('button',{name:title,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'See all tasks',exact:true}).click();
 const list=page.locator('[data-task-list]');
 await expect(list.locator('[data-task-card]')).toHaveCount(3);
 const doctorTask=list.locator('[data-task-card]').filter({has:page.getByRole('button',{name:'Awaiting doctor task',exact:true})});
 await expect(doctorTask.getByRole('button',{name:'Mark done',exact:true})).toHaveCount(1);
 await expect(doctorTask.getByRole('button',{name:'Resume task',exact:true})).toHaveCount(1);
 await list.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await expect(list.locator('[data-task-card]')).toHaveCount(6);
 const futureTask=list.locator('[data-task-card]').filter({has:page.getByRole('button',{name:'Future task',exact:true})});
 await expect(futureTask.getByRole('button',{name:'Mark done',exact:true})).toHaveCount(1);
 for(const title of ['Completed task','Cancelled task'])await expect(list.getByRole('button',{name:title,exact:true})).toHaveCount(0);
 await unchanged(page,url);
});

test('Mark done follows newest, hides every Today copy and cancel restores without IO',async({page})=>{
 const url=await openTodayTask(page,'',true);await send(page,'today');
 await expect(taskRow(page)).toHaveCount(2);await taskRow(page).first().scrollIntoViewIfNeeded();
 await page.getByRole('textbox').focus();await startTask(page);
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await expect(taskRow(page)).toHaveCount(0);
 await page.getByRole('textbox').fill('today');
 await expect(page.getByRole('textbox',{name:'Completion note',exact:true})).toHaveValue('today');
 await expect(page.locator('[data-today-reply]')).toHaveCount(2);
 await expect(page.getByRole('button',{name:'Close task note',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Close task note',exact:true}).click();
 await expect(page.locator('[data-task-turn]')).toHaveCount(0);await expect(taskRow(page)).toHaveCount(2);
 expect(fixture.taskRequests).toHaveLength(0);expect(fixture.taskReads).toHaveLength(0);
 await expect(page.getByRole('textbox')).toHaveValue('');await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
});

test('task note saves as plain words, refreshes once, and leaves an empty Today card',async({page})=>{
 const url=await openTodayTask(page,'task-only');await startTask(page);
 await send(page,'  Visit confirmed for tomorrow  ');
 await expect(page.locator('[data-task-turn="note"]')).toContainText('Saving…');
 await expect(page.locator('[data-task-turn="note"]')).toHaveText('Visit confirmed for tomorrow');
 await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 await expect(page.getByRole('textbox')).toBeFocused();await expect(taskRow(page)).toHaveCount(0);
 await expect(page.getByText('No due tasks in the available list.',{exact:true})).toBeVisible();
 expect(fixture.taskRequests).toHaveLength(1);expect(fixture.taskReads).toEqual([fixture.taskId]);
 expect(fixture.taskRequests[0]).toMatchObject({caseId:'aa110000-0000-4000-8000-000000000001',taskId:fixture.taskId,revision:1,operation:'complete',input:{note:'  Visit confirmed for tomorrow  '}});
 expect(fixture.taskRequests[0].requestId).toMatch(/^[\da-f-]{36}$/);await unchanged(page,url);
 await page.screenshot({path:'e2e/.state/nurse-task-phone.png'});
 await page.setViewportSize({width:1280,height:800});await expect(page.getByRole('textbox')).toBeVisible();
 await page.screenshot({path:'e2e/.state/nurse-task-desktop.png'});
});

test('unknown saved task checks history without another command and holds composer and sign-out',async({page})=>{
 for(const state of ['task-unknown-saved','task-thrown-saved']){
  const url=await openTodayTask(page,state);await startTask(page);await send(page,'Saved once');
  await expect(page.locator('[data-task-notice]')).toContainText(taskUnknown);
  await expect(page.getByRole('textbox')).toHaveAttribute('readonly','');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Close task note',exact:true})).toBeDisabled();
  await page.locator('.cv2-avatar').click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  expect(fixture.taskRequests).toHaveLength(1);
  await page.getByRole('button',{name:'Check this task',exact:true}).click();
  await expect(page.getByRole('textbox')).toBeEditable();await expect(page.getByRole('textbox')).toBeFocused();
  expect(fixture.taskRequests).toHaveLength(1);expect(fixture.taskReads.length).toBeGreaterThan(0);
  await expect(page.locator('[data-task-turn="note"]')).toHaveText('Saved once');await expect(taskRow(page)).toHaveCount(0);await unchanged(page,url);
 }
});

test('unknown unsaved task checks before resending the identical command',async({page})=>{
 const url=await openTodayTask(page,'task-unknown-unsaved');await startTask(page);await send(page,'Keep this exact request');
 await expect(page.locator('[data-task-notice]')).toContainText(taskUnknown);
 const original=structuredClone(fixture.taskRequests[0]);await page.getByRole('button',{name:'Check this task',exact:true}).click();
 await expect(page.getByRole('textbox')).toBeEditable();expect(fixture.taskReads.length).toBeGreaterThan(0);
 expect(fixture.taskRequests).toHaveLength(2);expect(fixture.taskRequests[1]).toEqual(original);
 await expect(page.locator('[data-task-turn="note"]')).toHaveText('Keep this exact request');await expect(taskRow(page)).toHaveCount(0);await unchanged(page,url);
});

test('a task changed before save shows its new words before the next send',async({page})=>{
 const url=await openTodayTask(page,'task-changed');await startTask(page);await send(page,'Confirmed Monday at 9');
 await expect(page.locator('[data-task-changed]')).toContainText('Arrange Thursday appointment');await expect(page.locator('[data-task-changed]')).toContainText('Thursday only');
 await expect(page.locator('[data-task-turn="start"]')).toContainText('Arrange Thursday appointment');
 await expect(page.locator('.ncv2-replying')).toContainText('Arrange Thursday appointment');
 await expect(page.getByRole('textbox')).toHaveValue('');
 await expect(page.getByRole('textbox')).toBeEditable();
 await send(page,'Confirmed Thursday at 9');
 expect(fixture.taskRequests).toHaveLength(2);expect(fixture.taskRequests[1]).toMatchObject({revision:2,input:{note:'Confirmed Thursday at 9'}});
 await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 expect(fixture.taskRequests).toHaveLength(2);await unchanged(page,url);
});

test('stale task restores the exact draft and retries with refreshed revision and a new request',async({page})=>{
 const url=await openTodayTask(page,'task-stale');await startTask(page);const words='  Completion after rechecking\nsecond line  ';await send(page,words);
 await expect(page.getByRole('textbox')).toHaveValue(words);await expect(page.getByRole('textbox')).toBeEditable();
 await expect(page.locator('[data-task-notice]')).toContainText('This task or your assignment changed');
 expect(fixture.taskReads).toEqual([fixture.taskId]);const original=structuredClone(fixture.taskRequests[0]);
 await send(page,words);await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 expect(fixture.taskRequests).toHaveLength(2);expect(fixture.taskRequests[1].revision).toBe(2);
 expect(fixture.taskRequests[1].requestId).not.toBe(original.requestId);expect(fixture.taskRequests[1].input).toEqual(original.input);
 expect(await page.locator('[data-task-turn="note"]').textContent()).toBe(words);await unchanged(page,url);
});

test('finished refusal closes the task while a failed reread keeps the target for checking',async({page})=>{
 for(const state of ['task-finished','task-unreadable']){
  const url=await openTodayTask(page,state);await startTask(page);await send(page,'Completion words retained');
  await expect(page.locator('[data-task-turn="start"]')).toContainText('Done: Confirm the visit time');
  await expect(page.locator('[data-task-notice]')).toContainText(state==='task-finished'?'This task was completed by another nurse.':'Current task access is required.');
  await expect(taskRow(page)).toHaveCount(0);
  expect(fixture.taskRequests).toHaveLength(1);expect(fixture.taskReads).toHaveLength(1);
  if(state==='task-finished'){
   await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
   await expect(page.getByRole('textbox')).toBeEditable();await expect(page.getByRole('textbox')).toHaveValue('');
  }else{
   await expect(page.getByRole('button',{name:'Close task note',exact:true})).toBeEnabled();
   await expect(page.locator('.ncv2-replying')).toContainText('Confirm the visit time');
   await expect(page.getByRole('textbox')).toHaveAttribute('readonly','');
   const check=page.getByRole('button',{name:'Check this task',exact:true});await expect(check).toBeEnabled();await check.click();
   await expect.poll(()=>fixture.taskReads.length).toBe(2);expect(fixture.taskRequests).toHaveLength(1);
   await expect(check).toBeEnabled();await expect(page.getByRole('textbox')).toHaveAttribute('readonly','');
  }
  await unchanged(page,url);
 }
});

test('task, conversation and handoff flows cannot take over one another',async({page})=>{
 const url=await openTodayTask(page);await send(page,'Ani');
 const member=page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true});
 await startTask(page);await expect(member).toBeDisabled();
 const heldTasks=page.getByRole('button',{name:'Mark done',exact:true});
 await expect(heldTasks).toHaveCount(2);
 for(const button of await heldTasks.all())await expect(button).toBeDisabled();
 await page.getByRole('button',{name:'Close task note',exact:true}).click();await expect(member).toBeEnabled();
 await member.click();await expect(page.getByRole('button',{name:'Close conversation',exact:true})).toBeVisible();
 await expect(taskRow(page).getByRole('button',{name:'Mark done',exact:true})).toBeDisabled();
 await startHandoff(page);await expect(taskRow(page).getByRole('button',{name:'Mark done',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Close note for the doctor',exact:true}).click();
 await page.getByRole('button',{name:'Close conversation',exact:true}).click();
 await expect(taskRow(page).getByRole('button',{name:'Mark done',exact:true})).toBeEnabled();await unchanged(page,url);
});

const visitQuestion=(page:Page)=>page.locator('[data-visit-question]');
const visitAnswer=(page:Page,key:string)=>page.locator(`[data-visit-answer="${key}"]`);
const visitOrder=['step:confirmed','step:started','check:urgent-symptoms','check:fasting-8h','sample:hba1c-glucose','step:samples-collected','step:samples-at-lab','check:bp-validated-device','measure:bp','measure:weight','measure:waist'];
async function openVisit(page:Page,state=''){
 const url=await openTodayTask(page,state);
 await page.locator(`[data-today-visit="${fixture.visitId}"]`).getByRole('button').click();
 await expect(page.getByRole('button',{name:'Close visit',exact:true})).toBeVisible();
 await unchanged(page,url);return url;
}
async function visitChip(page:Page,name:string){
 await page.getByRole('button',{name,exact:true}).click();
}
async function skipVisitToFinish(page:Page){
 for(let i=0;i<20;i++){
  if(await visitQuestion(page).getAttribute('data-visit-question')==='finish')return;
  await visitChip(page,'Skip for now');
 }
 throw new Error('Visit did not reach its finish question');
}
async function answerVisitQuestion(page:Page,key:string){
 if(key==='measure:bp')return send(page,'120/80 65');
 if(key==='measure:weight')return send(page,'72');
 if(key==='measure:waist')return send(page,'85');
 const labels:Record<string,string>={'step:confirmed':'I confirmed the visit with the member','step:started':'I have arrived','step:samples-collected':'Samples collected','step:samples-at-lab':'Samples handed to the lab'};
 await visitChip(page,labels[key]??(key.startsWith('sample:')?'Sample taken':key.startsWith('device:')?'Handed over and connected':'Done'));
}

test('visit asks each server item and eligible step once in clinical order with composer focus',async({page})=>{
 const url=await openVisit(page);
 const expected=[...visitOrder,`device:${fixture.deviceId}`,'finish'];
 for(const key of expected){
  await expect(visitQuestion(page)).toHaveCount(1);await expect(visitQuestion(page)).toHaveAttribute('data-visit-question',key);
  if(key.startsWith('measure:'))await expect(page.getByRole('textbox')).toBeFocused();else await expect(page.getByRole('textbox')).toBeDisabled();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);await unchanged(page,url);
  if(key!=='finish')await answerVisitQuestion(page,key);
 }
 expect(fixture.visitRequests.map(entry=>entry.kind==='step'?`step:${entry.request.step}`:entry.request.item)).toEqual(expected.slice(0,-1));
 await expect(page.getByText('All items done',{exact:true})).toBeVisible();
 await visitChip(page,'Complete visit');await expect(page.getByText('All items are done.',{exact:true})).toBeVisible();await visitChip(page,'Complete visit');await expect(visitAnswer(page,'completed')).toBeVisible();
 expect(fixture.visitDetail.completion).not.toBeNull();await unchanged(page,url);
 await page.screenshot({path:'/tmp/nurse-visit-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/nurse-visit-desktop.png'});
});

test('visit saved answers reload once in saved time order and edits replace the current answer',async({page})=>{
 const url=await openVisit(page,'visit-saved');
 const initial=['step:confirmed','step:started','check:urgent-symptoms','measure:weight'];
 await expect(page.locator('[data-visit-answer]')).toHaveCount(initial.length);
 expect(await page.locator('[data-visit-answer]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-visit-answer')))).toEqual(initial);
 await expect(visitAnswer(page,'measure:weight')).toContainText('72');
 fixture.retainNextOpen();await page.reload();await send(page,'today');await page.locator(`[data-today-visit="${fixture.visitId}"]`).getByRole('button').click();
 await expect(page.locator('[data-visit-answer]')).toHaveCount(initial.length);
 await skipVisitToFinish(page);await visitChip(page,'Change an answer');
 await visitChip(page,'Weight');await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','measure:weight');
 await send(page,'74');await expect(visitAnswer(page,'measure:weight')).toHaveCount(1);await expect(visitAnswer(page,'measure:weight')).toContainText('74');
 await unchanged(page,url);
});

test('a poll that answers the item on screen never carries the typed words to the next item',async({page})=>{
 const fresh=await openVisit(page,'visit-to-weight');await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','measure:weight');
 await page.getByRole('textbox').fill('72.5');
 fixture.recordElsewhere('measure:weight',{value:80});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','measure:waist');
 await expect(page.getByRole('textbox')).toHaveValue('');
 await expect(page.getByText('This visit changed on another device',{exact:false})).toBeVisible();
 expect(fixture.visitRequests).toHaveLength(0);await unchanged(page,fresh);
});

test('visit skipping returns at finish, requires a reason for unanswered safety and retains invalid measurements',async({page})=>{
 const url=await openVisit(page);await visitChip(page,'Skip for now');
 await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','step:started');
 await visitChip(page,'Skip for now');await visitChip(page,'Skip for now');
 expect(fixture.visitRequests).toHaveLength(0);
 await skipVisitToFinish(page);await expect(visitQuestion(page)).toContainText('Ask about chest pain');
 await visitChip(page,'Change an answer');await visitChip(page,'Blood pressure and pulse');
 await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','measure:bp');
 await send(page,'59/20 65');await expect(page.getByRole('textbox')).toHaveValue('59/20 65');
 await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','measure:bp');expect(fixture.visitRequests).toHaveLength(0);
 await visitChip(page,'Skip for now');await skipVisitToFinish(page);await visitChip(page,'Complete visit');
 await send(page,'ab');expect(fixture.visitRequests.filter(entry=>entry.kind==='complete')).toHaveLength(0);
 await expect(page.getByRole('textbox')).toHaveValue('ab');
 await send(page,'Member chose to return for the remaining checks');
 await expect(visitAnswer(page,'completed')).toBeVisible();
 expect(fixture.visitDetail.completion?.reason).toBe('Member chose to return for the remaining checks');
 expect(fixture.visitDetail.completion?.summary.openItems).toContain('check:urgent-symptoms');await unchanged(page,url);
});

test('visit unknown outcomes freeze controls and retry exactly the original submission',async({page})=>{
 for(const state of ['visit-unknown-saved','visit-unknown-unsaved']){
  const url=await openVisit(page,state);await answerVisitQuestion(page,'step:confirmed');
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  const original=structuredClone(fixture.visitRequests[0]);
  await expect(page.getByRole('button',{name:'Close visit',exact:true})).toBeDisabled();
  await visitChip(page,'Try again');await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','step:started');
  expect(fixture.visitRequests).toHaveLength(2);expect(fixture.visitRequests[1]).toEqual(original);
  expect(fixture.visitDetail.steps.filter((step:{step:string})=>step.step==='confirmed')).toHaveLength(1);await unchanged(page,url);
 }
});

test('visit complete with all items done and booking-stale keeps the unfinished flow',async({page})=>{
 let url=await openVisit(page,'visit-all-done');await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','finish');
 await expect(page.getByRole('textbox')).toBeDisabled();await visitChip(page,'Complete visit');await visitChip(page,'Complete visit');
 await expect(visitAnswer(page,'completed')).toBeVisible();
 expect(fixture.visitRequests.at(-1)?.request.reason).toBeNull();await unchanged(page,url);
 url=await openVisit(page,'visit-booking-stale');await skipVisitToFinish(page);await visitChip(page,'Complete visit');await send(page,'Return arranged for remaining items');
 await expect(page.getByText('This booking changed,',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Close visit',exact:true})).toBeVisible();expect(fixture.visitDetail.completion).toBeNull();await unchanged(page,url);
});


test('visit comments stay separate from readings and close reopens saved answers',async({page})=>{
 const url=await openVisit(page,'visit-saved');
 await expect(visitQuestion(page)).toHaveAttribute('data-visit-question','check:fasting-8h');
 await visitChip(page,'Add a comment');await expect(page.getByRole('textbox')).toBeFocused();
 await send(page,'Member confirmed no breakfast');expect(fixture.visitRequests).toHaveLength(0);
 await visitChip(page,'Done');await expect(visitAnswer(page,'check:fasting-8h')).toContainText('Member confirmed no breakfast');
 expect(fixture.visitRequests[0]).toMatchObject({kind:'mark',request:{item:'check:fasting-8h',done:true,note:'Member confirmed no breakfast',values:null}});
 await visitChip(page,'Close visit');await expect(page.getByRole('textbox')).toHaveValue('');await expect(page.getByRole('textbox')).toBeFocused();
 await visitChip(page,'Visit with Ani Example');await expect(visitAnswer(page,'check:fasting-8h')).toHaveCount(1);
 await expect(visitAnswer(page,'check:fasting-8h')).toContainText('Member confirmed no breakfast');await unchanged(page,url);
});

test('task filters, paging and details are replies at the end',async({page})=>{
 const url=await openTodayTask(page);
 await page.getByRole('button',{name:'See all tasks',exact:true}).click();
 await expect(page.locator('[data-task-list]')).toHaveCount(1);
 const initial=await page.locator('[data-task-list] [data-task-card]').count();
 await page.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await expect(page.locator('[data-task-list]')).toHaveCount(1);
 await expect(page.locator('[data-task-list] [data-task-card]')).toHaveCount(initial+3);
 await page.locator('[data-task-list]').getByRole('button',{name:'Completed',exact:true}).click();
 await expect(page.locator('[data-task-list]')).toContainText('Completed task');
 await page.locator('[data-task-list]').getByRole('button',{name:'Active',exact:true}).click();
 await page.locator('[data-task-list]').getByRole('button',{name:'Awaiting doctor task',exact:true}).click();
 await expect(page.locator('[data-task-details]')).toContainText('Contact the member and record the outcome.');
 await expect(page.locator('[data-task-details]')).toContainText('Narine Example');
 await expect(page.locator('[data-task-details]')).toContainText('31 Oct 2026, 13:00');
 await expect.poll(()=>bottom(page)).toBeLessThan(2);await expect(page.getByRole('textbox')).toBeFocused();await unchanged(page,url);
});

test('a task finished from the list stays out of Active after loading more',async({page})=>{
 await openTodayTask(page);
 await page.getByRole('button',{name:'See all tasks',exact:true}).click();
 const list=page.locator('[data-task-list]'),future=list.locator('[data-task-card]').filter({hasText:'Future task'});
 await list.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await expect(future).toHaveCount(1);
 await future.getByRole('button',{name:'Mark done',exact:true}).click();
 await send(page,'Finished from the list');
 expect(fixture.taskRequests.at(-1)).toMatchObject({operation:'complete'});
 await expect(future).toHaveCount(0);
 await list.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await expect(future,'A completed task must not return to Active after paging').toHaveCount(0);
 await list.getByRole('button',{name:'Completed',exact:true}).click();
 await expect(list).toContainText('Future task');
});

test('contact outcomes, awaiting, reopening and doctor referral use the task composer',async({page})=>{
 for(const outcome of ['Contact attempted','Reached','Unreachable']){
  const url=await openTodayTask(page,'task-only');
  await taskRow(page).getByRole('button',{name:'Record contact',exact:true}).click();
  await page.locator('[data-task-turn="prompt"]').getByRole('button',{name:outcome,exact:true}).click();
  await expect(page.locator('.ncv2-replying')).toContainText('Contact note');
  await send(page,'Factual contact note');
  expect(fixture.taskRequests[0]).toMatchObject({operation:'contact',input:{outcome:outcome==='Contact attempted'?'contact-attempted':outcome==='Reached'?'reached':'unreachable',note:'Factual contact note'}});
  await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);await unchanged(page,url);
 }
 await openTodayTask(page,'task-only');
 await taskRow(page).getByRole('button',{name:'Await member response',exact:true}).click();
 await page.locator('[data-task-turn="prompt"]').getByRole('button',{name:'Await member response',exact:true}).click();
 await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 await page.locator('[data-task-card]').last().getByRole('button',{name:'Resume task',exact:true}).click();
 await page.locator('[data-task-turn="prompt"]').getByRole('button',{name:'Resume task',exact:true}).click();
 await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 expect(fixture.taskRequests.map(r=>r.operation)).toEqual(['await-member','reopen']);
 await openTodayTask(page);
 await page.locator('[data-today-task]').filter({has:page.getByRole('button',{name:'Referral still open',exact:true})}).getByRole('button',{name:'Refer to assigned doctor',exact:true}).click();
 await send(page,'Doctor review needed');await expect(page.getByRole('button',{name:'Close task note',exact:true})).toHaveCount(0);
 expect(fixture.taskRequests[0]).toMatchObject({operation:'refer',input:{note:'Doctor review needed'}});
});

test('all visits shows four groups and future visits are read-only',async({page})=>{
 const url=await openTodayTask(page);
 await page.getByRole('button',{name:'See all visits',exact:true}).click();
 for(const group of ['today','earlier','upcoming','completed'])await expect(page.locator(`[data-visit-group="${group}"]`)).toHaveCount(1);
 await page.locator(`[data-visit-open="${fixture.futureVisitId}"]`).click();
 await expect(page.getByText('On the visit day.',{exact:true})).toBeVisible();
 await expect(page.locator('[data-visit-question]')).toHaveCount(0);expect(fixture.visitRequests).toHaveLength(0);
 await page.getByRole('button',{name:'Close visit',exact:true}).click();
 await page.locator(`[data-visit-open="${fixture.completedVisitId}"]`).click();
 await expect(page.getByText(/^Visit completed \d/)).toBeVisible();await unchanged(page,url);
});

async function openCareNote(page:Page,state=''){
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2'+(state?'?state='+state:''));
 await send(page,'Ani');await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await page.getByRole('button',{name:'Notes',exact:true}).click();
 await expect(page.locator('[data-care-notes]')).toContainText('Earlier care note');
 await page.getByRole('button',{name:'Add a note',exact:true}).click();
}
test('care notes use a separate composer job and never send to the member',async({page})=>{
 await openCareNote(page);const url=page.url();
 await expect(page.locator('.ncv2-replying')).toContainText('Care note for Ani Example');
 await expect(page.getByRole('button',{name:'Close conversation',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Reached',exact:true}).click();await send(page,'Member received the cuff');
 await expect(page.getByRole('button',{name:'Close care note',exact:true})).toHaveCount(0);
 expect(fixture.noteRequests[0]).toMatchObject({op:'note',kind:'reached',note:'Member received the cuff',revision:1});expect(fixture.requests).toHaveLength(0);
 await expect(page.locator('[data-note-job]')).toHaveCount(0);await expect(page.getByRole('textbox')).toBeFocused();
 await send(page,'A separate member reply');await expect.poll(()=>fixture.requests.length).toBe(1);
 await unchanged(page,url);await page.screenshot({path:'e2e/.state/nurse-notes-phone.png'});
 await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'e2e/.state/nurse-notes-desktop.png'});
});
test('unknown care notes hold close and sign-out and retry the exact revision',async({page})=>{
 for(const state of ['note-unknown-unsaved','note-unknown-saved']){
  await openCareNote(page,state);await send(page,'Exact unknown note');
  await expect(page.getByRole('button',{name:'Close care note',exact:true})).toBeDisabled();
  await page.locator('.cv2-avatar').click();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
  const original=structuredClone(fixture.noteRequests[0]);
  await page.getByRole('button',{name:'Retry this note',exact:true}).click();
  await expect.poll(()=>fixture.noteRequests.length).toBe(2);expect(fixture.noteRequests[1]).toEqual(original);
  await expect.poll(()=>fixture.notes.filter(note=>note.note==='Exact unknown note').length).toBe(1);expect(fixture.requests).toHaveLength(0);
  if(state==='note-unknown-saved'){await expect(page.getByRole('textbox')).toHaveAttribute('readonly','');await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();}
 }
});
test('failed reads retain the current task and conversation views',async({page})=>{
 await openTodayTask(page,'task-page-failed');const before=await page.locator('.cv2-messages').innerText();
 await page.getByRole('button',{name:'See all tasks',exact:true}).click();
 await expect.poll(()=>page.locator('.cv2-messages').innerText()).toBe(before);
 await page.goto(fixture.url+'/staff/real/nurse-chat-v2?state=notes-failed');await send(page,'Ani');
 await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await expect(page.getByRole('button',{name:'Notes',exact:true})).toBeVisible();const conversation=await page.locator('.cv2-messages').innerText();
 await page.getByRole('button',{name:'Notes',exact:true}).click();await expect.poll(()=>page.locator('.cv2-messages').innerText()).toBe(conversation);await expect(page.getByRole('button',{name:'Close conversation',exact:true})).toBeVisible();
});

async function zoeState(page:Page){return page.evaluate(()=>(window as unknown as {fixture:import('../nurse-chat-v2/zoe').ZoeFixture}).fixture);}
async function releaseZoe(page:Page){await page.evaluate(()=>(window as unknown as {fixture:import('../nurse-chat-v2/zoe').ZoeFixture}).fixture.releaseZoe?.());}
async function zoePage(page:Page,state=''){
 const url=fixture.url+'/staff/real/nurse-chat-v2'+(state?'?state='+state:'');await page.goto(url);await unchanged(page,url);return url;
}
async function zoeIdle(page:Page,url:string){await unchanged(page,url);await expect(page.getByRole('textbox')).toBeFocused();expect(fixture.requests).toHaveLength(0);}

test('a named nurse question answers inline, keeps its target and never sends a member reply',async({page})=>{
 const url=await zoePage(page);await send(page,'What is recorded for Ani Example?');
 await expect(page.getByTestId('zoe-answer')).toHaveAttribute('data-state','answered');
 await expect(page.getByText('To Zoe',{exact:true})).toBeVisible();
 await expect(page.getByText('Asking Zoe about Ani Example',{exact:true})).toBeVisible();
 expect(fixture.zoeQuestionRequests[0]).toMatchObject({question:'What is recorded for Ani Example?',expectedNurseId:'aa220000-0000-4000-8000-000000002001'});
 expect(fixture.zoeOpenRequests[0]).toMatchObject({memberId:fixture.memberId});
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);await zoeIdle(page,url);
 await send(page,'What else is recorded?');await expect(page.getByTestId('zoe-answer')).toHaveCount(2);
 expect(fixture.zoeQuestionRequests.at(-1)).toMatchObject({current:{memberId:fixture.memberId,memberName:'Ani Example'}});await zoeIdle(page,url);
 await page.getByRole('button',{name:'Clear member',exact:true}).click();
 await send(page,'What is recorded?');await expect(page.getByText('Which member do you mean?',{exact:true})).toBeVisible();
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(2);await zoeIdle(page,url);
 await page.screenshot({path:'/tmp/nurse-zoe-phone.png'});await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/nurse-zoe-desktop.png'});
});

test('in an open member conversation Zoe is an explicit switch and never a member reply',async({page})=>{
 const url=await zoePage(page);await send(page,'Ani');
 await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Reply to Ani Example');
 await page.getByRole('button',{name:'Ask Zoe instead',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Ask Zoe about Ani Example');
 await expect(page.getByText('Asking Zoe about Ani Example',{exact:true})).toBeVisible();await expect(page.getByRole('textbox')).toBeFocused();
 await send(page,'What is her latest blood pressure?');
 await expect(page.getByTestId('zoe-answer')).toHaveAttribute('data-state','answered');
 await expect(page.getByText('To Zoe',{exact:true})).toBeVisible();
 expect(fixture.requests).toHaveLength(0);expect(fixture.zoeQuestionRequests.at(-1)).toMatchObject({question:'What is her latest blood pressure?'});
 await unchanged(page,url);await expect(page.getByRole('textbox')).toBeFocused();
 await page.getByRole('button',{name:'Reply to the member instead',exact:true}).click();
 await expect(page.getByRole('textbox')).toHaveAttribute('placeholder','Reply to Ani Example');await expect(page.getByRole('textbox')).toHaveValue('');
 await send(page,'Thank you, see you soon');
 await expect.poll(()=>fixture.requests.length).toBe(1);expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);
 await unchanged(page,url);
});

test('a nurse chooses a member once and used choice buttons leave',async({page})=>{
 const url=await zoePage(page);await send(page,'What is recorded for Ani?');
 const first=page.getByRole('button',{name:'Ask about Ani Example',exact:true}),second=page.getByRole('button',{name:'Ask about Ani Other',exact:true});
 await expect(first).toBeVisible();await expect(second).toBeVisible();expect((await zoeState(page)).zoeFetchCalls).toHaveLength(0);await zoeIdle(page,url);
 await first.click();await expect(page.getByTestId('zoe-answer')).toHaveAttribute('data-state','answered');
 await expect(first).toHaveCount(0);await expect(second).toHaveCount(0);await expect(page.locator('.cv2-me').last()).toContainText('Ask about Ani Example');
 expect((await zoeState(page)).zoeFetchCalls[0].text).toBe('What is recorded for Ani?');await zoeIdle(page,url);
});

for(const state of ['','zoe-question-ambiguous','zoe-question-invalid'])test(`unresolved nurse question asks for a member: ${state||'none'}`,async({page})=>{
 const url=await zoePage(page,state);await send(page,'What is recorded?');
 await expect(page.getByText('Which member do you mean?',{exact:true})).toBeVisible();
 expect(fixture.zoeOpenRequests).toHaveLength(0);expect((await zoeState(page)).zoeFetchCalls).toHaveLength(0);await zoeIdle(page,url);
});

for(const state of ['zoe-refused-access','zoe-refused-busy','zoe-refused-off','zoe-open-refused','zoe-open-failed','zoe-question-refused','zoe-question-unavailable','zoe-fetch-thrown','zoe-cut','zoe-empty'])test(`nurse Zoe fails closed: ${state}`,async({page})=>{
 const url=await zoePage(page,state);await send(page,'What is recorded for Ani Example?');
 await expect(page.getByRole('alert')).toContainText(state==='zoe-refused-access'?'You do not have access':state==='zoe-refused-busy'?'Zoe is still on your last question':'That did not go through');
 await expect(page.getByTestId('zoe-answer')).toHaveCount(0);await zoeIdle(page,url);
});

test('an open member conversation sends typed questions only to the member',async({page})=>{
 const url=await zoePage(page);await send(page,'Ani');await page.getByRole('button',{name:'Ani Example · 1 Jan 1986 · •••• 1234',exact:true}).click();
 await send(page,'What is recorded for Ani Example?');await expect.poll(()=>fixture.requests.length).toBe(1);
 expect(fixture.zoeQuestionRequests).toHaveLength(0);expect((await zoeState(page)).zoeFetchCalls).toHaveLength(0);await unchanged(page,url);await expect(page.getByRole('textbox')).toBeFocused();
});

test('a second question for the same member does not fetch while Zoe is busy',async({page})=>{
 const url=await zoePage(page,'zoe-delayed');await send(page,'What is recorded for Ani Example?');
 await expect(page.getByTestId('zoe-card-bp')).toBeVisible();await zoeIdle(page,url);
 await send(page,'What else is recorded?');await expect(page.getByText('Zoe is still on your last question.',{exact:true})).toBeVisible();
 expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);await zoeIdle(page,url);
 await releaseZoe(page);await expect(page.getByTestId('zoe-answer')).toHaveAttribute('data-state','answered');await zoeIdle(page,url);
});

for(const state of ['zoe-history','zoe-history-failed'])test(`nurse Zoe history loads without changing screen: ${state}`,async({page})=>{
 const url=await zoePage(page,state);
 await expect(page.getByText('Hello. Start with today or a member’s name.')).toBeVisible();
 expect(fixture.zoeHistoryRequests).toHaveLength(0);
 await send(page,'What is recorded?');
 if(state==='zoe-history'){
  await expect(page.getByText('Earlier nurse question',{exact:true})).toBeVisible();
  await expect(page.getByText('Asking Zoe about Ani Example',{exact:true})).toBeVisible();
  await expect(page.getByTestId('zoe-answer')).toHaveAttribute('data-state','answered');
  expect(fixture.zoeOpenRequests).toHaveLength(0);
  expect((await zoeState(page)).zoeFetchCalls).toHaveLength(1);
 }else{
  await expect(page.getByText('Which member do you mean?',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await zoeState(page)).zoeFetchCalls).toHaveLength(0);
 }
 expect(fixture.zoeHistoryRequests).toHaveLength(1);await zoeIdle(page,url);
 await send(page,'today');await expect(page.locator('[data-today-reply]')).toHaveCount(1);await zoeIdle(page,url);
});
