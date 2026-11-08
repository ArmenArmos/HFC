import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const {MessagePreferences}=await import('@/components/messaging/message-settings');
const render=(props:Partial<Parameters<typeof MessagePreferences>[0]>)=>renderToStaticMarkup(createElement(MessagePreferences,{locale:'en',telegram:null,...props}));
for(const locale of ['en','hy'] as const)for(const telegram of [null,{state:'linked' as const,connected:true},{state:'not_linked' as const,connected:false},{state:'error' as const,connected:false}]){
 const html=render({locale,telegram});
 assert.ok(!/SMS|WhatsApp|type="radio"|<form/i.test(html),'Telegram-only: no SMS/WhatsApp choice is offered');
}
let html=render({telegram:{state:'linked',connected:true}});
assert.match(html,/Messages from your care team arrive in Telegram/);assert.match(html,/href="\/patient\/account\/telegram"[^>]*>.*Manage or turn off replies/);
html=render({telegram:{state:'not_linked',connected:false}});assert.match(html,/Telegram is not connected/);assert.match(html,/href="\/patient\/account\/telegram"[^>]*>.*Connect Telegram/);
html=render({telegram:{state:'not_linked',connected:true}});assert.match(html,/Replies in Telegram are off/);assert.match(html,/Turn on replies in Telegram/);
html=render({telegram:null});assert.match(html,/role="status"[^>]*>Telegram is unavailable right now\. You can message your care team in Noreon\./);assert.ok(!html.includes('/patient/account/telegram'),'No Telegram link while Telegram is off');

html=render({locale:'hy',telegram:{state:'linked',connected:true}});assert.match(html,/Telegram-ը միացված է/);
console.log('Message preferences are Telegram-only: linked, not linked, replies off, off, and error states render without SMS/WhatsApp choices.');
