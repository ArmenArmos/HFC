import { test, expect } from '@playwright/test';
import {VISIT_REQUEST} from '../../lib/zoe-chat-actions/lab-visit-copy';
import { startChatFixture } from '../chat-v2/server.mjs';
import type { AssessmentDraft } from '../../lib/patient/types';
import type { FieldValue } from '../../lib/clinical/types';

// Real production view, shared state, DOM and WebKit; action IO is deliberately isolated.
// Run: node node_modules/@playwright/test/cli.js test -c e2e/chat-v2/playwright.config.ts --project=webkit
let fixture: Awaited<ReturnType<typeof startChatFixture>>;
test.use({ viewport: { width:402, height:714 }, isMobile:true, hasTouch:true });
test.beforeAll(async () => { fixture=await startChatFixture(); });
test.afterAll(async () => { await fixture?.close(); });
test.beforeEach(async ({page}) => {
  await page.route('**/*', route => {
    if(new URL(route.request().url()).hostname !== '127.0.0.1')return route.abort();
    return route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??''));
  });
});
const bottom = async (page: import('@playwright/test').Page) => page.locator('.cv2-thread').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop);

test('V3 dose shows the approved strings and becomes one dialog turn after a lost reply',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&dose&lose-dose&empty');
 const reminder=page.locator('[data-zoe-card="dose"]');
 await expect(reminder).toContainText('Rosuvastatin');
 await expect(reminder).toContainText('20 mg');
 await expect(reminder).toContainText('20:00');
 await reminder.locator('[data-dose-answer="taken"]').click();
 await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/dose-state').body).doseEvents.length).toBe(1);
 await expect(page.locator('[data-turn-action]')).toContainText('I took Rosuvastatin.');
 await expect(reminder).toHaveCount(0);
 await page.goto(fixture.url+'/patient/chat?v3&keep&empty');
 await expect(page.locator('[data-turn-action]')).toHaveCount(1);
 expect(JSON.parse(fixture.respond(fixture.url+'/fixture/dose-state').body).doseEvents).toHaveLength(1);
});

test('V3 dose failure keeps the action available and switch off draws no reminder',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&dose&fail-dose&empty');
 const reminder=page.locator('[data-zoe-card="dose"]');
 await reminder.locator('[data-dose-answer="skipped"]').click();
 await expect(reminder.locator('[role="alert"]')).toBeVisible();
 await expect(reminder.locator('[data-dose-answer="skipped"]')).toBeEnabled();
 await reminder.locator('[data-dose-answer="skipped"]').click();
 await expect(page.locator('[data-turn-action]')).toContainText('I did not take Rosuvastatin.');
 await page.goto(fixture.url+'/patient/chat?dose&empty');
 await expect(page.locator('[data-zoe-card="dose"]')).toHaveCount(0);
});

test('V3 missed dose opens four reasons and muscle pain with dark urine opens the shared 103 card',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&dose&empty');
 await page.locator('[data-dose-answer="skipped"]').click();
 const reasons=page.locator('[data-zoe-card="ask"]');
 await expect(reasons.locator('[data-dose-reason]')).toHaveCount(4);
 await reasons.locator('[data-dose-reason="side_effect_or_fear"]').click();
 const sams=page.locator('[data-zoe-card="sams"]');
 await expect(sams).toContainText('both sides');
 await sams.locator('[data-sams-answer="yes"]').click();
 await expect(sams).toContainText('rising from a chair');
 await sams.locator('[data-sams-answer="no"]').click();
 await expect(sams).toContainText('tea or cola');
 await sams.locator('[data-sams-answer="yes"]').click();
 await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
 await expect(sams).toHaveCount(0);
 const state=JSON.parse(fixture.respond(fixture.url+'/fixture/dose-state').body);
 expect(state.safetyAlerts).toHaveLength(1);
 expect(state.doseEvents[0].status).toBe('skipped');
 await page.goto(fixture.url+'/patient/chat?v3&keep&empty');
 await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
 expect(JSON.parse(fixture.respond(fixture.url+'/fixture/dose-state').body).safetyAlerts).toHaveLength(1);
});

test('V3 forgot offers a reminder move with fixed no-double-dose wording; normal values has its own reply',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&dose&empty');
 await page.locator('[data-dose-answer="skipped"]').click();
 await page.locator('[data-dose-reason="forgot"]').click();
 await expect(page.locator('[data-zoe-card="ask"]')).toContainText("Don't take a double dose.");
 await page.getByRole('button',{name:'Move my reminders 15 minutes later',exact:true}).click();
 await expect(page.locator('[data-turn-reply]').last()).toContainText('15 minutes after');
 expect(JSON.parse(fixture.respond(fixture.url+'/fixture/dose-state').body).doseReasons).toEqual([{reason:'forgot',later:true}]);
 await page.goto(fixture.url+'/patient/chat?v3&dose&empty');
 await page.locator('[data-dose-answer="skipped"]').click();
 await page.locator('[data-dose-reason="values_normal"]').click();
 await expect(page.locator('[data-turn-reply]').last()).toContainText('your medicine is working');
});

test('long history opens at newest; unchanged polling, new replies and return preserve a reader for 30 seconds', async ({page}) => {
  await page.goto(fixture.url+'/patient/chat');
  await expect(page.getByText(/Recorded doctor reply 99/)).toBeVisible();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  // Late layout growth must follow until the person deliberately reads up.
  await page.locator('.cv2-say').first().evaluate(el=>{(el as HTMLElement).style.minHeight='400px';});
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
  await page.waitForTimeout(100);
  const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
  await page.evaluate(()=>{
    (window as unknown as {mutations:number}).mutations=0;
    new MutationObserver(()=>{(window as unknown as {mutations:number}).mutations++;}).observe(document.querySelector('.cv2-messages')!,{childList:true,subtree:true,characterData:true});
  });
  // The first read after load may replace the initial screening once; later unchanged reads must not render.
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const renders=await page.evaluate(()=>(window as unknown as {__chatListRenders:number}).__chatListRenders);
  await page.waitForTimeout(30_000);
  expect(await page.evaluate(()=>(window as unknown as {__chatListRenders:number}).__chatListRenders)).toBe(renders);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(0);
  expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
  expect(await page.evaluate(()=>(window as unknown as {mutations:number}).mutations)).toBe(0);
  fixture.respond(fixture.url+'/fixture/reply','POST');
  // A focus read is dropped while another read is in flight (the 30 s timer may be mid-read), so ask again until the reply shows.
  await expect(async()=>{
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible({timeout:3_000});
  }).toPass({timeout:60_000,intervals:[500,1_000,2_000]});
  expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
  await page.setViewportSize({width:402,height:620});
  await page.evaluate(()=>{window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
  expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
  await page.getByRole('button',{name:'New message',exact:true}).click();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  fixture.respond(fixture.url+'/fixture/reply','POST');
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
});

test('phone has one scroller, no leaving links, bottom-aligned composer, and send keeps focus and position',async({page})=>{
  await page.goto(fixture.url+'/patient/chat');
  const geometry=await page.evaluate(()=>{
    const form=document.querySelector('.cv2-composer')!;
    const footer=document.querySelector('.cv2-bottom')!;
    return {bottom:form.getBoundingClientRect().bottom,expected:innerHeight-parseFloat(getComputedStyle(footer).paddingBottom),
      scrollable:[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1 && /auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className),
      links:[...document.querySelectorAll('a[href]')].map(el=>el.getAttribute('href')),
      body:document.body.scrollHeight, font:parseFloat(getComputedStyle(document.querySelector('.cv2-composer textarea')!).fontSize)};
  });
  expect(geometry.bottom).toBeCloseTo(geometry.expected,0);
  expect(geometry.scrollable).toEqual(['cv2-thread']);
  expect(geometry.links).toEqual([]);expect(geometry.font).toBeGreaterThanOrEqual(16);
  await page.getByRole('textbox').fill('Hello Zoe');
  const before=await page.getByRole('button',{name:'Send',exact:true}).boundingBox();
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveValue('');
  expect(await page.getByRole('button',{name:'Send',exact:true}).boundingBox()).toEqual(before);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});

for(const [locale,greeting] of [['en','Hello, Ani.'],['hy','Բարև, Ani։'],['ru','Здравствуйте, Ani.']]) {
  test(`${locale}: welcome, consent message, menu and unavailable state`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&consent&locale=${locale}`);
    await expect(page.getByText(greeting,{exact:false})).toBeVisible();
    await expect(page.locator('[data-zoe-chat-consent]')).toBeVisible();
    await page.locator('.cv2-avatar').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button',{name:'English',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(fixture.url+`/patient/chat?empty&unavailable&locale=${locale}`);
    await expect(page.getByRole('textbox')).toBeDisabled();
    await expect(page.getByRole('status')).toBeVisible();
  });
}

test('sending while reading older messages returns to your message; the new message pill keeps the keyboard; long text grows',async({page})=>{
  await page.goto(fixture.url+'/patient/chat');
  await expect(page.getByText(/Recorded doctor reply 99/)).toBeVisible();
  await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
  await page.waitForTimeout(100);
  const field=page.getByRole('textbox');
  const single=(await field.boundingBox())!.height;
  await field.fill('A long message. '.repeat(40));
  expect((await field.boundingBox())!.height).toBeGreaterThan(single*2);
  expect((await field.boundingBox())!.height).toBeLessThanOrEqual(22*5+1);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await expect(field).toHaveValue('');
  await expect.poll(async()=>(await field.boundingBox())!.height).toBe(single);
  await expect(page.getByRole('button',{name:'New message',exact:true})).toHaveCount(0);
  await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
  await page.waitForTimeout(100);
  await field.focus();
  fixture.respond(fixture.url+'/fixture/reply','POST');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByRole('button',{name:'New message',exact:true}).click();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await expect(field).toBeFocused();
});

test('tapping outside the menu closes it',async({page})=>{
  await page.goto(fixture.url+'/patient/chat');
  await page.locator('.cv2-avatar').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(200,120);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('emergency remains in thread, refusal restores draft, retry and sign-out stay available',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty');
  await page.getByRole('textbox').fill('refuse');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('textbox')).toHaveValue('refuse');
  await expect(page.locator('[data-zoe-notice="not_eligible"]')).toBeVisible();
  await page.getByRole('textbox').fill('offline');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await page.getByRole('textbox').fill('I have severe chest pain right now');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Call 103 now',exact:true})).toBeVisible();
  expect(await page.locator('a[href]').count()).toBe(0);
  await page.locator('.cv2-avatar').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('[data-sign-in-ended]')).toBeVisible();
  await expect(page.locator('[data-message-key]')).toHaveCount(0);
});


test('sign-up language: a restored draft in another language than the page is what the menu shows, and English then switches it',async({page})=>{
  await page.setViewportSize({width:375,height:700});
  await page.addInitScript(()=>{
    if(!location.search.includes('draft=')||localStorage.getItem('noreon.signup.profile.v2:fixture'))return;
    localStorage.setItem('noreon.signup.profile.v2:fixture',JSON.stringify({name:'Fictional Signup',birth:'01/02/1970',sex:'male',locale:'ru',step:'consent',savedAt:Date.now()}));
  });
  await page.goto(fixture.url+'/patient/chat?signup&language-card&locale=en&draft=fixture');
  const choice=(id:keyof typeof languageNames)=>page.locator('[data-signup-language]').getByRole('button',{name:languageNames[id],exact:true});
  await expect(page.locator('h1')).toHaveText(signUpCopy.ru.consent);
  await expect(choice('ru')).toHaveAttribute('aria-pressed','true');
  await choice('en').click();
  await expect(page.locator('h1')).toHaveText(signUpCopy.en.consent);
  await page.getByRole('button',{name:'Back to my details'}).click();
  await expect(page.locator('#patient-name')).toHaveValue('Fictional Signup');
});

for (const [id,label,heading] of [['hy','Հայերեն','Zoe-ն անջատված է'],['ru','Русский','Zoe для вас выключена'],['en','English','Zoe is off']] as const) test(`menu language switches the Zoe consent step at once, ${id}, at phone width`,async({page})=>{
  await page.setViewportSize({width:375,height:700});
  await page.goto(fixture.url+(id==='en'?'/patient/chat?empty&consent&locale=ru':'/patient/chat?empty&consent'));
  const before=await page.locator('[data-zoe-chat-consent]').innerText();
  await page.locator('.cv2-avatar').click();
  await page.getByRole('button',{name:label,exact:true}).click();
  await expect(page.locator('[data-chat-v2]')).toHaveAttribute('lang',id);
  await expect(page.locator('[data-zoe-chat-consent] h2')).toContainText(heading);
  expect(await page.locator('[data-zoe-chat-consent]').innerText()).not.toBe(before);
});

test('language can be changed twice and saved revision survives reopening the menu',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty');
  await page.locator('.cv2-avatar').click();
  await page.getByRole('button',{name:'Հայերեն',exact:true}).click();
  await expect(page.locator('[data-chat-v2]')).toHaveAttribute('lang','hy');
  await page.keyboard.press('Escape');
  await page.locator('.cv2-avatar').click();
  await page.getByRole('button',{name:'Русский',exact:true}).click();
  await expect(page.locator('[data-chat-v2]')).toHaveAttribute('lang','ru');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

// Synthetic answers only. Prefixes let the real branching engine choose the next
// question, rather than replacing the production session with a test state machine.
const draft = (values:Record<string,FieldValue>={}):AssessmentDraft => ({
  id:'00000000-0000-4000-8000-000000001001',revision:0,assessmentDate:'2026-11-01',completedAt:null,urgentRule:null,
  answers:Object.fromEntries(Object.entries({'q1.age':40,'q1.sex':'female',...values}).map(([fieldId,value])=>[
    fieldId,{fieldId,value,source:'manual' as const,answeredAt:'2026-11-01T12:00:00.000Z'},
  ])),
});
const calmPrefix:Record<string,FieldValue>={
  'q2.weight_perception':'ok','q2.height':165,'q2.weight':60,'q2.waist':'unknown',
  'q2.activity':'sedentary','q2.diet':['none'],'q3.status':'never','q4.frequency':'never',
  'q5.diagnosed':'no','q5.last_reading.systolic':120,'q5.last_reading.diastolic':80,
  'q6.conditions':['none'],'q7.relatives':['none'],'q8.sleep_quality':8,'q8.sleep_hours':7,'q8.stress':'no',
};
const assessmentState = () => JSON.parse(fixture.respond(fixture.url+'/fixture/assessment').body) as {
  assessment:AssessmentDraft;saves:number;attempts:number;
};
const seedAssessment = (values:Record<string,FieldValue>={}) => fixture.respond(fixture.url+'/fixture/assessment','POST',JSON.stringify(draft(values)));
const activeQuestion = (page:import('@playwright/test').Page) => page.locator('[data-chat-anamnesis] [data-question-id]');
const choose = async(page:import('@playwright/test').Page,id:string,label:string) => {
  await expect(activeQuestion(page)).toHaveCount(1);
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id',id);
  await activeQuestion(page).getByRole('button',{name:label,exact:true}).click();
};

for(const width of [402,1280]) for(const [locale,label,yes] of [
  ['en','Was shortness of breath part of this?','Yes'],
  ['hy','Դրա մեջ օդի պակաս եղե՞լ է։','Այո'],
  ['ru','Была ли при этом нехватка воздуха?','Да'],
]) test(`clinical clarifiers ${locale} at ${width}px: breathlessness saves and unknown alcohol opens follow-ups`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:width===402?714:900});
  seedAssessment({...calmPrefix,'q9.present':'no','q10.symptoms':'yes','q10.right_now':'no'});
  await page.goto(fixture.url+`/patient/chat?empty&anamnesis&locale=${locale}`);
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q10.breathless');
  await expect(activeQuestion(page)).toContainText(label);
  await expect(activeQuestion(page).getByRole('button',{name:yes,exact:true})).toBeVisible();
  expect(assessmentState().assessment.completedAt).toBeNull();
  await page.screenshot({path:testInfo.outputPath('breathlessness.png')});
  await choose(page,'q10.breathless',yes);
  await expect.poll(()=>assessmentState().assessment.answers['q10.breathless']?.value).toBe('yes');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q10.syncope');
  await page.reload();
  await expect(page.locator('[data-answer-id="q10.breathless"]')).toContainText(yes);
  seedAssessment({...calmPrefix,'q4.frequency':'unknown','q9.present':'no','q10.symptoms':'no'});
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q4.drinks_per_day');
});

test('anamnesis opt-in can wait; composer remains separate; accepting opens one real question',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(page.getByText('Would you like to answer a few health questions now?',{exact:true})).toBeVisible();
  await expect(activeQuestion(page)).toHaveCount(0);
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await expect(activeQuestion(page)).toHaveCount(0);
  await expect(page.locator('.cv2-composer textarea')).toBeEnabled();
  await page.locator('.cv2-composer textarea').fill('A separate question for my care team');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  expect(assessmentState().saves).toBe(0);
  await page.getByRole('button',{name:'Continue my questions',exact:true}).click();
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(page.locator('[data-answer-id="q2.weight_perception"]')).toContainText('I think it is normal');
  await page.locator('.cv2-composer textarea').fill('A message between questions');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('A message between questions',{exact:true})).toBeVisible();
  await expect(activeQuestion(page).locator('xpath=following-sibling::*')).toHaveCount(0);
  await expect(page.locator('a[href]')).toHaveCount(0);
  await expect(page.locator('.cv2-composer [data-question-id]')).toHaveCount(0);
});

test('anamnesis later stays paused after reload, at the offer and midway, until the member continues',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await page.reload();
  const resume=page.getByRole('button',{name:'Continue my questions',exact:true});
  await expect(resume).toBeVisible();
  await expect(activeQuestion(page)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Yes, answer now',exact:true})).toHaveCount(0);
  await expect(page.locator('.cv2-composer textarea')).toBeEnabled();
  await resume.click();
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect.poll(()=>assessmentState().saves).toBe(1);
  await activeQuestion(page).getByRole('button',{name:'Later',exact:true}).click();
  await page.reload();
  await expect(resume).toBeVisible();
  await expect(activeQuestion(page)).toHaveCount(0);
  await expect(page.locator('[data-answer-id="q2.weight_perception"]')).toContainText('I think it is normal');
  await resume.click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(resume).toHaveCount(0);
});

test('anamnesis reads the same after a reload and follows the member to the end',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect.poll(()=>assessmentState().saves).toBe(1);
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await page.locator('.cv2-composer textarea').fill('A message after later');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('A message after later',{exact:true})).toBeVisible();
  const order=()=>page.locator('[data-chat-anamnesis] .cv2-say').evaluateAll(nodes=>nodes.map(node=>node.textContent).filter(text=>
    /^(Would you like|Yes, answer now|I think it is normal|Later|A message after later|You can continue)/.test(text!)));
  const before=await order();
  expect(before.slice(-3)).toEqual(['Later','A message after later','You can continue your questions here.']);
  await page.goto(fixture.url+'/patient/chat?anamnesis&keep');
  await expect(page.getByRole('button',{name:'Continue my questions',exact:true})).toBeVisible();
  expect(await order()).toEqual(before);
  await page.getByRole('button',{name:'Continue my questions',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(page.locator('.cv2-me .cv2-say',{hasText:/^Later$/})).toHaveCount(1);
  await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=0;});
  await page.waitForTimeout(100);
  await activeQuestion(page).getByRole('spinbutton').fill('165');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight');
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await expect(page.getByRole('button',{name:'New message',exact:true})).toHaveCount(0);
});

test('anamnesis an emergency typed during a question keeps its 103 card below the question',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect.poll(()=>assessmentState().saves).toBe(1);
  await page.locator('.cv2-composer textarea').fill('I have severe chest pain right now');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const card=page.locator('[data-zoe-emergency-card]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(300);
  await expect.poll(()=>card.evaluate(el=>!!(document.querySelector('[data-question-id]')!.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis&keep');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(activeQuestion(page).locator('xpath=following-sibling::*')).toHaveCount(0);
});

test('anamnesis a saved red answer outranks an earlier later',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Later',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue my questions',exact:true})).toBeVisible();
  seedAssessment({...calmPrefix,'q9.present':'yes','q9.right_now':'yes'});
  await page.reload();
  await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue my questions',exact:true})).toHaveCount(0);
});

test('anamnesis opens after the profile section and says so',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight_perception');
  await expect(activeQuestion(page)).toContainText('Section 2 of 10');
  await expect(activeQuestion(page)).toContainText('Your profile was section 1.');
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(activeQuestion(page)).not.toContainText('Your profile was section 1.');
});

test('anamnesis numeric answer needs confirmation and saved history resumes after reload',async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await choose(page,'q2.weight_perception','I think I am overweight');
  await expect.poll(()=>assessmentState().saves).toBe(1);
  await activeQuestion(page).getByRole('spinbutton').fill('169');
  expect(assessmentState().saves).toBe(1);
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight');
  await expect.poll(()=>assessmentState().saves).toBe(2);
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight');
  await expect(page.locator('[data-answer-id="q2.height"]')).toContainText('169');
  await expect(page.getByRole('button',{name:'Yes, answer now',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-answer-id="q2.weight_perception"]')).toContainText('I think I am overweight');
});

test('anamnesis decimal answers accept the comma that Armenian and Russian keypads type',async({page})=>{
  seedAssessment(Object.fromEntries(Object.entries(calmPrefix).filter(([id])=>!['q8.sleep_hours','q8.stress'].includes(id))));
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q8.sleep_hours');
  await activeQuestion(page).getByRole('textbox').fill('7,5');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(page.locator('[data-answer-id="q8.sleep_hours"]')).toContainText('7.5');
  await expect.poll(()=>assessmentState().assessment.answers['q8.sleep_hours']?.value).toBe(7.5);
  await page.getByRole('button',{name:'Change my last answer',exact:true}).click();
  await activeQuestion(page).getByRole('textbox').fill('1,2,3');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('Check your answer');
  expect(assessmentState().assessment.answers['q8.sleep_hours'].value).toBe(7.5);
});

const signUpCopy = {
  hy: { title: 'Եկեք ծանոթանանք։', consent: 'Նախքան սկսելը', next: 'Շարունակել', name: 'Ձեր անունը', agree: 'Համաձայն եմ և շարունակում եմ' },
  en: { title: 'Let’s get to know you.', consent: 'Before we start', next: 'Continue', name: 'Your name', agree: 'Agree and continue' },
  ru: { title: 'Давайте познакомимся.', consent: 'Прежде чем начать', next: 'Продолжить', name: 'Ваше имя', agree: 'Согласиться и продолжить' },
} as const;
const languageNames = { hy: 'Հայերեն', en: 'English', ru: 'Русский' } as const;
for (const from of ['hy','en','ru'] as const) test(`sign-up language switches at the details step and at the consent step, starting in ${from}`,async({page})=>{
  await page.setViewportSize({width:375,height:700});
  await page.goto(fixture.url+`/patient/chat?signup&language-card&locale=${from}`);
  const choice=(id:keyof typeof languageNames)=>page.locator('[data-signup-language]').getByRole('button',{name:languageNames[id],exact:true});
  await expect(page.locator('h1')).toHaveText(signUpCopy[from].title);
  await expect(choice(from)).toHaveAttribute('aria-pressed','true');
  for (const to of (['hy','en','ru'] as const).filter(id=>id!==from)) {
    await choice(to).click();
    await expect(page.locator('h1')).toHaveText(signUpCopy[to].title);
    await expect(page.getByText(signUpCopy[to].name,{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.cookie)).toContain(`noreon_locale=${to}`);
  }
  await choice('en').click();
  await page.locator('#patient-name').fill('Fictional Signup');
  await page.locator('#birth-date').fill('01/02/1970');
  await page.locator('#birth-date').blur();
  await page.locator('#patient-sex').click();
  await page.getByRole('option',{name:'Male',exact:true}).click();
  await page.getByRole('button',{name:signUpCopy.en.next,exact:true}).click();
  await expect(page.locator('h1')).toHaveText(signUpCopy.en.consent);
  const consentText=await page.locator('form').innerText();
  for (const to of ['ru','hy'] as const) {
    await choice(to).click();
    await expect(page.locator('h1')).toHaveText(signUpCopy[to].consent);
    await expect(page.getByRole('button',{name:signUpCopy[to].agree}).first()).toBeVisible();
    expect(await page.locator('form').innerText()).not.toBe(consentText);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.locator('#patient-name')).toHaveCount(0);
  await choice('en').click();
  await page.getByRole('button',{name:'Back to my details'}).click();
  await expect(page.locator('#patient-name')).toHaveValue('Fictional Signup');
});

const slider = (page:import('@playwright/test').Page) => activeQuestion(page).getByRole('slider');
const seededTo = (last:string) => { const ids=Object.keys(calmPrefix), rest=ids.slice(0,ids.indexOf(last)); return Object.fromEntries(rest.map(id=>[id,calmPrefix[id as keyof typeof calmPrefix]])); };

test('anamnesis height has the original slider and − + with its range, and untouched saves nothing',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  const unset=slider(page);
  await expect(unset).toHaveAttribute('aria-valuemin','120');
  await expect(unset).toHaveAttribute('aria-valuemax','230');
  await expect(unset).not.toHaveAttribute('aria-valuenow',/./);
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('Complete this answer');
  expect(assessmentState().assessment.answers['q2.height']).toBeUndefined();
  await activeQuestion(page).getByRole('button',{name:'Increase cm',exact:true}).click();
  await expect(activeQuestion(page).getByRole('spinbutton')).toHaveValue('170');
  await activeQuestion(page).getByRole('button',{name:'Increase cm',exact:true}).click();
  await expect(slider(page)).toHaveValue('171');
  await slider(page).focus();
  await page.keyboard.press('ArrowRight');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect.poll(()=>assessmentState().assessment.answers['q2.height']?.value).toBe(172);
  await expect(page.locator('[data-answer-id="q2.height"]')).toContainText('172');
});

test('anamnesis refuses a typed answer outside the range and keeps nothing',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await activeQuestion(page).getByRole('spinbutton').fill('500');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('Check your answer');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  expect(assessmentState().assessment.answers['q2.height']).toBeUndefined();
});

test('anamnesis blood pressure saves both parts from the original − + entry and refuses a reversed reading',async({page})=>{
  seedAssessment({...seededTo('q5.diagnosed'),'q5.diagnosed':'no'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q5.last_reading');
  await expect(activeQuestion(page)).toContainText('60–300');
  await expect(activeQuestion(page)).toContainText('30–200');
  await expect(activeQuestion(page).getByRole('slider')).toHaveCount(0);
  await activeQuestion(page).getByRole('button',{name:/^Increase Systolic/}).click();
  await expect(activeQuestion(page).getByLabel(/^Systolic/)).toHaveValue('120');
  await activeQuestion(page).getByRole('button',{name:/^Increase Diastolic/}).click();
  await activeQuestion(page).getByLabel(/^Diastolic/).fill('130');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('must be greater');
  await activeQuestion(page).getByLabel(/^Diastolic/).fill('80');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect.poll(()=>assessmentState().assessment.answers['q5.last_reading.systolic']?.value).toBe(120);
  expect(assessmentState().assessment.answers['q5.last_reading.diastolic']?.value).toBe(80);
  await expect(page.locator('[data-answer-id="q5.last_reading"]')).toContainText('120 / 80');
});

test('anamnesis open top reads 500+ and the slider moves half hours',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok','q2.height':165,'q2.weight':60,'q2.waist':80,'q2.activity':'active'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.activity_minutes');
  await activeQuestion(page).getByRole('spinbutton').fill('900');
  await expect(activeQuestion(page).getByRole('spinbutton')).toHaveValue('500');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(page.locator('[data-answer-id="q2.activity_minutes"]')).toContainText('500+');
  seedAssessment(Object.fromEntries(Object.entries(calmPrefix).filter(([id])=>!['q8.sleep_hours','q8.stress'].includes(id))));
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q8.sleep_hours');
  await activeQuestion(page).getByRole('button',{name:/^Increase/}).click();
  await activeQuestion(page).getByRole('button',{name:/^Increase/}).click();
  await expect(activeQuestion(page).getByRole('textbox')).toHaveValue('7.5');
  await expect(slider(page)).toHaveAttribute('step','0.5');
});

const typeInChat = async(page:import('@playwright/test').Page,text:string) => {
  await page.locator('.cv2-composer textarea').fill(text);
  await page.getByRole('button',{name:'Send',exact:true}).click();
};
const memberSaid = (page:import('@playwright/test').Page,text:string) => page.locator('.cv2-me .cv2-say').filter({hasText:new RegExp(`^${text}$`)});

test('anamnesis a number typed in the chat box fills the open question, Zoe is not called, and the order survives a reload',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await typeInChat(page,'165');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight');
  await expect.poll(()=>assessmentState().assessment.answers['q2.height']?.value).toBe(165);
  await expect(page.locator('.cv2-composer textarea')).toHaveValue('');
  await expect(memberSaid(page,'165')).toHaveCount(0);
  await expect(page.locator('[data-answer-id="q2.height"]')).toContainText('165 cm');
  await typeInChat(page,'60 kg');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.waist');
  await expect.poll(()=>assessmentState().assessment.answers['q2.weight']?.value).toBe(60);
  const order=()=>page.locator('[data-chat-anamnesis] .cv2-say').evaluateAll(nodes=>nodes.map(node=>node.textContent));
  const before=await order();
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.waist');
  expect(await order()).toEqual(before);
  await expect(memberSaid(page,'165')).toHaveCount(0);
});

test('anamnesis text that does not fit the open question still reaches Zoe and fills nothing',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  for(const text of ['500','What does height change?']) {
    await typeInChat(page,text);
    await expect(memberSaid(page,text.replace('?','\\?'))).toHaveCount(1);
  }
  expect(assessmentState().assessment.answers['q2.height']).toBeUndefined();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
});

test('anamnesis urgent words typed in the chat box always take the safety path, even with a number in them',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await typeInChat(page,'165 I have severe chest pain right now');
  await expect(page.getByRole('button',{name:'Call 103 now',exact:true})).toBeVisible();
  expect(assessmentState().assessment.answers['q2.height']).toBeUndefined();
});

test('anamnesis a blood pressure pair and a choice typed in the chat box fill those questions',async({page})=>{
  seedAssessment({...seededTo('q5.diagnosed'),'q5.diagnosed':'no'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q5.last_reading');
  await typeInChat(page,'80/120');
  await expect(memberSaid(page,'80/120')).toHaveCount(1);
  await typeInChat(page,'120/80');
  await expect.poll(()=>assessmentState().assessment.answers['q5.last_reading.systolic']?.value).toBe(120);
  expect(assessmentState().assessment.answers['q5.last_reading.diastolic']?.value).toBe(80);
  await expect(page.locator('[data-answer-id="q5.last_reading"]')).toContainText('120 / 80');
  seedAssessment();
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await typeInChat(page,'I think it is normal');
  await expect.poll(()=>assessmentState().assessment.answers['q2.weight_perception']?.value).toBe('ok');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
});

test('anamnesis blood pressure: one number asks for the other, both blank is unknown, and an off-step weight names the rule',async({page})=>{
  seedAssessment({...seededTo('q5.diagnosed'),'q5.diagnosed':'no'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await activeQuestion(page).getByLabel(/^Systolic/).fill('120');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('Complete this answer');
  await activeQuestion(page).getByLabel(/^Systolic/).fill('');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(page.locator('[data-answer-id="q5.last_reading"]')).toHaveText("I don’t know");
  await expect.poll(()=>assessmentState().assessment.answers['q5.last_reading.systolic']?.value).toBe('unknown');
  seedAssessment({...seededTo('q5.diagnosed'),'q5.diagnosed':'no','q5.last_reading.systolic':120,'q5.last_reading.diastolic':80});
  await page.reload();
  await page.getByRole('button',{name:'Change my last answer',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q5.last_reading');
  await activeQuestion(page).getByLabel(/^Systolic/).fill('');
  await activeQuestion(page).getByLabel(/^Diastolic/).fill('');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect.poll(()=>assessmentState().assessment.answers['q5.last_reading.diastolic']?.value).toBe('unknown');
  await expect(activeQuestion(page)).not.toHaveAttribute('data-question-id','q5.last_reading');
  seedAssessment({'q2.weight_perception':'ok','q2.height':165});
  await page.reload();
  await activeQuestion(page).getByRole('spinbutton').fill('72.5');
  await expect(slider(page)).toBeVisible();
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page).getByRole('alert')).toContainText('Enter a whole number from 30 to 300');
});

test('anamnesis change my last answer steps back once and is gone on the first question',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok','q2.height':165});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight');
  const back=page.getByRole('button',{name:'Change my last answer',exact:true});
  await back.click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await back.click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.weight_perception');
  await expect(back).toHaveCount(0);
});

test('anamnesis a high reading from the number controls still opens the crisis gate and a red answer the 103 card',async({page})=>{
  seedAssessment({...seededTo('q5.diagnosed'),'q5.diagnosed':'no'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await activeQuestion(page).getByLabel(/^Systolic/).fill('190');
  await activeQuestion(page).getByLabel(/^Diastolic/).fill('115');
  await activeQuestion(page).getByRole('button',{name:'Confirm answer',exact:true}).click();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q5.crisis_symptoms');
  await activeQuestion(page).getByRole('button',{name:'Chest pain',exact:true}).click();
  await expect(page.locator('[data-questionnaire-urgent]')).toBeVisible();
  await expect(page.locator('[data-questionnaire-urgent]')).toContainText('103');
  await expect(activeQuestion(page)).toHaveCount(0);
});

for(const [locale,increase,unit] of [['en','Increase','cm'],['hy','Ավելացնել','սմ'],['ru','Увеличить','см']] as const) test(`anamnesis number controls fit a phone in ${locale}`,async({page},testInfo)=>{
  await page.setViewportSize({width:375,height:667});
  seedAssessment({'q2.weight_perception':'ok'});
  await page.goto(fixture.url+`/patient/chat?empty&anamnesis&locale=${locale}`);
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await expect(activeQuestion(page)).toContainText(unit);
  await page.screenshot({path:testInfo.outputPath(`height-unset-${locale}.png`),fullPage:true});
  await activeQuestion(page).getByRole('button',{name:new RegExp('^'+increase)}).click();
  await page.screenshot({path:testInfo.outputPath(`height-set-${locale}.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const fits=await activeQuestion(page).evaluate(node=>{const box=node.getBoundingClientRect();return [...node.querySelectorAll('button,input')].every(el=>{const r=el.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});});
  expect(fits).toBe(true);
});

test('anamnesis a skipped waist shows the skip wording and stays unknown',async({page})=>{
  seedAssessment({'q2.weight_perception':'ok','q2.height':165,'q2.weight':60});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await choose(page,'q2.waist','Skip measurement');
  await expect(page.locator('[data-answer-id="q2.waist"]')).toHaveText('Skip measurement');
  await expect.poll(()=>assessmentState().assessment.answers['q2.waist']?.value).toBe('unknown');
});

test('anamnesis failed save retains the answer and explicit retry writes it once',async({page})=>{
  seedAssessment();
  fixture.respond(fixture.url+'/fixture/answer-failure','POST',JSON.stringify({remaining:4}));
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await choose(page,'q2.weight_perception','I think it is normal');
  const retry=page.getByRole('button',{name:'Retry saving answers',exact:true});
  await expect(retry).toBeVisible();
  expect(assessmentState().saves).toBe(0);
  await expect(page.locator('[data-answer-id="q2.weight_perception"]')).toContainText('I think it is normal');
  await retry.click();
  await expect.poll(()=>assessmentState().saves).toBe(1);
  await expect(retry).toHaveCount(0);
  expect(assessmentState().assessment.answers['q2.weight_perception'].value).toBe('ok');
  await page.reload();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  expect(assessmentState().saves).toBe(1);
});

test('anamnesis chest-pain no skips the right-now gate; changing last answer opens it before clarifiers',async({page})=>{
  seedAssessment(calmPrefix);
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await choose(page,'q9.present','No');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q10.symptoms');
  await expect(page.locator('[data-answer-id="q9.right_now"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Change my last answer',exact:true}).click();
  await choose(page,'q9.present','Yes');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q9.right_now');
  await expect(page.locator('[data-question-id="q9.frequency"]')).toHaveCount(0);
  await choose(page,'q9.right_now','No, not right now');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q9.frequency');
  await expect(page.locator('[data-zoe-emergency-card]')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-fixture-navigation');
  await expect(page.locator('a[href]')).toHaveCount(0);
});

for(const fullRoute of [false,true]) {
  test(`anamnesis current chest pain ${fullRoute?'opens full urgent route':'stays in an inline urgent card'}`,async({page})=>{
    seedAssessment(calmPrefix);
    await page.goto(fixture.url+'/patient/chat?empty&anamnesis'+(fullRoute?'&full-urgent':''));
    await choose(page,'q9.present','Yes');
    await choose(page,'q9.right_now','Yes, right now');
    await expect.poll(()=>assessmentState().assessment.answers['q9.right_now']?.value).toBe('yes');
    if(fullRoute) await expect(page.locator('html')).toHaveAttribute('data-fixture-navigation',/\/patient\/urgent/);
    else {
      await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
      const call=page.getByRole('button',{name:'Call 103 now',exact:true});
      await expect(call).toBeVisible();
      // The chat's soft answer button must not restyle the emergency call.
      expect(await call.evaluate(el=>{
        const soft=document.createElement('i');soft.style.background='var(--cv2-blue-soft)';el.closest('.cv2-root')!.append(soft);
        const colour=getComputedStyle(soft).backgroundColor;soft.remove();
        return getComputedStyle(el).backgroundColor!==colour;
      })).toBe(true);
      await expect(page.locator('html')).not.toHaveAttribute('data-fixture-navigation');
      await expect(page.locator('a[href]')).toHaveCount(0);
    }
    await expect(activeQuestion(page)).toHaveCount(0);
    await expect(page.locator('[data-answer-id="q9.frequency"]')).toHaveCount(0);
  });
}

test('anamnesis completion stays in chat at desktop size and survives reload',async({page})=>{
  seedAssessment({...calmPrefix,'q9.present':'no'});
  await page.setViewportSize({width:1280,height:800});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await choose(page,'q10.symptoms','No');
  await expect.poll(()=>assessmentState().assessment.completedAt).not.toBeNull();
  await expect(activeQuestion(page)).toHaveCount(0);
  await expect(page.locator('.cv2-composer textarea')).toBeEnabled();
  await expect(page.locator('a[href]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();
  await expect(activeQuestion(page)).toHaveCount(0);
  await expect(page.locator('[data-answer-id="q10.symptoms"]')).toContainText('No');
  await expect(page.getByRole('button',{name:'Yes, answer now',exact:true})).toHaveCount(0);
});

test('anamnesis history keeps blood pressure order and interleaves ordinary chat by time',async({page})=>{
  const initial=draft(calmPrefix);
  const systolic=initial.answers['q5.last_reading.systolic'];
  delete initial.answers['q5.last_reading.systolic'];
  initial.answers['q5.last_reading.systolic']=systolic;
  initial.answers['q2.weight_perception'].answeredAt='2026-10-01T00:10:00.000Z';
  initial.answers['q2.height'].answeredAt='2026-10-01T00:12:00.000Z';
  fixture.respond(fixture.url+'/fixture/assessment','POST',JSON.stringify(initial));
  await page.goto(fixture.url+'/patient/chat?anamnesis');
  await expect(page.locator('[data-answer-id="q5.last_reading"]')).toHaveText('120 / 80');
  await page.getByRole('button',{name:'Later',exact:true}).click();
  const order=await page.locator('[data-answer-id="q2.weight_perception"], [data-answer-id="q2.height"], .cv2-doctor, .cv2-me').evaluateAll(nodes=>
    nodes.flatMap(node=>node.getAttribute('data-answer-id')==='q2.weight_perception'?['first-answer']:
      node.getAttribute('data-answer-id')==='q2.height'?['second-answer']:
      node.textContent?.includes('Recorded doctor reply 11.')?['ordinary-message']:
      node.textContent==='Later'?['later']:[]));
  expect(order).toEqual(['first-answer','ordinary-message','second-answer','later']);
});

test('anamnesis saved red answer shows call guidance while chat consent is unresolved',async({page})=>{
  seedAssessment({...calmPrefix,'q9.present':'yes','q9.right_now':'yes'});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis&consent');
  await expect(page.locator('[data-zoe-chat-consent]')).toBeVisible();
  await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Call 103 now',exact:true})).toBeVisible();
  await expect(activeQuestion(page)).toHaveCount(0);
});

// The switch. With V3 off the page gets NO_CARDS, and nothing about cards may happen.
test('V3 off: no card read or request, no card markup, a reading stays an ordinary message',async({page})=>{
  const reads:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/patient/zoe/cards')reads.push(request.url());});
  await page.goto(fixture.url+'/patient/chat?empty');
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(0);
  await page.locator('.cv2-composer textarea').fill('148/93');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.cv2-me .cv2-say')).toHaveText('148/93');
  await page.locator('.cv2-composer textarea').fill('record my blood pressure');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('.cv2-me .cv2-say').last()).toHaveText('record my blood pressure');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(1);
  await page.waitForTimeout(300);
  expect(reads).toEqual([]);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body)).toMatchObject({opens:[],cardReads:0});
  await expect(page.locator('[data-zoe-card]')).toHaveCount(0);
  await expect(page.locator('[data-chat-suggestions]')).toHaveCount(0);
  await expect(page.locator('[data-turn-reply]')).toHaveCount(0);
});

test('V3 on: the chat reads cards on its polls',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&empty');
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).cardReads).toBeGreaterThan(0);
});

for(const v3 of [false,true]) test(`V3 ${v3?'on':'off'}: an anamnesis in progress and a pending send still render`,async({page})=>{
  seedAssessment();
  await page.goto(fixture.url+`/patient/chat?empty&anamnesis${v3?'&v3':''}`);
  await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
  await choose(page,'q2.weight_perception','I think it is normal');
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
  await page.locator('.cv2-composer textarea').fill('offline');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-pending="failed"]')).toContainText('offline');
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
});

const sendMessage = async (page: import('@playwright/test').Page, text: string, send = 'Send') => {
  await page.locator('.cv2-composer textarea').fill(text);
  await page.getByRole('button',{name:send,exact:true}).click();
};
const readingCard = (page: import('@playwright/test').Page) => page.locator('[data-zoe-card="bp"]');
const bpState = () => JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body);
const reply = (page: import('@playwright/test').Page) => page.locator('[data-turn-reply]');
const thread = (page: import('@playwright/test').Page) => page.locator('.cv2-messages > *').evaluateAll(all=>all.filter(el=>!el.querySelector('.cv2-typing')).map(el=>({me:el.classList.contains('cv2-me'),form:!!el.querySelector('form'),text:el.textContent ?? ''})));
for(const [locale,request,send] of [
  ['en','record my blood pressure','Send'],
  ['hy','Ուզում եմ գրանցել ճնշումս','Ուղարկել'],
  ['ru','Я хочу записать давление','Отправить'],
]) test(`${locale}: a BP request sends visible text then opens only the inline reading`,async({page})=>{
  await page.goto(fixture.url+`/patient/chat?v3&empty&locale=${locale}`);
  await sendMessage(page,request,send);
  await expect(page.locator('.cv2-me .cv2-say')).toHaveText(request);
  await expect(readingCard(page)).toBeVisible();
  await expect(readingCard(page).locator('input').first()).toBeFocused();
  await expect(readingCard(page).locator('input')).toHaveCount(3);
  for(const field of await readingCard(page).locator('input').all()) {
    await expect(field).toHaveAttribute('inputmode','numeric');
    expect(await field.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await expect(page.locator('a[href]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/patient\/chat/);
});

test('only the due reading suggestion sends a real message and opens the same card',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&empty');
  await expect(page.locator('[data-chat-suggestions] button')).toHaveCount(1);
  await page.getByRole('button',{name:'I want to record my blood pressure',exact:true}).click();
  await expect(page.locator('.cv2-me .cv2-say')).toHaveText('I want to record my blood pressure');
  await expect(readingCard(page)).toBeVisible();
  await expect(page.locator('[data-chat-suggestions] button')).toHaveCount(0);
  await expect(page.locator('a[href]')).toHaveCount(0);
});

test('plain reading keeps today, retry uses one submission and time, saved state survives an older poll',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&empty&fail-save&stale-poll');
  await sendMessage(page,'148/93');
  const card=readingCard(page);
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Top',{exact:true})).toHaveValue('148');
  await expect(card.getByLabel('Bottom',{exact:true})).toHaveValue('93');
  await expect(card.getByLabel(/Pulse/)).toBeFocused();
  const save=card.getByRole('button',{name:'Save reading',exact:true});
  await save.click();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(card.locator('a[href]')).toHaveCount(0);
  await save.click();
  await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93.');
  await expect(card).toHaveCount(0);
  await expect(reply(page)).toContainText('4 of 28 readings saved');
  await expect(reply(page)).toContainText('At this stage, the reading is saved in your history. It does not automatically notify a doctor.');
  await expect(reply(page)).toContainText('If this reading worries you, write to Zoe here.');
  // The numbers are in the member's own message above, so they are not said twice.
  await expect(page.locator('[data-turn-action]')).toHaveCount(0);
  // A reading was just given, so another one is not offered yet.
  await expect(page.locator('[data-chat-suggestions] button')).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(1);
  await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93.');
  await expect(card).toHaveCount(0);
  const {saves,cards}=bpState();
  expect(saves).toHaveLength(2); expect(saves[1]).toEqual(saves[0]);
  expect(saves[0].measuredAt).toBe(cards.cards[0].snapshot.typed.measuredAt);
  expect(new Date(saves[0].measuredAt).toDateString()).toBe(new Date().toDateString());
  expect(cards.cards.filter((c:{state:string})=>c.state==='done')).toHaveLength(1);
  expect(bpState().measurements).toHaveLength(1);
  await expect(page.locator('a[href]')).toHaveCount(0);
  expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('invalid numbers stay inline without a save; optional pulse can be empty',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&empty'); await sendMessage(page,'record my blood pressure');
  const card=readingCard(page); await expect(card).toBeVisible();
  for(const [top,bottom,pulse] of [['999','93',''],['90','100',''],['148','93','abc'],['','93',''],['148','93','2']]) {
    await card.getByLabel('Top',{exact:true}).fill(top);
    await card.getByLabel('Bottom',{exact:true}).fill(bottom);
    await card.getByLabel(/Pulse/).fill(pulse);
    await card.getByRole('button',{name:'Save reading',exact:true}).click();
    expect(bpState().saves).toHaveLength(0);
    await expect(card.locator('[data-bp-summary]')).toBeVisible();
    await expect(card.locator('a[href]')).toHaveCount(0);
  }
  await card.getByLabel('Top',{exact:true}).fill('148'); await card.getByLabel('Bottom',{exact:true}).fill('93');
  await card.getByLabel(/Pulse/).fill('');
  await card.getByRole('button',{name:'Save reading',exact:true}).click();
  await expect(reply(page).locator('[data-zoe-bp-saved]')).toBeVisible();
  expect(bpState().saves[0].pulse).toBe(null);
});

test('a reading arriving while reading history keeps the reader and composer focus',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3');
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
  await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
  await page.waitForTimeout(100);
  const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
  await page.locator('.cv2-composer textarea').focus();
  fixture.respond(fixture.url+'/fixture/arrive-card','POST');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(readingCard(page)).toHaveCount(1);
  expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
  await expect(page.locator('.cv2-composer textarea')).toBeFocused();
  await page.getByRole('button',{name:'New message',exact:true}).click();
  await expect.poll(()=>bottom(page)).toBeLessThan(2);
});

test('hidden card requests stay ordinary messages and never open controls',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&empty');
  for(const text of ['I took my medicines','Help me book my visit','I want to see my results','I want to read my plan']) {
    await sendMessage(page,text);
    await expect(page.locator('.cv2-me .cv2-say').last()).toHaveText(text);
    await expect(page.locator('[data-zoe-card]')).toHaveCount(0);
  }
  expect(bpState().opens).toHaveLength(0);
  await expect(page.locator('a[href]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/patient\/chat/);
});

for(const status of ['stale','signed_out','rate_limited','disabled','closed','unavailable']) {
 test(`BP ${status} stays inline with zero links`,async({page})=>{
  await page.goto(fixture.url+`/patient/chat?v3&empty&save-status=${status}`); await sendMessage(page,'148/93');
  const card=readingCard(page); await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Save reading',exact:true}).click();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(page.locator('a[href]')).toHaveCount(0); expect(bpState().measurements).toHaveLength(0);
  await expect(page).toHaveURL(/\/patient\/chat/);
 });
}

test('lost save reply recovers the receipt by polling with one stored reading',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty&lose-save'); await sendMessage(page,'148/93');
 await expect(readingCard(page)).toBeVisible();
 await readingCard(page).getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93.');
 expect(bpState().measurements).toHaveLength(1);
 await expect(readingCard(page)).toHaveCount(0);
 await expect(page.locator('a[href]')).toHaveCount(0);
});

test('numbers typed into a card stay when a newer card opens',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty'); await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toHaveCount(1);
 await page.getByRole('textbox',{name:'Top',exact:true}).fill('146');
 await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toHaveCount(2);
 await expect(page.getByRole('textbox',{name:'Top',exact:true}).first()).toHaveValue('146');
});

for(const mode of ['fail-open','lose-open']) test(`${mode}: recovery does not block a newer BP request`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?v3&empty&${mode}`); await sendMessage(page,'record my blood pressure');
 if(mode==='fail-open') await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
 else {
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(readingCard(page)).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 }
 await sendMessage(page,'148/93');
 await expect.poll(()=>bpState().opens.length).toBe(2);
 await expect(readingCard(page)).toHaveCount(1);
 await expect(page.locator('a[href]')).toHaveCount(0);
});

test('closed and unreadable card states have no leaving links',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty&unreadable');
 await expect(readingCard(page)).toHaveAttribute('data-state','unavailable');
 await expect(page.locator('a[href]')).toHaveCount(0);
 await page.goto(fixture.url+'/patient/chat?v3&empty&closed');
 await expect(readingCard(page)).toHaveAttribute('data-state','done');
 await expect(readingCard(page).locator('input')).toHaveCount(0);
 await expect(page.locator('a[href]')).toHaveCount(0);
});

test('with a short keyboard viewport the fields and Save stay reachable in the thread',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3'); await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toBeVisible();
 await page.setViewportSize({width:402,height:390});
 await readingCard(page).getByLabel('Top',{exact:true}).fill('148');
 await readingCard(page).getByLabel('Bottom',{exact:true}).fill('93');
 await readingCard(page).getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toBeVisible();
 expect(await page.evaluate(()=>scrollY)).toBe(0);
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
});

test('saving from an older card lands at the end as a dialog, follows there, and reads the same after a poll, a reload and on a second device',async({page,context})=>{
 await page.goto(fixture.url+'/patient/chat?v3'); await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toBeVisible();
 await readingCard(page).getByLabel('Top',{exact:true}).fill('148');
 await readingCard(page).getByLabel('Bottom',{exact:true}).fill('93');
 await readingCard(page).getByLabel(/Pulse/).fill('72');
 for(const text of ['A later question','Another later question','One more later question','And one more','The last one']){
  await sendMessage(page,text);
  await expect(page.locator('.cv2-me .cv2-say').last()).toHaveText(text);
 }
 await expect(page.locator('.cv2-me')).toHaveCount(6);
 // Reading back up to the older form, the way a member would.
 await page.locator('.cv2-thread').evaluate(el=>{
  el.dispatchEvent(new Event('touchstart'));
  el.scrollTop=(el.querySelector('[data-zoe-card]') as HTMLElement).offsetTop-el.getBoundingClientRect().top-40;
 });
 await page.waitForTimeout(100);
 expect(await bottom(page)).toBeGreaterThan(50);
 await page.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93, pulse 72.');
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 await expect(page.getByRole('button',{name:'New message',exact:true})).toHaveCount(0);
 const end=async(p:import('@playwright/test').Page)=>{
  const list=await thread(p);
  expect(list.some(row=>row.form)).toBe(false);
  expect(list.at(-2)).toMatchObject({me:true});
  expect(list.at(-2)!.text).toContain('148/93, pulse 72');
  expect(list.at(-1)!.text).toContain('Saved: 148/93, pulse 72.');
  expect(list.at(-3)!.text).toContain('The last one');
  return list.map(row=>row.text.replace(/\d\d:\d\d.*$/,''));
 };
 const shown=await end(page);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(async()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(0);
 await page.waitForTimeout(200);
 expect(await end(page)).toEqual(shown);
 // A second device opens the same chat.
 const other=await context.newPage();
 await other.route('**/*', route => route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??'')));
 await other.goto(fixture.url+'/patient/chat?v3&keep');
 await expect(reply(other)).toBeVisible();
 expect(await end(other)).toEqual(shown);
 await other.close();
 await page.goto(fixture.url+'/patient/chat?v3&keep');
 await expect(reply(page)).toBeVisible();
 expect(await end(page)).toEqual(shown);
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 expect(bpState().measurements).toHaveLength(1);
 // The member can go on talking, and that goes after the reply.
 await sendMessage(page,'Thank you');
 await expect(page.locator('.cv2-me .cv2-say').last()).toHaveText('Thank you');
 const list=await thread(page);
 expect(list.at(-1)!.text).toContain('Thank you');
 expect(list.at(-2)!.text).toContain('Saved: 148/93, pulse 72.');
 expect(await page.locator('form:not(.cv2-composer)').count()).toBe(0);
});

test('a save from another device leaves a reader where they are',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3'); await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toBeVisible();
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.waitForTimeout(100);
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 fixture.respond(fixture.url+'/fixture/save-bp','POST',JSON.stringify({cardId:bpState().cards.cards[0].id,systolic:130,diastolic:80,pulse:null,measuredAt:new Date().toISOString(),submissionId:crypto.randomUUID()}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(reply(page)).toBeVisible();
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
 await expect(page.getByRole('button',{name:'New message',exact:true})).toBeVisible();
});

test('a refused save followed by a save on another device leaves a reader where they are',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&fail-save'); await sendMessage(page,'148/93');
 const card=readingCard(page); await expect(card).toBeVisible();
 await card.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(card.getByRole('alert')).toBeVisible();
 await page.locator('.cv2-thread').evaluate(el=>{el.dispatchEvent(new Event('touchstart'));el.scrollTop=700;});
 await page.waitForTimeout(100);
 const top=await page.locator('.cv2-thread').evaluate(el=>el.scrollTop);
 fixture.respond(fixture.url+'/fixture/save-bp','POST',JSON.stringify({cardId:bpState().cards.cards[0].id,systolic:130,diastolic:80,pulse:null,measuredAt:new Date().toISOString(),submissionId:crypto.randomUUID()}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(reply(page)).toBeVisible();
 expect(await page.locator('.cv2-thread').evaluate(el=>el.scrollTop)).toBe(top);
});

test('a later save leaves a card still holding numbers from the member\'s own message',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty'); await sendMessage(page,'record my blood pressure');
 await expect(readingCard(page)).toHaveCount(1);
 await page.getByRole('textbox',{name:'Top',exact:true}).fill('146');
 await page.getByRole('textbox',{name:'Bottom',exact:true}).fill('92');
 await sendMessage(page,'152/96');
 await expect(readingCard(page)).toHaveCount(2);
 await readingCard(page).first().getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 146/92.');
 await expect(readingCard(page)).toHaveCount(1);
 await expect(readingCard(page).getByRole('textbox',{name:'Top',exact:true})).toHaveValue('152');
 await page.goto(fixture.url+'/patient/chat?v3&keep');
 await expect(readingCard(page).getByRole('textbox',{name:'Top',exact:true})).toHaveValue('152');
});

test('a number changed in a card filled from a message shows as the member\'s own message',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty'); await sendMessage(page,'152/96');
 const card=readingCard(page); await expect(card).toBeVisible();
 await card.getByLabel('Bottom',{exact:true}).fill('94');
 await card.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 152/94.');
 expect((await page.locator('.cv2-me .cv2-say').allTextContents())).toEqual(['152/96','152/94']);
});

for(const v3 of [false,true]) test(`V3 ${v3?'on':'off'}: a request with no card here keeps Zoe's reply`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?empty&task-replies${v3?'&v3':''}`);
 await sendMessage(page,'I took my medicines');
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toBeVisible();
 await expect(page.locator('[data-zoe-card]')).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect.poll(()=>JSON.parse(fixture.respond(fixture.url+'/fixture/polls').body)).toBeGreaterThan(0);
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toBeVisible();
});

test('a reading request answered by its card does not also say so, in the thread or the anamnesis',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&empty&task-replies');
 await sendMessage(page,'I want to record my blood pressure');
 await expect(readingCard(page)).toBeVisible();
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toHaveCount(0);
 await page.goto(fixture.url+'/patient/chat?v3&keep');
 await expect(readingCard(page)).toBeVisible();
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toHaveCount(0);
 seedAssessment();
 await page.goto(fixture.url+'/patient/chat?v3&empty&anamnesis&task-replies');
 await sendMessage(page,'I want to record my blood pressure');
 await expect(readingCard(page)).toBeVisible();
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toHaveCount(0);
 await sendMessage(page,'I took my medicines');
 await expect(page.getByText('You can do that on the card here.',{exact:true})).toHaveCount(1);
});

// With an assessment the anamnesis draws the thread, so this is the path a registered member sees.
test('anamnesis: an open card sits below the open question, the save lands in order, and a reload shows the same',async({page})=>{
 seedAssessment();
 await page.goto(fixture.url+'/patient/chat?v3&empty&anamnesis');
 await page.getByRole('button',{name:'Yes, answer now',exact:true}).click();
 await choose(page,'q2.weight_perception','I think it is normal');
 await expect(activeQuestion(page)).toHaveAttribute('data-question-id','q2.height');
 await expect.poll(()=>assessmentState().saves).toBe(1);
 await sendMessage(page,'148/93');
 const card=readingCard(page);
 await expect(card).toBeVisible();
 await expect(card.getByLabel(/Pulse/)).toBeFocused();
 await expect(activeQuestion(page).locator('xpath=following-sibling::*[@data-zoe-card]')).toHaveCount(1);
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 // The questionnaire's answer buttons must not restyle Save here.
 const look=(selector:string)=>page.locator(selector).evaluate(el=>{const {backgroundColor,borderRadius}=getComputedStyle(el);return {backgroundColor,borderRadius};});
 expect(await look('.cv2-reading-save')).toEqual(await look('.cv2-composer button[type=submit]'));
 await card.getByLabel(/Pulse/).fill('abc');
 await card.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(card.getByRole('alert')).toBeVisible();
 await expect(card).toBeInViewport();
 await card.getByLabel(/Pulse/).fill('72');
 await card.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93, pulse 72.');
 await expect(card).toHaveCount(0);
 const order=()=>page.locator('[data-chat-anamnesis] > *').evaluateAll(nodes=>nodes.map(node=>
  node.hasAttribute('data-question-id')?'question':node.hasAttribute('data-turn-action')?'action':node.hasAttribute('data-turn-reply')?'reply':node.getAttribute('data-answer-id')??'').filter(Boolean));
 expect((await order()).slice(-3)).toEqual(['action','reply','question']);
 await expect.poll(()=>bottom(page)).toBeLessThan(2);
 const before=await order();
 await page.goto(fixture.url+'/patient/chat?v3&empty&anamnesis&keep');
 await expect(reply(page)).toBeVisible();
 expect(await order()).toEqual(before);
 expect(bpState().measurements).toHaveLength(1);
});

test('anamnesis: a saved reading reads in time order with a finished questionnaire',async({page})=>{
 const finished=draft({...calmPrefix,'q9.present':'no','q10.symptoms':'no'});
 finished.completedAt='2026-10-01T02:00:00.000Z';
 fixture.respond(fixture.url+'/fixture/assessment','POST',JSON.stringify(finished));
 await page.goto(fixture.url+'/patient/chat?v3&anamnesis');
 await expect(page.getByText('Your questionnaire is complete.',{exact:true})).toBeVisible();
 await sendMessage(page,'record my blood pressure');
 const card=readingCard(page); await expect(card).toBeVisible();
 await card.getByLabel('Top',{exact:true}).fill('148');
 await card.getByLabel('Bottom',{exact:true}).fill('93');
 await card.getByRole('button',{name:'Save reading',exact:true}).click();
 await expect(reply(page).locator('[data-zoe-bp-saved]')).toHaveText('Saved: 148/93.');
 const rows=await page.locator('[data-chat-anamnesis] > *').evaluateAll(nodes=>nodes.filter(node=>!node.querySelector('.cv2-typing')).map(node=>node.textContent ?? ''));
 expect(rows.at(-2)).toContain('148/93');
 expect(rows.at(-1)).toContain('Saved: 148/93.');
});

// Blood pressure flow (V3). The rules run on the server and in scripts/check-zoe-bp-flow.ts; here the fixture gives their outcome.
const shots = process.env.ZOE_PR4_SHOTS;
const shot = async (page: import('@playwright/test').Page, name: string) => { if(shots) await page.screenshot({path:`${shots}/${name}.png`}); };
const saveBp = async (page: import('@playwright/test').Page, top='166', bottom='98') => {
  await page.getByLabel('Top',{exact:true}).fill(top);
  await page.getByLabel('Bottom',{exact:true}).fill(bottom);
  await page.getByRole('button',{name:'Save reading'}).click();
};
const openBp = async (page: import('@playwright/test').Page, query: string) => {
  await page.goto(fixture.url+`/patient/chat?v3&${query}`);
  await page.getByRole('textbox',{name:'Your message'}).fill('I want to record my blood pressure');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.locator('[data-zoe-card="bp"]')).toBeVisible();
};
const answerNo = async (page: import('@playwright/test').Page, times: number) => {
  for(let i=0;i<times;i++){
    const before=await page.locator('[data-zoe-card="red_flags"] h3').textContent();
    await page.locator('[data-flag-answer="no"]').click();
    if(i<times-1) await expect(page.locator('[data-zoe-card="red_flags"] h3')).not.toHaveText(before!);
  }
};

test('BP causal ordering: reading and reply precede each next form after save, final No, reload and second device',async({page,browser})=>{
  await openBp(page,'flow=high');
  await saveBp(page);
  const sequence=async(p: import('@playwright/test').Page)=>p.locator('[data-turn-action], [data-zoe-card="red_flags"], [data-zoe-card="repeat"]').evaluateAll(nodes=>nodes.map(n=>n.hasAttribute('data-turn-action')?'turn':n.getAttribute('data-zoe-card')));
  await expect.poll(()=>sequence(page)).toEqual(['turn','red_flags']);
  const stored=JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).cards.cards;
  expect(Date.parse(stored[1].at)).toBeLessThan(Date.parse(stored[0].outcome.bp.doneAt));
  await page.goto(fixture.url+'/patient/chat?v3&keep&flow=high');
  await expect.poll(()=>sequence(page)).toEqual(['turn','red_flags']);
  await answerNo(page,5);
  await expect.poll(()=>sequence(page)).toEqual(['turn','turn','repeat']);
  const after=JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).cards.cards;
  expect(Date.parse(after[2].at)).toBeLessThan(Date.parse(after[1].outcome['a:faint'].doneAt));
  await page.goto(fixture.url+'/patient/chat?v3&keep&flow=high');
  await expect.poll(()=>sequence(page)).toEqual(['turn','turn','repeat']);
  const device=await browser.newContext({viewport:{width:1280,height:800}});
  try{
    const second=await device.newPage();
    await second.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.fulfill(fixture.respond(route.request().url(),route.request().method(),route.request().postData()??'')));
    await second.goto(fixture.url+'/patient/chat?v3&keep&flow=high');
    await expect.poll(()=>sequence(second)).toEqual(['turn','turn','repeat']);
  }finally{await device.close();}
});

test('Scenario B: flags all no, a repeat, then a nurse task with the chip; order survives a reload',async({page})=>{
  await openBp(page,'flow=high');
  await saveBp(page);
  await expect(page.locator('[data-zoe-card="bp"]')).toHaveCount(0);
  await expect(page.locator('[data-turn-action]').last()).toHaveText(/166\/98/);
  const composer=page.getByRole('textbox',{name:'Your message'});
  await expect(composer).toBeDisabled();
  await expect(composer).toHaveAttribute('placeholder','Answer the question above first');
  await expect(page.locator('[data-zoe-strip]')).toContainText('Yellow zone');
  await expect(page.locator('[data-zoe-strip]')).toContainText('Answer 5 safety questions');
  await expect(page.getByText('It does not automatically notify a doctor')).toHaveCount(0);
  await answerNo(page,5);
  await expect(composer).toBeEnabled();
  await expect(page.locator('[data-zoe-card="repeat"]')).toBeVisible();
  await expect(page.getByText('Rest seated for 5 minutes')).toBeVisible();
  await expect(page.getByRole('button',{name:'Save reading'})).toHaveCount(0);
  await page.locator('[data-skip-wait]').click();
  await saveBp(page,'164','96');
  await expect(page.locator('[data-zoe-chip="sent"]')).toHaveText('Sent · within 48 hours');
  await expect(page.getByText('Your nurse will look at this within 48 hours.')).toBeVisible();
  await expect(page.locator('[data-zoe-card="repeat"]')).toHaveCount(0);
  const order=()=>page.locator('[data-turn-action] .cv2-say').allTextContents();
  const seen=await order();
  expect(seen).toEqual([expect.stringContaining('166/98'),'I have none of these right now.',expect.stringContaining('164/96')]);
  await page.goto(fixture.url+'/patient/chat?v3&keep&flow=high');
  await expect(page.locator('[data-zoe-chip="sent"]')).toBeVisible();
  expect(await order()).toEqual(seen);
  fixture.respond(fixture.url+'/fixture/task-seen');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-zoe-chip="seen_nurse"]')).toHaveText('Seen by nurse · within 48 hours');
});

test('A yes opens the 103 card from the saved outcome, ends the questions, and survives a reload',async({page})=>{
  await openBp(page,'flow=high');
  await saveBp(page,'183','112');
  await page.locator('[data-flag-answer="yes"]').click();
  const urgent=page.locator('[data-zoe-emergency-card]');
  await expect(urgent).toBeVisible();
  await expect(urgent.getByText('We have told the Noreon care team about this answer.')).toBeVisible();
  await expect(page.locator('[data-zoe-card="red_flags"]')).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Your message'})).toBeEnabled();
  await expect(page.locator('[data-zoe-strip]')).toContainText('Red zone');
  await expect(page.locator('[data-zoe-strip]')).toContainText('Call 103');
  // Under the member's own message, once.
  await expect(page.locator('.cv2-me',{hasText:'Fixed message chest_pain'})).toHaveCount(1);
  await expect(page.locator('.cv2-typing')).toHaveCount(0);
  await page.goto(fixture.url+'/patient/chat?v3&keep&flow=high');
  await expect(urgent).toBeVisible();
  await expect(urgent.getByText('We have told the Noreon care team about this answer.')).toBeVisible();
});

test('A yes shows 103 even when the answer never reaches the server',async({page})=>{
  await openBp(page,'flow=high&fail-flag');
  await saveBp(page,'183','112');
  await page.locator('[data-flag-answer="yes"]').click();
  await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  await expect(page.locator('[data-zoe-emergency-card]').getByRole('link').or(page.locator('[data-zoe-emergency-card]').getByRole('button')).first()).toBeVisible();
});

test('No care team: no sent words and no chip',async({page})=>{
  await openBp(page,'flow=no-team');
  await saveBp(page);
  await expect(page.getByText('This did not go to your care team automatically.')).toBeVisible();
  await expect(page.locator('[data-zoe-chip]')).toHaveCount(0);
  await expect(page.getByText(/will look at this|will review this/)).toHaveCount(0);
});

test('Orange names the doctor, the dose line and the out-of-hours text; green is neutral with no strip',async({page})=>{
  await openBp(page,'flow=orange');
  await saveBp(page,'185','100');
  // Opening-hours information supplements the stored doctor urgency and deadline.
  await expect(page.getByText('Don’t take a double or unprescribed dose.')).toBeVisible();
  await expect(page.locator('[data-zoe-out-of-hours]')).toBeVisible();
  await expect(page.getByText('Your doctor will review this today.')).toBeVisible();
  await expect(page.locator('[data-zoe-chip="sent"]')).toHaveText('Sent · within 4 hours');
  await openBp(page,'flow=orange-day');
  await saveBp(page,'185','100');
  await expect(page.getByText('Your doctor will review this today.')).toBeVisible();
  await expect(page.locator('[data-zoe-chip="sent"]')).toHaveText('Sent · within 4 hours');
  await openBp(page,'flow=green');
  await saveBp(page,'120','75');
  await expect(page.getByText('Thank you, this is saved.')).toBeVisible();
  await expect(page.locator('[data-zoe-strip]')).toHaveCount(0);
  await expect(page.locator('[data-zoe-chip]')).toHaveCount(0);
});

test('V3 off: no flow cards, strip or card reads',async({page})=>{
  await page.goto(fixture.url+'/patient/chat');
  await expect(page.getByText(/Recorded doctor reply 99/)).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-zoe-strip],[data-zoe-card]')).toHaveCount(0);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/bp-state').body).cardReads).toBe(0);
});

// Fresh eyes: ZOE_PR4_SHOTS=<dir> writes each new card and the strip, in Armenian and English, at phone size.
for(const locale of ['hy','en']) test(`Flow screens, ${locale}`,async({page})=>{
  test.skip(!shots,'Only when screenshots are asked for');
  const start=async(query:string)=>{
    await page.goto(fixture.url+`/patient/chat?v3&empty&locale=${locale}&${query}`);
    await page.locator('textarea').fill('166/98');
    await page.locator('.cv2-composer button[type=submit]').click();
    await expect(page.locator('[data-zoe-card="bp"]')).toBeVisible();
  };
  const save=async(a:string,b:string)=>{
    await page.locator('[name=systolic]').fill(a);
    await page.locator('[name=diastolic]').fill(b);
    await page.locator('.cv2-reading-save').click();
  };
  await start('flow=high');
  await save('166','98');
  await expect(page.locator('[data-zoe-card="red_flags"]')).toBeVisible();
  await shot(page,`${locale}-1-red-flag-card-and-strip`);
  await answerNo(page,5);
  await expect(page.locator('[data-zoe-card="repeat"]')).toBeVisible();
  await shot(page,`${locale}-2-repeat-card`);
  await page.locator('[data-skip-wait]').click();
  await expect(page.locator('.cv2-reading-save')).toBeVisible();
  await shot(page,`${locale}-3-repeat-form`);
  await save('164','96');
  await expect(page.locator('[data-zoe-chip]')).toBeVisible();
  await shot(page,`${locale}-4-yellow-reply-chip`);
  await start('flow=orange');
  await save('185','100');
  await expect(page.locator('[data-zoe-chip]')).toBeVisible();
  await shot(page,`${locale}-5-orange-reply`);
  await start('flow=high');
  await save('183','112');
  await page.locator('[data-flag-answer="yes"]').click();
  await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  await page.waitForTimeout(200);
  await shot(page,`${locale}-6-yes-103`);
  await start('flow=no-team');
  await save('166','98');
  await page.waitForTimeout(200);
  await shot(page,`${locale}-7-no-care-team`);
});

// V3 onboarding blocks: consent, profile, medicines. Off by default; ?onboarding stands for the page's V3 prop.
const state = () => JSON.parse(fixture.respond(fixture.url+'/fixture/onboarding-state').body);
const shots2 = process.env.NOREON_SHOTS;
const shot2 = async (page: import('@playwright/test').Page, name: string) => { if(shots2) await page.screenshot({path:`${shots2}/${name}.png`}); };
const LOCALES = [['en',/Save this/,'Save my list','Text, 7:00 to 22:00'],['hy',/Պահել/,'Պահել իմ ցանկը','Գրավոր, 7:00-ից 22:00']] as const;
const profileCard = (page: import('@playwright/test').Page) => page.locator('[data-zoe-card="profile"]');
const medicinesCard = (page: import('@playwright/test').Page) => page.locator('[data-zoe-card="medicines"]');

test('V3 off: no offer, no consent details, no medicines in the menu, no new card kind',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&consent');
  await expect(page.locator('[data-zoe-chat-consent]')).toBeVisible();
  await expect(page.locator('[data-zoe-consent-more]')).toHaveCount(0);
  await page.getByRole('button',{name:'Agree and turn on'}).click();
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(page.locator('[data-menu-medicines]')).toHaveCount(0);
  await expect(profileCard(page)).toHaveCount(0);
  expect(state().opens).toEqual([]);expect(state().consents).toEqual([{}]);
});

for(const [locale,saveProfile,saveList,said] of LOCALES){
  test(`${locale}: consent shows what we collect, sends the shown text's locale, and only then offers the profile once`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&v3&onboarding&consent&locale=${locale}`);
    await expect(page.locator('[data-zoe-consent-more]')).toBeVisible();
    await expect(profileCard(page)).toHaveCount(0);
    await page.locator('[data-zoe-consent-more] summary').click();
    await shot2(page,`consent-${locale}`);
    expect(state().opens).toEqual([]);
    await page.locator('[data-zoe-chat-consent] button').first().click();
    await expect(profileCard(page)).toBeVisible();
    expect(state().consents).toEqual([{locale,directAnswers:false}]);
    expect(state().opens).toHaveLength(1);
  });

  test(`${locale}: profile card answers as the member's own message and the form leaves; the next step opens medicines`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&v3&onboarding&locale=${locale}`);
    await expect(profileCard(page)).toBeVisible();
    const save=profileCard(page).getByRole('button',{name:saveProfile});
    await expect(save).toBeDisabled();
    await shot2(page,`profile-${locale}`);
    await profileCard(page).locator('.cv2-seg button').first().click();
    await profileCard(page).locator('details summary').click();
    await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await shot2(page,`profile-caregiver-${locale}`);
    await save.click();
    await expect(page.locator('[data-turn-action]')).toContainText(said);
    await expect(profileCard(page)).toHaveCount(0);
    await shot2(page,`profile-answered-${locale}`);
    expect(state().profileSaves[0]).toMatchObject({channel:'text',wake:'07:00',sleep:'22:00',caregiver:null});
    await page.locator('[data-turn-reply] .cv2-link').click();
    await expect(medicinesCard(page).locator('[data-medicine]')).toHaveCount(2);
    await expect(medicinesCard(page).locator('[data-not-provided]')).toHaveCount(2);
    await shot2(page,`medicines-${locale}`);
    const course=medicinesCard(page).locator('[data-medicine="Amoxicillin"]');
    await course.locator('.cv2-seg button').nth(1).click();
    await course.locator('.cv2-seg').nth(1).locator('button').nth(1).click();
    await course.locator('[data-stop-confirm] button').click();
    await medicinesCard(page).locator('[data-medicine="Atorvastatin"] .cv2-seg button').first().click();
    await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await shot2(page,`medicines-chosen-${locale}`);
    await medicinesCard(page).getByRole('button',{name:saveList}).click();
    await expect(medicinesCard(page)).toHaveCount(0);
    await expect(page.locator('[data-turn-action]').last()).toContainText('Amoxicillin');
    await expect.poll(()=>bottom(page)).toBeLessThan(2);
    await shot2(page,`medicines-answered-${locale}`);
    expect(state().reviews[0].changes).toEqual(expect.arrayContaining([
      {id:'00000000-0000-4000-8000-00000000a002',status:'course_stopped',stopReason:'values_normal',stopConfirmed:true},
      {id:'00000000-0000-4000-8000-00000000a001',status:'continuous',stopReason:null,stopConfirmed:false}]));
  });
}

test('profile: no offer without consent, none after Not now, and none when already answered',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&consent');
  await page.getByRole('button',{name:'Not now'}).click();
  await page.waitForTimeout(200);
  await expect(profileCard(page)).toHaveCount(0);
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer');
  await page.waitForTimeout(200);
  await expect(profileCard(page)).toHaveCount(0);
  expect(state().opens).toEqual([]);
});

test('profile: error keeps the answers and a retry repeats the same operation; a lost reply recovers from the card',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&fail-profile');
  await profileCard(page).getByRole('button',{name:'Voice'}).click();
  await profileCard(page).getByRole('button',{name:'Save this'}).click();
  await expect(profileCard(page).getByRole('alert')).toHaveText('We could not save this. Try again.');
  await expect(profileCard(page).getByRole('button',{name:'Voice'})).toHaveAttribute('aria-pressed','true');
  await profileCard(page).getByRole('button',{name:'Save this'}).click();
  await expect(page.locator('[data-turn-action]')).toContainText('Voice, 7:00 to 22:00');
  const [first,second]=state().profileSaves;expect(second.opId).toBe(first.opId);
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&lose-profile');
  await profileCard(page).getByRole('button',{name:'Text'}).click();
  await profileCard(page).getByRole('button',{name:'Save this'}).click();
  await expect(page.locator('[data-turn-action]')).toContainText('Text, 7:00 to 22:00');
  await expect(profileCard(page)).toHaveCount(0);
});

test('profile: a half-filled contact stays on the card; a whole one says so without its details',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding');
  await profileCard(page).getByRole('button',{name:'Text'}).click();
  await profileCard(page).locator('details summary').click();
  await profileCard(page).getByLabel('Name').fill('Aram');
  await profileCard(page).getByRole('button',{name:'Save this'}).click();
  await expect(profileCard(page).getByRole('alert')).toContainText('Enter a name and a phone number');
  expect(state().profileSaves).toEqual([]);
  await profileCard(page).getByLabel('Phone').fill('+374 91 000000');
  await profileCard(page).getByRole('button',{name:'Save this'}).click();
  await expect(page.locator('[data-turn-action]')).toContainText('contact added');
  await expect(page.locator('.cv2-thread')).not.toContainText('Aram');
  const card=state().cards.cards.find((c:{kind:string})=>c.kind==='profile');
  expect(JSON.stringify(card)).not.toContain('Aram');
});

test('medicines: opens from the menu, adds a row, states error, loading failure and full list',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&review-status=limit');
  await page.getByRole('button',{name:'Open menu'}).click();
  await expect(page.getByRole('dialog').getByRole('link',{name:'My overview',exact:true})).toBeVisible();
  await page.locator('[data-menu-medicines]').click();
  const save=medicinesCard(page).getByRole('button',{name:'Save my list'});
  await expect(save).toBeDisabled();
  await medicinesCard(page).getByRole('button',{name:'Add a medicine'}).click();
  await save.click();
  await expect(medicinesCard(page).getByRole('alert')).toHaveText('Enter the medicine name.');
  await medicinesCard(page).getByLabel('Name, as on the box').fill('Aspirin');
  await save.click();
  await expect(medicinesCard(page).getByRole('alert')).toContainText('Your list is full');
  await save.click();
  await expect(page.locator('[data-turn-action]')).toContainText('Aspirin: Added');
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&medicines-read=unavailable');
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.locator('[data-menu-medicines]').click();
  await expect(medicinesCard(page).getByRole('alert')).toHaveText('Your medicines could not be loaded.');
});

test('medicines: a course asks first, says reminders stop, and can be undone on the same row',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer');
  const open=async()=>{await page.getByRole('button',{name:'Open menu'}).click();await page.locator('[data-menu-medicines]').click();};
  await open();
  const course=medicinesCard(page).locator('[data-medicine="Amoxicillin"]');
  await course.getByRole('button',{name:'Was a course'}).click();
  await expect(course.locator('[data-stop-confirm]')).toContainText('Reminders stop for this medicine.');
  await medicinesCard(page).getByRole('button',{name:'Save my list'}).click();
  await expect(medicinesCard(page).getByRole('alert')).toHaveText('Confirm that reminders should stop.');
  expect(state().reviews).toEqual([]);
  await shot(page,'medicines-confirm-en');
  await course.getByRole('button',{name:'Yes, stop reminders'}).click();
  await medicinesCard(page).getByRole('button',{name:'Save my list'}).click();
  await expect(page.locator('[data-zoe-reminders-stopped]')).toContainText('Reminders for these have stopped');
  await open();
  const stopped=medicinesCard(page).locator('[data-medicine-stopped="Amoxicillin"]');
  await shot(page,'medicines-restore-en');
  await stopped.getByRole('button',{name:'Turn reminders back on'}).click();
  await expect(page.locator('[data-turn-action]').last()).toContainText('Amoxicillin: reminders back on');
  expect(state().ownMedicines.filter((m:{name:string})=>m.name==='Amoxicillin')).toHaveLength(1);
  expect(state().stoppedMedicines).toEqual([]);
});

test('medicines: a lost answer holds the form so only the same list goes again; a refused list can be changed',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&review-status=failed');
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.locator('[data-menu-medicines]').click();
  const row=medicinesCard(page).locator('[data-medicine="Atorvastatin"]');
  await row.getByRole('button',{name:'Ongoing'}).click();
  await medicinesCard(page).getByRole('button',{name:'Save my list'}).click();
  await expect(medicinesCard(page).getByRole('alert')).toBeVisible();
  await expect(row.getByRole('button',{name:'As needed'})).toBeDisabled();
  await medicinesCard(page).getByRole('button',{name:'Save my list'}).click();
  await expect(page.locator('[data-turn-action]')).toContainText('Atorvastatin: Ongoing');
  const [first,second]=state().reviews;expect(second).toEqual(first);
});

test('anamnesis: the progress bar is there with V3 and not without it',async({page})=>{
  seedAssessment({...calmPrefix});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis');
  await expect(activeQuestion(page)).toBeVisible();
  await expect(page.locator('.cv2-progress')).toHaveCount(0);
  seedAssessment({...calmPrefix});
  await page.goto(fixture.url+'/patient/chat?empty&anamnesis&v3&onboarding&no-offer');
  await expect(page.locator('.cv2-progress')).toBeVisible();
  await page.locator('.cv2-thread').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await shot2(page,'anamnesis-progress-en');
});

const overview = (query='') => fixture.url+`/patient/chat/overview?v3${query}`;
const section = (page:import('@playwright/test').Page,id:string) => page.locator(`[data-overview-section="${id}"]`);

test('overview with the switch off is a 404 and the chat menu has no link to it',async({page})=>{
  const response=await page.goto(fixture.url+'/patient/chat/overview');
  expect(response?.status()).toBe(404);
  await page.goto(fixture.url+'/patient/chat?empty');
  await page.locator('.cv2-avatar').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(0);
});

test('overview opens from the chat menu and back returns to the thread',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3');
  await page.locator('.cv2-avatar').click();
  const link=page.getByRole('link',{name:'My overview',exact:true});
  await expect(link).toHaveAttribute('href','/patient/chat/overview');
  await link.evaluate(el=>el.setAttribute('href','/patient/chat/overview?v3'));
  await link.click();
  await expect(page.locator('[data-chat-overview]')).toBeVisible();
  await page.getByRole('link',{name:'Chat',exact:true}).click();
  await expect(page.locator('.cv2-thread')).toBeVisible();
  await expect(page).toHaveURL(/\/patient\/chat$/);
});

test('overview safety: LDL values stay hidden before approval and while a result waits for the doctor',async({page})=>{
  for(const query of ['&state=waiting','&with-doctor']){
    await page.goto(overview(query));
    await expect(section(page,'ldl')).toContainText('Your doctor will review your results');
    await expect(section(page,'ldl').locator('[data-ldl-values]')).toHaveCount(0);
    await expect(section(page,'ldl')).not.toContainText('1.9');
    await expect(section(page,'ldl')).not.toContainText('4.2');
  }
  await page.goto(overview('&state=waiting'));
  await expect(page.getByText("Waiting for your doctor's approval",{exact:true})).toBeVisible();
  await expect(section(page,'upcoming')).not.toContainText('LDL re-check');
});

test('overview after approval shows counted LDL only, with baseline, reduction and goal',async({page})=>{
  await page.goto(overview());
  await expect(page.getByText('Plan approved',{exact:true})).toBeVisible();
  const ldl=section(page,'ldl');
  await expect(ldl.locator('[data-ldl-values]')).toContainText('4.2 mmol/L');
  await expect(ldl.locator('[data-ldl-values]')).toContainText('1.9 mmol/L');
  await expect(ldl.locator('[data-ldl-values]')).toContainText('55%');
  await expect(ldl.locator('[data-ldl-values]')).toContainText('below 1.4 mmol/L');
  await expect(ldl).not.toContainText('1.1');
  await expect(ldl).not.toContainText('Your doctor will review');
});

test('overview shows the reading, zone, source, average, week and the chart with a text summary',async({page})=>{
  await page.goto(overview());
  const bp=section(page,'bp');
  await expect(bp.locator('[data-zone]')).toBeVisible();
  await expect(bp).toContainText('Entered by you');
  await expect(bp).toContainText('Day 5 of 7');
  await expect(bp.locator('.recharts-line')).toHaveCount(4);
  await expect(bp.locator('[data-chart-summary]')).toContainText('Last 7 days. Morning: 6 readings');
  await bp.getByRole('button',{name:'14 days',exact:true}).click();
  await expect(bp.locator('[data-chart-summary]')).toContainText('Last 14 days. Morning: 10 readings');
  await expect(section(page,'journey').locator('[aria-current=step]')).toHaveAttribute('data-step','monitoring');
  await expect(section(page,'today').getByRole('button')).toHaveCount(0);
  await expect(page.locator('input, textarea, form')).toHaveCount(0);
});

test('overview a high recent reading has its zone but no 103 button: numbers alone never mean 103',async({page})=>{
  await page.goto(overview('&high'));
  const bp=section(page,'bp');
  await expect(bp).toContainText('190/125');
  await expect(bp.locator('[data-zone=orange]')).toContainText('Orange zone');
  await expect(bp.getByRole('button',{name:'Call 103',exact:true})).toHaveCount(0);
});

test('overview zone chip shows for a reading from the last 24 hours and not for an older one',async({page})=>{
  await page.goto(overview('&age=23'));
  await expect(section(page,'bp').locator('[data-zone]')).toHaveCount(1);
  await page.goto(overview('&age=25'));
  const bp=section(page,'bp');
  await expect(bp.locator('.cv2-ov-value')).toBeVisible();
  await expect(bp).toContainText('Entered by you');
  await expect(bp.locator('[data-zone]')).toHaveCount(0);
  await expect(bp.getByRole('button',{name:'Call 103',exact:true})).toHaveCount(0);
});

test('overview a failed care read makes no claim about the plan or the journey',async({page})=>{
  await page.goto(overview('&state=care-failed'));
  await expect(page.locator('[data-plan=unknown]')).toHaveText('Not available right now');
  await expect(page.getByText("Waiting for your doctor's approval",{exact:true})).toHaveCount(0);
  await expect(page.getByText('Plan approved',{exact:true})).toHaveCount(0);
  const journey=section(page,'journey');
  await expect(journey.locator('[aria-current=step]')).toHaveCount(0);
  await expect(journey.locator('[data-step=plan]')).toHaveAttribute('data-state','unavailable');
  await expect(journey.locator('[data-step=monitoring]')).toHaveAttribute('data-state','unavailable');
  await expect(journey.locator('[data-step=consult]')).toHaveAttribute('data-state','done');
  await expect(section(page,'ldl')).toContainText('Your doctor will review your results');
  await expect(section(page,'ldl').locator('[data-ldl-values]')).toHaveCount(0);
});

test('overview unknown says not provided yet with an add action into the chat; staging names stay out',async({page})=>{
  await page.goto(overview('&state=empty'));
  await expect(page.locator('[data-chat-overview]')).not.toContainText('STAGING');
  for(const id of ['bp','today','upcoming','documents']){
    await expect(section(page,id)).toContainText('Not provided yet');
    await expect(section(page,id).getByRole('link',{name:/^Add in chat/})).toHaveAttribute('href','/patient/chat');
  }
  await expect(section(page,'ldl')).toContainText('Your doctor will review your results');
  await expect(page.locator('[data-plan=waiting]')).toHaveText("Waiting for your doctor's approval");
  await expect(section(page,'journey').locator('[aria-current=step]')).toHaveAttribute('data-step','consent');
  await expect(section(page,'questions')).toContainText('You have no saved questions yet.');
});

test('overview quick actions: unwired ones are hidden and 103 calls',async({page})=>{
  await page.goto(overview());
  const quick=section(page,'quick');
  await expect(quick.getByRole('link')).toHaveCount(0);
  await expect(quick.getByRole('button',{name:'Call 103',exact:true})).toBeVisible();
  await expect(quick).not.toContainText('Enter BP');
});

for(const [query,label] of [['&locale=hy&long','long Armenian'],['&locale=hy','Armenian'],['&locale=en','English'],['&state=empty&locale=hy','empty Armenian']]){
  test(`overview at 375px has no overflow and 44px targets: ${label}`,async({page})=>{
    await page.setViewportSize({width:375,height:720});
    await page.goto(overview(query));
    await expect(page.locator('[data-chat-overview]')).toBeVisible();
    const layout=await page.evaluate(()=>{
      const box=document.querySelector('.cv2-ov-scroll')!;
      const wide=[...document.querySelectorAll('[data-chat-overview] *')].filter(el=>!el.closest('svg')&&el.getBoundingClientRect().right>innerWidth+0.5).map(el=>el.className);
      const small=[...document.querySelectorAll('[data-chat-overview] a, [data-chat-overview] button')].filter(el=>el.getBoundingClientRect().height<44).map(el=>el.textContent);
      return {page:document.documentElement.scrollWidth,inner:box.scrollWidth-box.clientWidth,wide,small};
    });
    expect(layout.page).toBeLessThanOrEqual(375);
    expect(layout.inner).toBeLessThanOrEqual(0);
    expect(layout.wide).toEqual([]);
    expect(layout.small).toEqual([]);
  });
}

// PR 7: synthetic IO, production composer and upload component.
test('V3 labs: camera and PDF keep the existing upload limit and saved-not-read wording', async ({page}) => {
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer');
  await expect(page.locator('[data-zoe-camera]')).toBeVisible();
  await expect(page.locator('[data-zoe-camera-input]')).toHaveAttribute('capture','environment');
  await expect(page.locator('[data-zoe-attach-input]')).toHaveAttribute('accept',/application\/pdf/);
  await page.locator('[data-zoe-attach-input]').setInputFiles({name:'lipids.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
  await expect(page.locator('[data-zoe-attach-status]')).toContainText('Your file is saved. It has not been read yet.');
});

for(const locale of ['hy','en','ru'] as const){
  test(`V3 labs: ${locale} document date confirmation moves to the end and shows date-only freshness`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&v3&onboarding&no-offer&locale=${locale}`);
    await page.locator('[data-zoe-attach-input]').setInputFiles({name:'lipids.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
    const tile=page.locator('[data-zoe-card="document"]');
    await expect(tile.locator('[data-document-tile]')).toBeVisible();
    await expect(page.locator('[data-lab-fresh]')).toHaveCount(0);
    await tile.locator('select').first().selectOption('lab');
    await tile.locator('input[type=date]').fill('2026-10-12');
    await tile.locator('select').last().selectOption('no');
    await tile.locator('.cv2-reading-save').click();
    await expect(tile).toHaveCount(0);
    await expect(page.locator('[data-lab-fresh]')).toBeVisible();
    await expect(page.locator('[data-turn-action]').last()).toBeVisible();
    await expect.poll(()=>bottom(page)).toBeLessThan(2);
    await page.evaluate(()=>{const url=new URL(location.href);url.searchParams.set('keep','');history.replaceState(null,'',url);});
    await page.reload();
    await expect(page.locator('[data-lab-fresh]')).toBeVisible();
    await expect(page.locator('[data-zoe-card="document"]')).toHaveCount(0);
  });
  test(`V3 labs: ${locale} acute gate sends a fixed member message; follow-up uses existing 103`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&v3&onboarding&no-offer&locale=${locale}`);
    await page.locator('.cv2-avatar').click();await page.locator('[data-menu-consult]').click();
    const gate=page.locator('[data-zoe-card="symptom_gate"]');
    await gate.locator('.cv2-link').click();await expect(gate).toHaveCount(0);
    const followup={hy:'Հիմա կրծքավանդակի ուժեղ ցավ ունեմ',en:'I have severe chest pain right now',ru:'У меня сейчас болит грудь'}[locale];
    await page.locator('.cv2-composer textarea').fill(followup);await page.locator('.cv2-composer button[type=submit]').click();
    await expect(page.locator('[data-zoe-emergency-card]')).toBeVisible();
  });
  test(`V3 labs: ${locale} fasting failure goes to admin and questions use the doctor's conversation`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?empty&v3&onboarding&no-offer&locale=${locale}`);
    fixture.respond(fixture.url+'/fixture/arrive-lab','POST',JSON.stringify({kind:'prep'}));
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const prep=page.locator('[data-zoe-card="prep"]');await expect(prep).toBeVisible();
    for(const checkbox of await prep.getByRole('checkbox').all())await checkbox.check();
    await prep.locator('.cv2-reading-save').click();await expect(prep).toHaveCount(0);
    fixture.respond(fixture.url+'/fixture/arrive-lab','POST',JSON.stringify({kind:'fasting'}));
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    const fasting=page.locator('[data-zoe-card="fasting"]');await expect(fasting).toBeVisible();
    await fasting.locator('.cv2-link').click();await expect(fasting).toHaveCount(0);
    await expect(page.locator('[data-fasting-warning]')).toBeVisible();
    await page.locator('.cv2-avatar').click();await page.locator('[data-menu-questions]').click();
    const questions=page.locator('[data-zoe-card="consult_questions"]');
    await expect(questions.locator('textarea')).toHaveCount(3);
    await expect(questions.locator('.cv2-reading-save')).toBeDisabled();
    await questions.locator('textarea').first().fill('Can we discuss my concern?');
    await questions.locator('.cv2-reading-save').click();await expect(questions).toHaveCount(0);
    await expect(page.getByText(/Can we discuss my concern/)).toBeVisible();
  });
}

test('V3 labs: duplicate upload recovers a lost document-card opening; off hides all lab menu items',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer&fail-open');
  // Opening the profile would consume fail-open; onboarding without a due profile keeps this focused on the upload.
  const upload={name:'lipids.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')};
  await page.locator('[data-zoe-attach-input]').setInputFiles(upload);
  await page.locator('[data-zoe-attach-input]').setInputFiles(upload);
  await expect(page.locator('[data-zoe-card="document"]')).toBeVisible();
  await page.goto(fixture.url+'/patient/chat?empty');
  await expect(page.locator('[data-zoe-attach]')).toHaveCount(0);
  await page.locator('.cv2-avatar').click();await expect(page.locator('[data-menu-consult]')).toHaveCount(0);
});

for (const locale of ['en','hy','ru']) {
  test(`${locale}: V3 approved plan tabs, exact medicine and teach-back dialog`,async({page})=>{
    await page.goto(fixture.url+`/patient/chat?v3&onboarding&no-offer&plan&locale=${locale}`);
    const card=page.locator('[data-zoe-card="plan"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole('tab')).toHaveCount(4);
    await expect(card).toContainText('Rosuvastatin');
    await expect(card).toContainText('20 mg');
    await expect(card).toContainText('20:00');
    await expect(card).toContainText('Dr. Mariam');
    await card.getByRole('tab').nth(1).click();
    await expect(card.getByRole('meter')).toHaveCount(1);
    await expect(card).toContainText('1.8');
    await card.getByRole('tab').nth(2).click();
    await expect(card).toContainText('Walk as agreed.');
    await card.getByRole('tab').nth(3).click();
    await expect(card).toContainText('Lipid profile');
    await card.locator('[data-confirm-plan]').click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-zoe-plan-confirmed]')).toBeVisible();
    const before=JSON.parse(fixture.respond(fixture.url+'/fixture/plan-state').body);
    expect(before.planConfirmations).toHaveLength(1);
    expect(before.cards.cards[0].snapshot.plan.medicines[0]).toEqual({name:'Rosuvastatin',dose:'20 mg',times:['20:00']});
    // The fixture resets the thread on a plain load; keep it so the reload shows what the server stored.
    await page.evaluate(()=>{const u=new URL(location.href);u.searchParams.set('keep','');history.replaceState(null,'',u);});
    await page.reload();
    await expect(page.locator('[data-zoe-plan-confirmed]')).toBeVisible();
    await expect(page.locator('[data-zoe-card="plan"]')).toHaveCount(0);
    expect(JSON.parse(fixture.respond(fixture.url+'/fixture/plan-state').body).planConfirmations).toHaveLength(1);
  });
}

test('V3 plan: a lost receipt recovers from polling, an error retries, switch off draws nothing',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&plan&lose-plan');
  await page.locator('[data-confirm-plan]').click();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-zoe-plan-confirmed]')).toBeVisible();
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/plan-state').body).planConfirmations).toHaveLength(1);
  await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&plan&fail-plan');
  await page.locator('[data-confirm-plan]').click();
  await expect(page.locator('[data-zoe-card="plan"] [role="alert"]')).toBeVisible();
  await page.locator('[data-confirm-plan]').click();
  await expect(page.locator('[data-zoe-plan-confirmed]')).toBeVisible();
  await page.goto(fixture.url+'/patient/chat?plan');
  await expect(page.locator('[data-zoe-card="plan"]')).toHaveCount(0);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/plan-state').body).planConfirmations).toHaveLength(0);
});

test('V3 plan: a replacement asks for confirmation again on desktop',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&plan');
  await page.locator('[data-confirm-plan]').click();
  await expect(page.locator('[data-zoe-plan-confirmed]')).toBeVisible();
  fixture.respond(fixture.url+'/fixture/replace-plan','POST');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  // With a short thread the new card is already in view and no pill is drawn.
  const pill=page.getByRole('button',{name:'New message',exact:true});
  if(await pill.count())await pill.click();
  await expect(page.locator('[data-confirm-plan]')).toBeVisible();
  await page.locator('[data-confirm-plan]').click();
  await expect(page.locator('[data-zoe-plan-confirmed]')).toHaveCount(2);
  expect(JSON.parse(fixture.respond(fixture.url+'/fixture/plan-state').body).planConfirmations).toHaveLength(2);
});

test('V3 plan: the menu opens the published card through the real hook',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer');
  await page.locator('.cv2-avatar').click();
  await page.locator('[data-menu-plan]').click();
  await expect(page.locator('[data-zoe-card="plan"]')).toBeVisible();
  await expect(page.locator('[data-confirm-plan]')).toBeEnabled();
  const state=JSON.parse(fixture.respond(fixture.url+'/fixture/onboarding-state').body);
  expect(state.opens.at(-1).kind).toBe('plan');
});

test('the menu has a way back to the previous chat page only under V3',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?empty&v3&onboarding&no-offer');
  await page.locator('.cv2-avatar').click();
  await expect(page.locator('[data-menu-previous]')).toHaveAttribute('href','/patient/zoe?view=classic');
  await page.goto(fixture.url+'/patient/chat?empty');
  await page.locator('.cv2-avatar').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('[data-menu-previous]')).toHaveCount(0);
});

test('V3: a menu item whose card already sits higher up in the thread brings it into view',async({page})=>{
  await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer');
  await page.locator('.cv2-avatar').click();
  await page.locator('[data-menu-plan]').click();
  const plan=page.locator('[data-zoe-card="plan"]');
  await expect(plan).toBeVisible();
  for(let i=0;i<12;i++){await page.locator('.cv2-composer textarea').fill('another message '+i);await page.locator('.cv2-composer button[type=submit]').click();}
  await expect(plan).not.toBeInViewport();
  await page.locator('.cv2-avatar').click();
  await page.locator('[data-menu-plan]').click();
  await expect(plan).toBeInViewport();
});

// Visit requests use the real form and dialog ordering with synthetic app IO.
const visitState=()=>JSON.parse(fixture.respond(fixture.url+'/fixture/visit-state').body);
const openVisit=async(page:import('@playwright/test').Page)=>{
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-menu-visit]').click();
};
for(const reason of ['configuration-unavailable','source-unavailable'])test(`V3 ${reason} offers visit preferences and survives a lost reply`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?v3&onboarding&no-offer&visit-request&visit-reason=${reason}&lose-visit&empty`);
 await openVisit(page);
 const form=page.locator('[data-visit-request]');
 await expect(form).toBeVisible();
 await expect(page.getByText('Booking is being prepared. Check again later.')).toHaveCount(0);
 const day=await form.getByLabel('Preferred day').locator('option').nth(1).getAttribute('value');
 await form.getByLabel('Preferred day').selectOption(day!);
 await form.getByLabel('Time of day').selectOption('afternoon');
 await form.getByLabel('Note (optional, up to 200 characters)').fill('Please call first.');
 await form.getByRole('button',{name:'Send my request',exact:true}).click();
 await expect(page.locator('[data-turn-reply]')).toContainText('Request sent. The care team will confirm your time here.');
 await expect(form).toHaveCount(0);
 await expect(page.locator('.cv2-me').filter({hasText:'Visit request:'})).toHaveCount(1);
 expect(visitState().visitRequests).toHaveLength(1);expect(visitState().visitTasks).toHaveLength(1);
 expect(visitState().visitRequests[0]).toMatchObject({day,window:'afternoon',note:'Please call first.'});
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&keep&empty');
 await expect(page.locator('[data-visit-request]')).toHaveCount(0);
 await expect(page.locator('[data-turn-reply]')).toContainText('Request sent. The care team will confirm your time here.');
 await expect(page.locator('.cv2-me').filter({hasText:'Visit request:'})).toHaveCount(1);
 expect(visitState().visitRequests).toHaveLength(1);
});
for(const step of ['task','message'])test(`V3 visit request resumes after ${step} failure and reload`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?v3&onboarding&no-offer&visit-request&fail-visit=${step}&empty`);
 await openVisit(page);
 const form=page.locator('[data-visit-request]');
 const day=await form.getByLabel('Preferred day').locator('option').nth(1).getAttribute('value');
 await form.getByLabel('Preferred day').selectOption(day!);
 await form.getByRole('button',{name:'Send my request',exact:true}).click();
 await expect(form.getByRole('alert')).toBeVisible();
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&keep&empty');
 await expect(form.getByLabel('Preferred day')).toHaveValue(day!);
 await expect(form.getByLabel('Preferred day')).toBeDisabled();
 await form.getByRole('button',{name:'Try sending my request again'}).click();
 await expect(form).toHaveCount(0);
 await expect(page.locator('[data-turn-reply]')).toContainText('Request sent. The care team will confirm your time here.');
 expect(visitState().visitTasks).toHaveLength(1);expect(visitState().visitRequests).toHaveLength(1);
});
for(const width of [320,1280])test(`visit preferences respect hours, note bounds and 48px targets at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:740});
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&visit-request&sunday-hours&empty');
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 const items=page.locator('.cv2-menu > button:not(.cv2-close)');
 const boxes=await items.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,width:r.width,height:r.height,top:r.top};}));
 expect(boxes.every(b=>b.height>=48)).toBe(true);
 expect(new Set(boxes.map(b=>b.left)).size).toBe(1);
 for(let i=1;i<boxes.length;i++)expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i-1].top+boxes[i-1].height);
 await page.locator('[data-menu-visit]').click();
 const form=page.locator('[data-visit-request]');
 await expect(form.getByLabel('Preferred day')).toBeVisible();
 await expect(form.getByLabel('Preferred day').locator('option').nth(1)).toBeAttached();
 const days=await form.getByLabel('Preferred day').locator('option').evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value).filter(Boolean));
 expect(days).toHaveLength(2);
 expect(days.every(d=>new Date(`${d}T12:00:00Z`).getUTCDay()===0)).toBe(true);
 const controls=await form.locator('select,input,button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
 expect(controls.every(h=>h>=48)).toBe(true);
 await form.getByLabel('Preferred day').selectOption(days[0]);
 const note=form.getByLabel('Note (optional, up to 200 characters)');
 await expect(note).toHaveAttribute('maxlength','200');
 await note.fill('<script>text</script>');
 await form.getByRole('button',{name:'Send my request',exact:true}).click();
 await expect(form.getByRole('alert')).toContainText('plain text');
 expect(visitState().visitTasks).toHaveLength(0);
});
for(const reason of ['clinical-hold','profile-mismatch','urgent'])test(`V3 ${reason} keeps its own guidance`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?v3&onboarding&no-offer&visit-request&visit-reason=${reason}&empty`);
 await openVisit(page);
 await expect(page.locator('[data-zoe-card="visit"]')).toBeVisible();
 await expect(page.locator('[data-visit-request]')).toHaveCount(0);
 if(reason==='urgent')await expect(page.locator('[data-zoe-card="visit"] a[href="tel:103"]')).toBeVisible();
});
test('unreadable visit hours offer a retry, and V3 off offers no request form',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&visit-request&hours-failed&empty');
 await openVisit(page);
 await expect(page.getByRole('button',{name:'Load visit days again'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send my request',exact:true})).toHaveCount(0);
 await page.goto(fixture.url+'/patient/chat?visit-request&empty');
 await expect(page.locator('[data-visit-request]')).toHaveCount(0);
});

test('an existing visit keeps its admin-change action and has no preference form',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&empty');
 await openVisit(page);
 const card=page.locator('[data-zoe-card="visit"]');
 await expect(card.getByRole('button',{name:'Ask admin to change',exact:true})).toBeVisible();
 await expect(page.locator('[data-visit-request]')).toHaveCount(0);
 await card.getByRole('button',{name:'Ask admin to change',exact:true}).click();
 await expect(page.locator('[data-turn-reply]')).toContainText('Your request is with the admin.');
});

for(const locale of ['hy','ru'] as const)test(`V3 visit request uses draft ${locale} wording`,async({page})=>{
 await page.goto(fixture.url+`/patient/chat?v3&onboarding&no-offer&visit-request&locale=${locale}&empty`);
 await page.locator('.cv2-avatar').click();await page.locator('[data-menu-visit]').click();
 const form=page.locator('[data-visit-request]');
 const dayField=form.getByLabel(VISIT_REQUEST.day[locale]);
 const day=await dayField.locator('option').nth(1).getAttribute('value');
 await dayField.selectOption(day!);
 await form.getByRole('button',{name:VISIT_REQUEST.send[locale],exact:true}).click();
 await expect(form).toHaveCount(0);
 await expect(page.locator('[data-turn-reply]')).toContainText(VISIT_REQUEST.sent[locale]);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('.cv2-me').filter({hasText:VISIT_REQUEST.message[locale]+':'})).toHaveCount(1);
});

test('a later urgent hold keeps its guidance while preserving an unfinished request',async({page})=>{
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&no-offer&visit-request&fail-visit=task&empty');
 await openVisit(page);
 const form=page.locator('[data-visit-request]');
 const day=await form.getByLabel('Preferred day').locator('option').nth(1).getAttribute('value');
 await form.getByLabel('Preferred day').selectOption(day!);
 await form.getByRole('button',{name:'Send my request',exact:true}).click();
 await expect(form.getByRole('alert')).toBeVisible();
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&keep&visit-reason=urgent&empty');
 await expect(form).toHaveCount(0);
 await expect(page.locator('[data-zoe-card="visit"] a[href="tel:103"]')).toBeVisible();
 expect(visitState().cards.cards.find((c:{kind:string})=>c.kind==='visit').claims.booking.payload.day).toBe(day);
 await page.goto(fixture.url+'/patient/chat?v3&onboarding&keep&visit-reason=configuration-unavailable&empty');
 await expect(form.getByLabel('Preferred day')).toHaveValue(day!);
 await form.getByRole('button',{name:'Try sending my request again'}).click();
 await expect(form).toHaveCount(0);
 expect(visitState().visitTasks).toHaveLength(1);expect(visitState().visitRequests).toHaveLength(1);
});
