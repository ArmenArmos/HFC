import type {AnswerContent,AskRequest,StreamEvent,ToolResult} from '@/lib/staff-zoe/contracts';
export type ZoeFixture={zoeFetchCalls:AskRequest[];releaseZoe?:()=>void};
export const zoeCard:ToolResult={tool:'bp',state:'ok',facts:[{id:'bp.1',label:'Recorded blood pressure',value:'120/80 mmHg',date:'2026-11-02',mark:'reviewed',href:null,analyte:null}],quotes:[],missing:[],href:'/staff/real/members/fictional'};
export const zoeAnswer=(held=false):AnswerContent=>({version:'staff-zoe-1',state:held?'held':'answered',say:held?[]:[{text:'Recorded blood pressure: 120/80 mmHg',facts:zoeCard.facts}],quotes:[],notKnown:[],declined:false,notice:held?'The answer was held. Read the recorded evidence below.':null,cards:[zoeCard]});
export function zoeFixture(){
 const f=(window as unknown as {fixture:Partial<ZoeFixture>&{state:string|null}}).fixture;
 return Object.assign(f,{zoeFetchCalls:f.zoeFetchCalls??[]});
}
/** This replaces only the browser fetch seam. No provider or actual ask route is contacted. */
export function installZoeFetch(){
 zoeFixture();
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
   if(f.state==='zoe-empty'){controller.close();return;}
   controller.enqueue(encoder.encode(line({type:'cards',cards:[zoeCard]})));
   if(f.state==='zoe-delayed')await new Promise<void>(resolve=>{f.releaseZoe=resolve;});
   const answer=line({type:'answer',content:zoeAnswer(f.state==='zoe-held')});
   if(f.state==='zoe-cut'){controller.enqueue(encoder.encode(answer.slice(0,Math.floor(answer.length/2))));controller.close();return;}
   const cut=Math.floor(answer.length/2);controller.enqueue(encoder.encode(answer.slice(0,cut)));
   await new Promise(resolve=>setTimeout(resolve,20));controller.enqueue(encoder.encode(answer.slice(cut)));controller.close();
  }}),{headers:{'Content-Type':'application/x-ndjson'}});
 };
}
