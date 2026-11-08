import {runChatView} from './zoe-chat-test-view';
import * as memberDates from '@/lib/patient/date-format';
import * as suggestions from '@/lib/chat/suggestions';
import * as tasks from '@/lib/chat/tasks';
import {ChatSuggestions} from '@/components/conversation/chat-suggestions';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as contracts from "@/lib/zoe/app-chat-contracts";
import * as registry from "@/lib/zoe-chat-actions/registry";
import * as copy from "@/lib/zoe-chat-actions/copy";
import * as threadHelpers from "@/lib/zoe-chat-actions/thread";
import * as everydayContract from "@/lib/zoe-chat-actions/everyday-contract";
import { tx } from "@/lib/patient/copy";

// Run the real chat effects with supplied DOM geometry and IO. No network or mutations.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const events: string[] = [];
const listeners: Record<string, (...args: unknown[]) => void> = {};
const opened: unknown[] = [];
let cardReply: {status:string;card?:registry.ZoeCard} = {status:"failed"};
let pendingOpen: Promise<typeof cardReply> | null = null;
const log = { scrollHeight: 1200, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }), scrollTo: ({ top }: { top: number }) => events.push(top === 0 ? "greeting" : "newest") };
const heading = { tabIndex: 0, focus: () => events.push("heading-focus") };
const selected = { querySelector: () => heading, getBoundingClientRect: () => { events.push("card-start"); return { top: 40 }; } };
const empty: contracts.ZoeThread = { ok: true, version: 0, ack: null, zoeReplies: false, settledSeq: 0, messages: [], replies: [], answers: [] };
let nextThread = empty;
const exports: Record<string, unknown> = {};
const noop = () => null;
const chatContext = { exports, crypto, Date, setTimeout, clearTimeout, requestAnimationFrame: (f:()=>void) => {f();return 1;}, cancelAnimationFrame: noop,
  document: { visibilityState: "visible", querySelector: (query: string) => query === "[data-zoe-thread]" ? log : selected, addEventListener: noop, removeEventListener: noop },
  window: { setInterval: () => 1, clearInterval: noop, addEventListener: (name: string, handler: () => void) => { listeners[name] = handler; }, removeEventListener: noop },
  require(name: string):unknown {
 if(name==='@/lib/patient/date-format')return memberDates;
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "next/link") return { default: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) };
    if (name === "lucide-react") return new Proxy({}, { get: () => noop });
    if (name.endsWith("/zoe-quick-actions")) return { zoeChip: "chip", ZoeQuickActions: ({ children }: { children: React.ReactNode }) => React.createElement("nav", { "data-zoe-quick-actions": true }, children) };
    if (name.endsWith("/tab-draft")) return { readDraft: noop, keepDraft: noop };
    if (name.endsWith("/zoe-chat-actions/registry")) return registry;
    if (name.endsWith("/zoe-chat-actions/copy")) return copy;
    if (name.endsWith("/zoe-chat-actions/thread")) return threadHelpers;
    if(name==='@/lib/chat/suggestions')return suggestions;
    if(name==='@/lib/chat/tasks')return tasks;
    if(name==='@/components/conversation/chat-suggestions')return {ChatSuggestions};
    if (name.endsWith("/zoe-chat-actions/everyday-contract")) return everydayContract;
    if (name.endsWith("/zoe-chat-actions/everyday-actions")) return { openEverydayCard: async (input: unknown) => { opened.push(input); return pendingOpen ?? cardReply; } };
    if (name.endsWith("/zoe-chat-actions/actions")) return { openZoeCard: async (input: unknown) => { opened.push(input); return pendingOpen ?? cardReply; } };
    if (name.endsWith("/zoe-cards")) return {CARD_REPLY_LOST:"lost",ZoeCardView: (props:{card:registry.ZoeCard;collapsed:boolean}) => React.createElement("article",{"data-test-card":props.card.id,"data-collapsed":props.collapsed})};
    if (name.endsWith("/patient/copy")) return { tx };
    if (name.endsWith("/app-chat-contracts")) return { ...contracts, fetchZoeThread: async () => nextThread };
    if (name.endsWith("/zoe/chat-actions")) return { sendZoeChatMessage: async () => ({ status: "failed" }) };
    return new Proxy({}, { get: () => noop });
  },
};
runChatView("components/patient/zoe-chat.tsx",chatContext);
const Chat = exports.ZoeChat as React.ComponentType<Record<string, unknown>>;
let renderer: ReactTestRenderer;
await act(async () => {
  renderer = create(React.createElement(Chat, { locale: "en", initial: empty, upload: false, chatOnly: true }), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }) });
});
assert.equal(events.at(-1), "greeting", "An empty chat starts at the short welcome");
const emptyJson = JSON.stringify(renderer!.toJSON());
assert.match(emptyJson, /I’m Zoe, your AI assistant/);
assert.match(emptyJson, /AI assistant, not a doctor/);
assert.doesNotMatch(emptyJson, /data-zoe-quick-actions/);
await act(async () => renderer!.unmount());
// The legacy shell ignores additive journal entries, including its empty welcome/layout decision.
await act(async () => { renderer = create(React.createElement(Chat, {locale:"en", initial:{...empty,notices:[{id:"11111111-1111-4111-8111-111111111111",text:"Synthetic notice must stay out of the old view",at:"2026-11-01T10:00:00Z",closed:false}]},upload:false,chatOnly:true}),{createNodeMock:()=>({style:{},scrollHeight:60,scrollTop:0,getBoundingClientRect:()=>({top:0})})}); });
assert.doesNotMatch(JSON.stringify(renderer!.toJSON()),/Synthetic notice must stay out of the old view/);
assert.match(JSON.stringify(renderer!.toJSON()),/I’m Zoe, your AI assistant/);
await act(async () => renderer!.unmount());

for (const [locale, invitation, disclosure, placeholder] of [
  ["en", "I’m Zoe, your AI assistant.", "AI assistant, not a doctor", "Ask Zoe…"],
  ["hy", "Ես Zoe-ն եմ՝ ձեր ԱԲ օգնականը", "ԱԲ օգնական, ոչ բժիշկ", "Հարցրեք Zoe-ին…"],
  ["ru", "Я Zoe, ваш ИИ-помощник.", "ИИ-помощник, не врач", "Спросите Zoe…"],
]) {
  await act(async () => { renderer = create(React.createElement(Chat, {
    locale, initial: empty, upload: false, chatOnly: true,
    intro: React.createElement(React.Fragment), // A server notice slot is truthy even when it renders nothing.
  }), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}), focus() {} }) }); });
  const json = JSON.stringify(renderer!.toJSON());
  assert.ok(json.includes(invitation) && json.includes(disclosure));
  assert.equal(renderer!.root.findByType("textarea").props.placeholder, placeholder, "Short invitation leaves the disclosure on the empty line and bubbles");
  assert.doesNotMatch(json, /data-zoe-quick-actions/);
  await act(async () => listeners["noreon:member-message-open"]({ preventDefault() {} }));
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('data-zoe-doctor-mode'), "The menu retains writing directly to the doctor with cards off");
  await act(async () => listeners["noreon:member-new-question-open"]({ preventDefault() {} }));
  assert.ok(!JSON.stringify(renderer!.toJSON()).includes('data-zoe-doctor-mode'), "New question returns an empty chat to Zoe");
  let handled = false;
  await act(async () => listeners["noreon:member-side_effect-open"]({ preventDefault() { handled = true; } }));
  assert.ok(handled, `${locale}: cards-off side effect uses the composer`);
  assert.ok(JSON.stringify(renderer!.toJSON()).includes('data-zoe-doctor-mode'), "Side effects can be written to the doctor");
  await act(async () => renderer!.unmount());
}
// Regression: required notices remain the newest content after a long conversation.
for (const locale of ["en", "hy", "ru"] as const) {
  const history = { ...empty, replies: Array.from({ length: 60 }, (_, i) => ({
    id: `reply-${i}`, text: `Saved doctor reply ${i}`, doctorName: "Recorded doctor", at: "2026-10-31T12:00:00Z",
  })) };
  await act(async () => { renderer = create(React.createElement(Chat, {
    locale, initial: history, upload: false, chatOnly: true,
    intro: React.createElement("aside", { "data-active-notice": true }, "Required notice"),
  }), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }) }); });
  const json = JSON.stringify(renderer!.toJSON());
  assert.ok(json.indexOf("Required notice") > json.indexOf("Saved doctor reply 59"), `${locale}: notice follows all 60 replies`);
  assert.ok(json.indexOf("Required notice") < json.indexOf('"data-zoe-composer"'), `${locale}: notice precedes input`);
  assert.equal(events.at(-1), "newest", `${locale}: arrival targets notices at the newest position`);
  await act(async () => renderer!.unmount());
}

// The label belongs to every Zoe bubble, including acknowledgement and typing states.
for (const [locale, disclosure] of [["en", "AI assistant, not a doctor"], ["hy", "ԱԲ օգնական, ոչ բժիշկ"], ["ru", "ИИ-помощник, не врач"]] as const) {
  for (const kind of ["ack", "pending-zoe", "answer"] as const) {
    const initial = { ...empty, settledSeq: kind === "ack" ? 1 : 0,
      messages: [{ seq: 1, text: "Synthetic question", at: new Date().toISOString(), channel: "app", requestId: null }],
      answers: kind === "answer" ? [{ id: "zoe-answer", text: "Synthetic Zoe reply", at: new Date().toISOString() }] : [],
    };
    await act(async () => { renderer = create(React.createElement(Chat, { locale, initial, upload: false, chatOnly: true }), {
      createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }),
    }); });
    const bubble = renderer!.root.findByProps({ "data-zoe-bubble": kind });
    assert.ok(bubble.findAllByType("p").some(p => p.children.join("") === `Zoe · ${disclosure}`), `${locale}/${kind}: explicit AI disclosure`);
    await act(async () => renderer!.unmount());
  }
}

// Reopening a saved conversation starts at its newest reply and has no empty-state line.
await act(async () => { renderer = create(React.createElement(Chat, {
  locale: "en", initial: { ...empty, answers: [{ id: "saved", text: "Saved doctor reply", at: "2026-10-31T12:00:00Z" }] }, upload: false, chatOnly: true,
}), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }) }); });
assert.equal(events.at(-1), "newest");
assert.match(JSON.stringify(renderer!.toJSON()), /Saved doctor reply/);
assert.match(JSON.stringify(renderer!.toJSON()), /AI assistant, not a doctor/, "Existing Zoe answers retain the disclosure");
assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /I’m Zoe, your AI assistant/);
await act(async () => renderer!.unmount());
await act(async () => {
  renderer = create(React.createElement(Chat, {
    locale: "en", initial: empty, upload: false, chatOnly: true, cardKey: "care",
    selectedCard: React.createElement("section", { "data-member-chat-card": "care" }, "Long saved plan"),
  }), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }) });
});
assert.equal(events.at(-1), "card-start", "Opening a reader starts at its heading rather than the footer");
assert.ok(events.includes("heading-focus"));
let readerHandled=false;
events.length=0;
await act(async()=>listeners["noreon:member-reader-open"]({detail:{card:"care"},preventDefault(){readerHandled=true;}}));
assert.equal(readerHandled,true,"The same selected reader is handled locally");
assert.ok(events.includes("card-start"),"Reopening the same reader scrolls to its top");

const positions = () => {
  const json = JSON.stringify(renderer!.toJSON());
  return { card: json.indexOf('"data-chat-selected-card"'), pending: json.indexOf('"data-zoe-bubble":"pending"'), answer: json.indexOf("Newest received answer") };
};
await act(async () => renderer!.root.findByType("textarea").props.onChange({ target: { value: "When is my visit?" } }));
events.length = 0;
await act(async () => renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} }));
assert.equal(events.at(-1), "newest", "A newly sent message stays visible after opening a reader");
assert.ok(positions().pending > positions().card, "The pending bubble follows the selected reader");
nextThread = { ...empty, version: 1, answers: [{ id: "reply", text: "Newest received answer", at: "2026-10-31T12:00:00Z" }] };
events.length = 0;
await act(async () => { listeners.focus(); });
assert.equal(events.at(-1), "newest", "A received reply scrolls to the newest message");
assert.ok(positions().answer > positions().card);
await act(async () => renderer!.unmount());
await act(async () => {
  renderer = create(React.createElement(React.StrictMode, null, React.createElement(Chat, {
    locale: "en", initial: empty, upload: false, chatOnly: true, cardKey: "visit",
    cards: { enabled: true, cards: [], clearedSeq: null },
  })), { createNodeMock: () => ({ style: {}, scrollHeight: 60, scrollTop: 0, getBoundingClientRect: () => ({top:0}) }) });
});
assert.equal(opened.length, 1, "A visit entry opens one card even under Strict Mode");
assert.equal((opened[0] as { kind: string }).kind, "visit");
await act(async () => {
  listeners["noreon:member-visit-open"]({ preventDefault() {} });
  listeners["noreon:member-visit-open"]({ preventDefault() {} });
});
assert.equal(opened.length, 2, "Two immediate menu presses open one card");
let prevented = false;
await act(async () => renderer!.root.findByProps({ "data-member-chat-thread": true }).props.onClickCapture({
  target: { closest: () => ({ getAttribute: () => "/patient/zoe?card=visit" }) }, preventDefault() { prevented = true; },
}));
assert.ok(prevented, "The next-step visit link is handled before Link navigation");
assert.equal(opened.length, 3);
await act(async () => renderer!.unmount());
for(const kind of ["medicines","account","plan","bp"]) {
  opened.length=0;
  await act(async()=>{renderer=create(React.createElement(React.StrictMode,null,React.createElement(Chat,{
    locale:"en",initial:empty,upload:false,chatOnly:true,cardKey:kind,cards:{enabled:true,cards:[],clearedSeq:null},
  })),{createNodeMock:()=>({style:{},scrollHeight:60})});});
  assert.equal(opened.length,1,`${kind} opens once under Strict Mode`);
  assert.equal((opened[0] as {reuseCurrent:boolean}).reuseCurrent,true,`${kind} direct entry asks the server to reuse a current open card`);
  assert.equal((opened[0] as {kind:string}).kind,kind);
  await act(async()=>{
    listeners[`noreon:member-${kind}-open`]({preventDefault(){}});
    listeners[`noreon:member-${kind}-open`]({preventDefault(){}});
  });
  assert.equal(opened.length,2,`${kind} repeated menu presses are single flight`);
  for (const task of ["dose", "side_effect", "ldl", "message"]) {
    await act(async () => listeners[`noreon:member-${task}-open`]({ preventDefault() {} }));
    assert.equal((opened.at(-1) as { kind: string }).kind, task, `Former ${task} chip opens from the menu`);
    if (task === "side_effect") assert.ok(renderer!.root.findAllByProps({ href: "/patient/team?section=contact" }).length, "A failed side-effect card still offers contact");
  }
  await act(async()=>renderer!.unmount());
}
console.log("Chat effects: selected reader heading, later outgoing and received messages stay newest-visible. Supplied DOM/IO, actual component state and effects.");
// Current-card lifecycle, actual chat with action IO supplied. No storage or provider calls.
{
 const card=(id:string,at:string)=>registry.cardSchema.parse({id,requestId:crypto.randomUUID(),kind:"account",source:"chip",sourceSeq:null,state:"open",claims:{},outcome:{},snapshot:{v:1,token:"a".repeat(64)},at});
 const old=card(crypto.randomUUID(),"2026-11-01T10:00:00Z"),current=card(crypto.randomUUID(),"2026-11-01T10:01:00Z");
 cardReply={status:"ok",card:current}; opened.length=0;
 const node=()=>({style:{},scrollHeight:1200,scrollTop:0,focus(){},getBoundingClientRect:()=>({top:0}),scrollTo:({top}:{top:number})=>events.push(`scroll:${top}`)});
 await act(async()=>{renderer=create(React.createElement(Chat,{locale:"en",initial:empty,upload:false,chatOnly:true,cards:{enabled:true,cards:[old,current],clearedSeq:null}}),{createNodeMock:node});});
 const rendered=renderer!.root.findAllByType("article");
 assert.equal(rendered.filter(c=>!c.props["data-collapsed"]).length,1,"Only one settings card stays open");
 assert.equal(rendered.find(c=>c.props["data-test-card"]===old.id)?.props["data-collapsed"],true);
 events.length=0;
 await act(async()=>listeners["noreon:member-account-open"]({preventDefault(){}}));
 assert.ok(events.includes("card-start"),"Opening an existing card targets its top");
 events.length=0;
 await act(async()=>listeners["noreon:member-account-open"]({preventDefault(){}}));
 assert.ok(events.includes("card-start"),"Reopening the same card scrolls again");
 events.length=0;
 nextThread={...empty,version:5,answers:[{id:"new-reply",text:"A later reply",at:"2026-11-01T10:05:00Z"}]};
 await act(async()=>listeners.focus());
 assert.ok(!events.includes("card-start"),"A later reply never pulls back to the earlier card");
 const currentProps=renderer!.root.findAll(n=>n.props.card?.id===current.id&&typeof n.props.onCard==='function')[0].props;
 const next=card(crypto.randomUUID(),"2026-11-01T10:06:00Z");cardReply={status:"ok",card:next};
 const count=opened.length;
 await act(async()=>currentProps.onCard({...current,state:"done",outcome:{account:{ok:true}}}));
 assert.equal(opened.length,count+1,"Saved outcome opens current state automatically");
 assert.equal(renderer!.root.findAllByType("article").filter(c=>!c.props["data-collapsed"]).length,1);
 await act(async()=>renderer!.unmount());cardReply={status:"failed"};
}
// A delayed card request must not consume a different task from the composer.
{
  let finishOpen!: (value:typeof cardReply)=>void;
  pendingOpen=new Promise(resolve=>{finishOpen=resolve;});opened.length=0;
  await act(async()=>{renderer=create(React.createElement(Chat,{locale:'en',initial:empty,upload:false,chatOnly:true,cards:{enabled:true,cards:[],clearedSeq:null}}));});
  await act(async()=>listeners['noreon:member-plan-open']({preventDefault(){}}));
  const task=tasks.CHAT_TASKS.bp.text.en;
  await act(async()=>renderer!.root.findByType('textarea').props.onChange({target:{value:task}}));
  await act(async()=>renderer!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(opened.length,1,'The pending plan remains the only request');
  assert.equal(renderer!.root.findByType('textarea').props.value,task,'The unaccepted task stays in the composer');
  await act(async()=>finishOpen({status:'failed'}));pendingOpen=null;
  await act(async()=>renderer!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(opened.length,2);assert.equal((opened.at(-1) as {kind:string}).kind,'bp');
  assert.equal(renderer!.root.findByType('textarea').props.value,'','An accepted task clears the composer');
  await act(async()=>renderer!.unmount());
}
// An outcome records an attempt, not necessarily a successful feature save.
for (const [kind, outcome] of [
  ['menu', {everyday:{attempted:true},'everyday:result':{status:'unavailable'}}],
  ['menu', {everyday:{attempted:true}}],
  ['account', {account:{ok:false,reason:'unavailable'}}],
  ['medicines', {medicines:{status:'unknown'}}],
  ['visit', {booking:{ok:false,code:'unknown',outcomeUnknown:true}}],
] as const) {
  const card=registry.cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind,source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T10:00:00Z',snapshot:kind==='menu'?{v:1,view:'earlier',token:'a'.repeat(64)}:kind==='visit'?{v:1,available:true,next:null,proposal:null,attention:false}:{v:1,token:'a'.repeat(64)}});
  opened.length=0;
  await act(async()=>{renderer=create(React.createElement(Chat,{locale:'en',initial:empty,upload:false,chatOnly:true,cards:{enabled:true,cards:[card],clearedSeq:null}}));});
  const control=renderer!.root.findAll(n=>n.props.card?.id===card.id&&typeof n.props.onCard==='function')[0];
  // Simulate a committed feature write whose reply was lost: the recorded receipt is unavailable.
  await act(async()=>control.props.onCard({...card,state:'done',outcome}));
  assert.equal(opened.length,0,`${kind}: an uncertain receipt never opens a replacement form`);
  assert.equal(renderer!.root.findByType('article').props['data-collapsed'],false,'The warning card stays expanded');
  await act(async()=>renderer!.unmount());
}
// Explicit success still refreshes the matching view, including multi-key everyday receipts.
for (const [kind, outcome] of [
  ['menu', {everyday:{attempted:true},'everyday:result':{status:'saved'}}],
  ['medicines', {medicines:{kind:'add',status:'added'}}],
  ['visit', {booking:{ok:true,code:'saved'}}],
] as const) {
  const card=registry.cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind,source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T10:00:00Z',snapshot:kind==='menu'?{v:1,view:'earlier',token:'a'.repeat(64)}:kind==='visit'?{v:1,available:true,next:null,proposal:null,attention:false}:{v:1,token:'a'.repeat(64)}});
  const next={...card,id:crypto.randomUUID(),at:'2026-11-01T10:01:00Z'};
  opened.length=0;cardReply={status:'ok',card:next};
  await act(async()=>{renderer=create(React.createElement(Chat,{locale:'en',initial:empty,upload:false,chatOnly:true,cards:{enabled:true,cards:[card],clearedSeq:null}}));});
  const control=renderer!.root.findAll(n=>n.props.card?.id===card.id&&typeof n.props.onCard==='function')[0];
  await act(async()=>control.props.onCard({...card,state:'done',outcome}));
  assert.equal(opened.length,1,`${kind}: explicit success opens the updated view`);
  assert.equal(renderer!.root.findAllByType('article').filter(n=>!n.props['data-collapsed']).length,1);
  await act(async()=>renderer!.unmount());cardReply={status:'failed'};
}
console.log('Card lifecycle: unavailable/unknown receipts stay expanded without replacement forms; overlapping task text survives until accepted. Actual parent with supplied IO.');
// Exercise the extracted hook itself. The same IO boundaries as the real chat are supplied;
// no stand-in hook can satisfy these identity and same-version update regressions.
{
 const hook:Record<string,unknown>={};
 runChatView('components/patient/use-zoe-thread.ts',{...chatContext,exports:hook});
 const useThread=hook.useZoeThread as typeof import('../components/patient/use-zoe-thread').useZoeThread;
 const initial:contracts.ZoeThread={...empty,notices:[{id:'11111111-1111-4111-8111-111111111111',text:'A saved notice',at:'2026-11-01T09:00:00Z',closed:false}],firstUnseenNotice:'11111111-1111-4111-8111-111111111111',emergencyCheck:{env:{NOREON_ZOE_TEST_LEXICON:'true'},intake:{enabled:true,active:true}},replies:[{id:'stable-reply',text:'Original reply',doctorName:'Recorded doctor',at:'2026-11-01T10:00:00Z'}]};
 let current!:ReturnType<typeof useThread>;
 function Fixture(){const state=useThread({initial,emergencyCheck:initial.emergencyCheck});React.useLayoutEffect(()=>{current=state;});return null;}
 await act(async()=>{renderer=create(React.createElement(Fixture));});
 const originalThread=current.thread,originalItems=current.items,originalEmergencies=current.emergencies;
 nextThread=structuredClone(initial);
 await act(async()=>listeners.focus());
 assert.equal(current.thread,originalThread,'Identical poll preserves the thread reference');
 assert.equal(current.items,originalItems,'Identical poll preserves the derived items reference');
 assert.equal(current.emergencies,originalEmergencies,'Identical screening payload preserves emergency props passed to the memoized list');
 nextThread=structuredClone(initial);delete nextThread.notices;delete nextThread.firstUnseenNotice;
 await act(async()=>listeners.focus());
 assert.equal(current.thread,originalThread,'Failed additive notice read preserves thread identity');
 assert.equal(current.items,originalItems,'Failed additive notice read preserves visible notice and list identity');
 nextThread={...structuredClone(initial),replies:[{...initial.replies[0],text:'Corrected reply'}]};
 await act(async()=>listeners.focus());
 assert.equal(current.thread.version,initial.version,'A reply edit can keep the same version');
 assert.notEqual(current.thread,originalThread,'Changed same-version reply replaces the thread');
 assert.notEqual(current.items,originalItems,'Changed same-version reply rebuilds visible items');
 assert.ok(JSON.stringify(current.items).includes('Corrected reply'),'The corrected reply reaches the actual hook output');
 const changedThread=current.thread,changedItems=current.items;
 nextThread=structuredClone(nextThread);
 await act(async()=>listeners.focus());
 assert.equal(current.thread,changedThread,'A later identical poll retains the corrected thread');
 assert.equal(current.items,changedItems,'A later identical poll retains the corrected items');
 await act(async()=>renderer!.unmount());
}
console.log('Shared hook: identical polls retain thread/items identity; changed replies update at the same version. Actual hook with supplied IO.');
// iPhone Safari: the page follows the visual viewport, so the keyboard can't leave blank space or hide the header.
const memberChatCss=readFileSync('app/patient/member-chat.css','utf8');
assert.match(memberChatCss,/position: fixed; inset-inline: 0; top: var\(--chat-view-top, 0px\); height: var\(--chat-view-height, 100dvh\)/);
assert.match(readFileSync('components/patient/zoe-chat.tsx','utf8'),/useChatViewport\(chatOnly\)/);
const viewportHook=readFileSync('components/patient/use-chat-viewport.ts','utf8');
assert.match(viewportHook,/if \(editing\(\)\)/,'The visual viewport sets the height only while a field has focus');
assert.match(viewportHook,/else if \(performance\.now\(\) < guardUntil\) stick\(\)/,'A restored scroll position cannot leave the newest message');

// Exercise the real follow hook: returning after reading history must reset arrival,
// while ordinary scrolling up must remain free until that return.
const hookExports: Record<string, unknown> = {};
const browserEvents = new EventTarget(), documentEvents = new EventTarget();
const scrollBox = Object.assign(new EventTarget(), { scrollHeight: 12000, clientHeight: 600, scrollTop: 11400, children: [] });
new vm.Script(ts.transpileModule(viewportHook, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText).runInNewContext({
  exports: hookExports, require: () => React,
  window: browserEvents, document: Object.assign(documentEvents, { hidden: false }),
  performance: { now: () => 0 }, requestAnimationFrame: (fn: () => void) => fn(),
  ResizeObserver: class { observe() {} disconnect() {} },
});
const follow = hookExports.useChatFollow as (enabled: boolean, ref: React.RefObject<HTMLElement | null>, options: { returnToNewest: boolean }) => void;
const scrollRef = { current: scrollBox as unknown as HTMLElement };
function FollowFixture() { follow(true, scrollRef, { returnToNewest: true }); return null; }
await act(async () => { renderer = create(React.createElement(FollowFixture)); });
for (const [target, event] of [[browserEvents, "pageshow"], [documentEvents, "visibilitychange"]] as const) {
  scrollBox.dispatchEvent(new Event("wheel"));
  scrollBox.scrollTop = 0;
  scrollBox.dispatchEvent(new Event("scroll"));
  assert.equal(scrollBox.scrollTop, 0, "Reading older messages never locks scrolling");
  target.dispatchEvent(new Event(event));
  assert.equal(scrollBox.scrollTop, 12000, `${event}: returning reaches the newest notices after reading history`);
}
await act(async () => renderer!.unmount());
console.log("Return to chat: newest arrival restored after reading older messages, with free scrolling between returns.");
assert.match(memberChatCss,/form\[data-zoe-composer\] textarea \{\n  font-size: max\(16px, 1rem\)/,'Below 16px iOS zooms the page when the input takes focus');
assert.match(memberChatCss,/\[data-member-chat-thread\]\.zk-chat \{[^}]*min-height: 0/,'A minimum height would push the input behind the keyboard');
