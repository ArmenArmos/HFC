/** Pure thread behavior: no database, credentials, storage or network. */
import assert from 'node:assert/strict';
import {answeredCount,canStartNewQuestion,chatItems,threadSchema,type ZoeThread} from '@/lib/zoe/app-chat-contracts';
const id='11111111-1111-4111-8111-111111111111';
const base:ZoeThread={ok:true,version:1,ack:null,zoeReplies:true,settledSeq:0,messages:[{seq:1,text:'Question',at:'2026-11-01T10:00:00Z',channel:'app',requestId:null}],replies:[],answers:[]};
const notice={id,text:'Approved Telegram notice',at:'2026-11-01T10:01:00Z',closed:false};
const withNotice={...base,notices:[notice],firstUnseenNotice:id};
assert.equal(threadSchema.safeParse(withNotice).success,true,'Strict thread accepts validated optional notices');
assert.equal(threadSchema.safeParse({...withNotice,notices:[{...notice,closed:'false'}]}).success,false);
assert.equal(threadSchema.safeParse({...withNotice,notices:[{...notice,link:'/patient'}]}).success,false,'No undeclared card/link contract');
assert.equal(threadSchema.safeParse({...withNotice,firstUnseenNotice:'bad'}).success,false);
let items=chatItems(withNotice,Date.parse('2026-11-01T10:01:30Z'));
assert.deepEqual(items.map(x=>x.kind),['member','pending','notice'],'A notice never answers the member message');
assert.equal(items.at(-1)?.key,`N${id}`);
const answered={...withNotice,answers:[{id,text:'Zoe answer',at:'2026-11-01T10:02:00Z'}]};
items=chatItems(answered,Date.parse('2026-11-01T10:04:00Z'));
assert.deepEqual(items.map(x=>x.kind),['member','notice','answer'],'Look past the notice to the answer: no false care-team ack');
assert.equal(answeredCount(withNotice),0,'A notice never counts as an answer');
assert.equal(answeredCount(answered),1);
assert.equal(canStartNewQuestion(items),true);
assert.equal(canStartNewQuestion(chatItems({...withNotice,messages:[]})),false);
assert.equal(chatItems({...answered,breaks:[{afterSeq:1,at:notice.at}]}).at(-1)?.kind,'divider','New question divider stays at the end');
console.log('Member notices chat: strict schema, chronological items, pending/ack, answer count and divider behavior pass.');

// Failed optional polls preserve both notice content and object identity on unchanged data.
const {keepThreadNotices}=await import('@/lib/zoe/app-chat-contracts');
assert.equal(keepThreadNotices({...base},withNotice),withNotice);
assert.equal(keepThreadNotices({...withNotice,notices:[{...notice}]},withNotice),withNotice);
assert.deepEqual(keepThreadNotices({...base,version:2},withNotice).notices,[notice]);
assert.deepEqual(keepThreadNotices({...base,notices:[],firstUnseenNotice:null},withNotice).notices,[],'An authoritative empty journal clears old content');

// Actual scroll hook, with supplied geometry. Browser layout is covered separately in WebKit.
const {readFileSync}=await import('node:fs');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const {default:React}=await import('react');
const {act,create}=await import('react-test-renderer');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const browser=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false});
const target={getBoundingClientRect:()=>({top:500})};
const box=Object.assign(new EventTarget(),{scrollTop:0,scrollHeight:2400,clientHeight:600,
 getBoundingClientRect:()=>({top:0}),querySelector:(selector:string)=>selector===`[data-message-key="N${id}"]`?target:null});
let resize=()=>{};
const hook:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/chat-v2/use-thread-scroll.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({
 exports:hook,window:browser,document:doc,requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},
 ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}},require(){return React;},
});
const useScroll=hook.useThreadScroll as (revision:string,first?:string|null)=>{threadRef:React.RefObject<HTMLElement|null>;contentRef:React.RefObject<HTMLDivElement|null>;unread:boolean;newest:()=>void};
let current!:ReturnType<typeof useScroll>;
function Fixture({revision,first}:{revision:string;first:string|null}){const state=useScroll(revision,first);React.useLayoutEffect(()=>{current=state;});return React.createElement('section',{ref:state.threadRef},React.createElement('div',{ref:state.contentRef}));}
let tree!:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(Fixture,{revision:'one',first:`N${id}`}),{createNodeMock:node=>node.type==='section'?box:{}});});
assert.ok(box.scrollTop>=450&&box.scrollTop<=500,'First unseen opens near the top');
assert.equal(current.unread,true,'There is more below the first unseen');
const opened=box.scrollTop;
await act(async()=>resize());
assert.equal(box.scrollTop,opened,'Resize never resumes following after unseen opening');
await act(async()=>tree.update(React.createElement(Fixture,{revision:'one',first:null})));
assert.equal(box.scrollTop,opened,'Seen poll never relocates the reader');
await act(async()=>{box.dispatchEvent(new Event('wheel'));box.scrollTop=100;box.dispatchEvent(new Event('scroll'));});
await act(async()=>tree.update(React.createElement(Fixture,{revision:'two',first:`N${id}`})));
assert.equal(box.scrollTop,100,'New notice keeps an older reader in place');
assert.equal(current.unread,true);
await act(async()=>{browser.dispatchEvent(new Event('focus'));});
assert.equal(box.scrollTop,100,'App return keeps a reader in place');
await act(async()=>current.newest());
assert.equal(box.scrollTop,2400);
await act(async()=>tree.unmount());
await act(async()=>{tree=create(React.createElement(Fixture,{revision:'two',first:null}),{createNodeMock:node=>node.type==='section'?box:{}});});
assert.equal(box.scrollTop,2400,'Reopen without unseen starts at newest');
await act(async()=>tree.unmount());
console.log('Member notice polls and first-unseen scroll: actual hook checks pass with supplied geometry.');

// IntersectionObserver receipts run only for notices 60% visible on a visible page.
const seenHook:Record<string,unknown>={};
const visibility=Object.assign(new EventTarget(),{visibilityState:'visible'});
const one={dataset:{notice:id}},laterId='22222222-2222-4222-8222-222222222222',two={dataset:{notice:laterId}};
const thirdId='33333333-3333-4333-8333-333333333333',three={dataset:{notice:thirdId}};
const seenRoot={querySelectorAll:()=>[one,two,three]};
let intersect!:(entries:unknown[])=>void;
let timer:(()=>void)|undefined;
const posted:string[]=[];
new vm.Script(ts.transpileModule(readFileSync('components/chat-v2/use-notice-seen.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({
 exports:seenHook,document:visibility,
 setTimeout:(fn:()=>void)=>{timer=fn;return 1;},clearTimeout:()=>{timer=undefined;},
 fetch:async(url:string,options:{method:string;body:string})=>{assert.equal(url,'/api/patient/zoe/notices/seen');assert.equal(options.method,'POST');posted.push(JSON.parse(options.body).id);return {ok:true};},
 IntersectionObserver:class{constructor(fn:typeof intersect,options:{root:unknown;threshold:number[]}){intersect=fn;assert.equal(options.root,seenRoot);assert.ok(options.threshold.includes(0.6));}observe(){}disconnect(){}},require(){return React;},
});
const useSeen=seenHook.useNoticeSeen as typeof import('../components/chat-v2/use-notice-seen').useNoticeSeen;
function SeenFixture(){const ref=React.useRef(seenRoot as unknown as HTMLElement);useSeen(ref,[notice,{...notice,id:laterId,at:'2026-11-01T10:02:00Z'},{...notice,id:thirdId,at:'2026-11-01T10:03:00Z'}]);return null;}
await act(async()=>{tree=create(React.createElement(SeenFixture));});
intersect([{target:one,isIntersecting:true,intersectionRatio:0.59}]);timer?.();assert.equal(posted.length,0);
intersect([{target:one,isIntersecting:true,intersectionRatio:0.6},{target:two,isIntersecting:true,intersectionRatio:0.8}]);
assert.equal(posted.length,0,'Receipts debounce');timer?.();
assert.deepEqual(posted,[laterId],'One debounced receipt marks through the newest visible notice');
intersect([{target:two,isIntersecting:true,intersectionRatio:1}]);timer?.();
assert.equal(posted.filter(x=>x===laterId).length,1,'At most one receipt per id');
visibility.visibilityState='hidden';
intersect([{target:three,isIntersecting:true,intersectionRatio:1}]);timer?.();
assert.equal(posted.length,1,'Hidden page never sends receipts');
visibility.visibilityState='visible';visibility.dispatchEvent(new Event('visibilitychange'));timer?.();
assert.ok(posted.includes(thirdId),'Visible return observes the current viewport');
await act(async()=>tree.unmount());
console.log('Member notice seen: actual observer hook checks threshold, debounce, newest visible, once per id and hidden-page suppression.');

// Render the actual text-only notice view. Shared network/state and scroll/observer are tested above.
const jsx=await import('react/jsx-runtime');
const {tx}=await import('@/lib/patient/copy');
const {formatMemberDate}=await import('@/lib/patient/date-format');
const cardThread=await import('@/lib/zoe-chat-actions/thread');
const doctorNote=await import('@/lib/chat/doctor-note');
const view:Record<string,unknown>={};
const noop=()=>null;
new vm.Script(ts.transpileModule(readFileSync('components/chat-v2/member-chat.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({
 exports:view,require(name:string){
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/chat/doctor-note')return doctorNote;
  if(name==='@/components/patient/use-zoe-thread')return {useZoeThread:({initial}:{initial:ZoeThread})=>({items:chatItems(initial),cards:{enabled:false,cards:[]},setCards:noop,focusCard:null,opening:null,openCard:noop,localEmergencies:{},thread:initial,emergencies:{},shown:[],input:{current:null},text:'',setText:noop,notice:null,setNotice:noop,submit:noop,deliver:noop})};
  if(name==='./use-thread-scroll')return {useThreadScroll:()=>({threadRef:{current:null},contentRef:{current:null},unread:false,newest:noop,isFollowing:()=>true})};
  if(name==='./use-notice-seen')return {useNoticeSeen:noop};
  if(name==='./speaker')return {Speaker:noop,VoicePlayback:({children}:{children:React.ReactNode})=>children};
  if(name==='./microphone')return {Microphone:noop};
  if(name==='@/lib/zoe-chat-actions/thread')return cardThread;
  if(name==='@/lib/patient/copy')return {tx};
  if(name==='@/lib/patient/date-format')return {formatMemberDate};
  if(name==='@/lib/zoe/app-chat-contracts')return {ZOE_CHAT_MAX:4096};
  if(name==='lucide-react')return {Phone:noop,ArrowUp:noop};
  return new Proxy({},{get:()=>noop});
 },
});
const View=view.MemberChat as React.ComponentType<Record<string,unknown>>;
await act(async()=>{tree=create(React.createElement(View,{locale:'en',memberName:'Synthetic member',revision:1,initial:{...base,messages:[],notices:[{...notice,closed:true}]}}));});
const rendered=tree.root.findAll(node=>node.props['data-notice']===id);
assert.equal(rendered.length,1);
assert.equal(rendered[0].props['data-message-key'],`N${id}`);
assert.equal(rendered[0].props['data-closed'],true);
assert.deepEqual(rendered[0].findByProps({className:'cv2-say'}).children,[notice.text]);
assert.equal(rendered[0].findAllByType('a').length,0);
assert.equal(rendered[0].findAllByType('button').length,0);
assert.equal(rendered[0].findAllByProps({className:'cv2-time'}).length,1);
await act(async()=>tree.unmount());
console.log('Member notice view: actual JSX renders once as Zoe, with text/time, closed attribute and no links or buttons.');
