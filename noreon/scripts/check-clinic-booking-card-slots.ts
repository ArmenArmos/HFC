import assert from 'node:assert/strict';
// Clinic booking card, propose panel (quality review item 10): a slower answer for an earlier day never
// fills the list for the day now chosen, and a failed read says so with a retry instead of "No free times".
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='next/navigation')return {url:'data:text/javascript,export function useRouter(){return {refresh(){}}}',shortCircuit:true};
 return next(s,c);
}});
const React=await import('react');const {create,act}=await import('react-test-renderer');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:()=>0});
const {ClinicBookingCard}=await import('@/components/clinic-portal/bookings');
type Slot={key:string;startsAt:string;endsAt:string;free:number};
const slot=(day:string,hhmm:string):Slot=>({key:(day.replaceAll('-','')+hhmm.replace(':','')).padEnd(64,'a'),startsAt:`${day}T${hhmm}:00+04:00`,endsAt:`${day}T${hhmm.slice(0,2)}:30:00+04:00`,free:1});
const future=new Date(Date.now()+5*86400000).toISOString().slice(0,10),later=new Date(Date.now()+6*86400000).toISOString().slice(0,10);
const booking={appointmentId:'11111111-1111-4111-8111-111111111111',revision:1,reference:'22222222-2222-4222-8222-222222222222',kind:'pending' as const,status:'requested' as const,channel:'portal' as const,
 memberName:'Fictional member',memberPhone:null,startsAt:`${future}T09:00:00+04:00`,endsAt:`${future}T09:30:00+04:00`,previousStartsAt:null,previousEndsAt:null,tests:[],proposal:null,rejectedProposal:null,decline:null};
const {renderToStaticMarkup}=await import('react-dom/server');
for(const locale of ['en','hy','ru'] as const){
 // @ts-expect-error Inject a stale deployed booking payload to check defensive rendering.
 const html=renderToStaticMarkup(React.createElement(ClinicBookingCard,{booking:{...booking,memberPhone:'+99900000391'},masked:{memberId:booking.appointmentId,phoneLast4:'0391',birthYear:1975},locale,run:async()=>({status:'access' as const}),slots:async()=>null}));
 assert.ok(html.includes('•••• 0391')&&!html.includes('+99900000391')&&!html.includes('tel:'),`${locale}: upcoming booking only shows last four digits`);
}
const waiting=new Map<string,{resolve:(v:Slot[]|null)=>void;reject:(e:unknown)=>void}>();
const slots=(day:string)=>new Promise<Slot[]|null>((resolve,reject)=>waiting.set(day,{resolve,reject}));
let renderer!:ReturnType<typeof create>;
await act(async()=>{renderer=create(React.createElement(ClinicBookingCard,{booking,locale:'en',run:async()=>({status:'saved'}) as never,slots}));});
const text=()=>JSON.stringify(renderer.toJSON());
type Node={children:(string|Node)[]};const textOf=(n:Node):string=>n.children.map(c=>typeof c==='string'?c:textOf(c)).join('');
const button=(label:string)=>renderer.root.findAll(n=>n.type==='button'&&textOf(n as unknown as Node).includes(label))[0];
await act(async()=>{button('Propose another time').props.onClick();});
const dayInput=()=>renderer.root.find(n=>n.type==='input'&&n.props.type==='date');
// Day A, then day B; A answers last.
await act(async()=>{dayInput().props.onChange({target:{value:future}});});
await act(async()=>{dayInput().props.onChange({target:{value:later}});});
await act(async()=>{waiting.get(later)!.resolve([slot(later,'11:00')]);});
await act(async()=>{waiting.get(future)!.resolve([slot(future,'10:00')]);});
const radios=renderer.root.findAll(n=>n.type==='input'&&n.props.type==='radio').map(n=>n.props.value);
assert.deepEqual(radios,[slot(later,'11:00').key],'only the chosen day\'s times are listed, whatever order the answers came in');
// A failed read is not "no free times"; Try again reads the same day again.
waiting.clear();
await act(async()=>{dayInput().props.onChange({target:{value:future}});});
await act(async()=>{waiting.get(future)!.reject(new Error('synthetic failure'));});
assert.ok(text().includes('Free times could not be loaded.')&&!text().includes('No free times that day.'),'a failed read says so');
waiting.clear();
await act(async()=>{button('Try again').props.onClick();});
assert.ok(waiting.has(future),'Try again reads the same day');
await act(async()=>{waiting.get(future)!.resolve([]);});
assert.ok(text().includes('No free times that day.'),'an empty day still says so');
renderer.unmount();
// An open proposal form closes once the visit starts while the page stays open (review R1 on #343).
{const ticks:(()=>void)[]=[];const realInterval=globalThis.setInterval,realNow=Date.now;let shift=0;
 Object.assign(globalThis,{setInterval:(f:()=>void)=>{ticks.push(f);return 0;}});Date.now=()=>realNow()+shift;
 const soon=new Date(realNow()+30_000).toISOString();
 const current={...booking,kind:'current' as const,status:'confirmed' as const,startsAt:soon,endsAt:new Date(realNow()+1_830_000).toISOString()};
 let card!:ReturnType<typeof create>;
 await act(async()=>{card=create(React.createElement(ClinicBookingCard,{booking:current,locale:'en',run:async()=>({status:'saved'}) as never,slots}));});
 const btn=(label:string)=>card.root.findAll(n=>n.type==='button'&&textOf(n as unknown as Node).includes(label))[0];
 await act(async()=>{btn('Propose another time').props.onClick();});
 assert.ok(card.root.findAll(n=>n.type==='input'&&n.props.type==='date').length===1,'the form is open before the visit starts');
 shift=61_000;await act(async()=>{for(const t of ticks)t();});
 assert.equal(card.root.findAll(n=>n.type==='input'&&n.props.type==='date').length,0,'the form closes once the visit has started');
 assert.equal(btn('Send proposal'),undefined,'no Send proposal after the start');
 card.unmount();Object.assign(globalThis,{setInterval:realInterval});Date.now=realNow;}
console.log('Clinic booking card: newest day wins, failed slot read offers a retry, an open proposal closes at the start PASS');

// Future check-in guidance follows the existing hydrated gates, never a terminal/restricted card.
{
 const realNow=Date.now,realInterval=globalThis.setInterval;
 const ticks:(()=>void)[]=[];let clock=Date.parse('2026-11-06T08:00:00+04:00');
 Date.now=()=>clock;Object.assign(globalThis,{setInterval:(tick:()=>void)=>{ticks.push(tick);return 0;}});
 const visit={...booking,kind:'current' as const,status:'confirmed' as const,startsAt:'2026-11-08T10:00:00+04:00',endsAt:'2026-11-08T10:30:00+04:00'};
 for(const locale of ['en','hy','ru'] as const){
  const label={en:'Check-in opens on',hy:'Այցի գրանցումը հասանելի կլինի',ru:'Отметить визит можно будет'}[locale];
  const props={booking:visit,locale,run:async()=>({status:'saved' as const}),slots:async()=>[]} as unknown as React.ComponentProps<typeof ClinicBookingCard>;
  assert.ok(!renderToStaticMarkup(React.createElement(ClinicBookingCard,props)).includes(label),'no clock-dependent guidance on server');
  let card!:ReturnType<typeof create>;
  await act(async()=>{card=create(React.createElement(ClinicBookingCard,props));});
  assert.ok(JSON.stringify(card.toJSON()).includes(label),`${locale}: future guidance after hydration`);
  assert.ok(JSON.stringify(card.toJSON()).includes({en:'8 Nov, 10:00',hy:'8 նոյ, 10:00',ru:'8 ноя, 10:00'}[locale]),`${locale}: clinic date and Yerevan 24-hour time`);
  for(const status of ['arrived','no-show','completed','cancelled','declined','other'] as const){
   await act(async()=>{card.update(React.createElement(ClinicBookingCard,{...props,booking:{...visit,kind:'history',status}}));});
   assert.ok(!JSON.stringify(card.toJSON()).includes(label),`${locale}: ${status} has no future guidance`);
   await act(async()=>{card.update(React.createElement(ClinicBookingCard,{...props,booking:{...visit,status}}));});
   assert.ok(!JSON.stringify(card.toJSON()).includes(label),`${locale}: terminal status has no guidance even in a stale current card`);
  }
  for(const restricted of [{receiptOnly:true},{decisionOnly:true}]){
   await act(async()=>{card.update(React.createElement(ClinicBookingCard,{...props,...restricted}));});
   assert.ok(!JSON.stringify(card.toJSON()).includes(label),'restricted card has no guidance');
  }
  await act(async()=>{card.unmount();});
 }
 let card!:ReturnType<typeof create>;
 await act(async()=>{card=create(React.createElement(ClinicBookingCard,{booking:visit,locale:'en',run:async()=>({status:'saved' as const}),slots:async()=>[]} as unknown as React.ComponentProps<typeof ClinicBookingCard>));});
 clock=Date.parse('2026-11-08T00:00:00+04:00');await act(async()=>{ticks.forEach(tick=>tick());});
 assert.ok(!JSON.stringify(card.toJSON()).includes('Check-in opens on'),'guidance disappears as soon as arrival opens');
 clock=Date.parse(visit.startsAt);await act(async()=>{ticks.forEach(tick=>tick());});
 assert.ok(!JSON.stringify(card.toJSON()).includes('Check-in opens on'),'guidance stays hidden after visit time');
 await act(async()=>{card.unmount();});Date.now=realNow;Object.assign(globalThis,{setInterval:realInterval});
}
