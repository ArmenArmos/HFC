import type {AnswerContent,AskRequest,StreamEvent,ToolResult} from '@/lib/staff-zoe/contracts';
export type ZoeFixture={zoeOpenCalls:string[];zoeQuestionCalls:string[];zoeQuestionTargets:(string|null)[];zoeHistoryReads:number;zoeFetchCalls:AskRequest[];releaseZoe?:()=>void};
export const zoeConversation='f1a00000-0000-4000-8000-000000000001';
export const zoeCard:ToolResult={tool:'bp',state:'ok',facts:[{id:'bp.1',label:'Recorded blood pressure',value:'120/80 mmHg',date:'2026-11-02',mark:'reviewed',href:null,analyte:null}],quotes:[],missing:[],href:'/staff/real/members/fictional'};
export const bpChartCard:ToolResult={...zoeCard,bpSeries:[
 {measuredAt:'2026-10-27T04:00:00Z',systolic:134,diastolic:85,slot:'morning'},
 {measuredAt:'2026-10-27T16:00:00Z',systolic:132,diastolic:84,slot:'evening'},
 {measuredAt:'2026-10-28T04:00:00Z',systolic:130,diastolic:83,slot:'morning'},
 {measuredAt:'2026-10-28T16:00:00Z',systolic:129,diastolic:82,slot:'evening'},
 {measuredAt:'2026-11-01T20:05:00Z',systolic:128,diastolic:82,slot:'evening'},
 {measuredAt:'2026-11-02T04:00:00Z',systolic:132,diastolic:84,slot:'morning'},
 {measuredAt:'2026-11-02T16:00:00Z',systolic:126,diastolic:79,slot:'evening'},
 {measuredAt:'2026-11-03T04:00:00Z',systolic:130,diastolic:81},
]};
export const zoeAnswer=(held=false):AnswerContent=>({version:'staff-zoe-1',state:held?'held':'answered',say:held?[]:[{text:'Recorded blood pressure: 120/80 mmHg',facts:zoeCard.facts}],quotes:[],notKnown:[],declined:false,notice:held?'The answer was held. Read the recorded evidence below.':null,cards:[zoeCard]});
export function zoeFixture(){
 const f=(window as unknown as {fixture:Partial<ZoeFixture>&{state:string|null}}).fixture;
 return Object.assign(f,{zoeOpenCalls:f.zoeOpenCalls??[],zoeQuestionCalls:f.zoeQuestionCalls??[],zoeQuestionTargets:f.zoeQuestionTargets??[],zoeHistoryReads:f.zoeHistoryReads??0,zoeFetchCalls:f.zoeFetchCalls??[]});
}
/** This replaces only the browser fetch seam. No provider or actual ask route is contacted. */
export function installZoeFetch(){
 const original=window.fetch.bind(window);
 window.fetch=async(input,init)=>{
  if(!String(input).includes('/zoe/ask'))return original(input,init);
  const f=zoeFixture();f.zoeFetchCalls.push(JSON.parse(String(init?.body)) as AskRequest);
  if(f.state==='zoe-fetch-thrown')throw Error('Synthetic fetch unavailable');
  const encoder=new TextEncoder();
  return new Response(new ReadableStream({async start(controller){
   const line=(event:StreamEvent)=>JSON.stringify(event)+'\n';
   const refused=f.state?.replace('zoe-refused-','');
   if(f.state?.startsWith('zoe-refused-')){controller.enqueue(encoder.encode(line({type:'refused',code:refused as Extract<StreamEvent,{type:'refused'}>['code']})));controller.close();return;}
   controller.enqueue(encoder.encode(line({type:'cards',cards:[zoeCard]})));
   if(f.state==='zoe-delayed')await new Promise<void>(resolve=>{f.releaseZoe=resolve;});
   const answer=line({type:'answer',content:zoeAnswer(f.state==='zoe-held')});
   const cut=Math.floor(answer.length/2);controller.enqueue(encoder.encode(answer.slice(0,cut)));
   await new Promise(resolve=>setTimeout(resolve,20));controller.enqueue(encoder.encode(answer.slice(cut)));controller.close();
  }}),{headers:{'Content-Type':'application/x-ndjson'}});
 };
}
