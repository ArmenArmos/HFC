import {z} from 'zod';
import {answerContentSchema,toolResultSchema,type StreamEvent} from './contracts';

/** What the route can send, checked on arrival: a line with the right type and nothing in it is a failed read, never an empty answer. */
const eventSchema=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('cards'),cards:z.array(toolResultSchema).max(20)}),
 z.strictObject({type:z.literal('answer'),content:answerContentSchema}),
 z.strictObject({type:z.literal('refused'),code:z.enum(['access','off','busy','replayed','invalid','unavailable'])}),
]);

/** Only complete NDJSON lines are events. A cut-off or empty turn is a failed read. */
export async function readStaffZoeStream(response:Response,onEvent:(event:StreamEvent)=>void,signal:AbortSignal){
 if(!response.ok||!response.body)throw Error('Zoe stream unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder();let rest='',terminal=false;
 const stop=()=>{void reader.cancel().catch(()=>{});};
 signal.addEventListener('abort',stop,{once:true});
 try{
  if(signal.aborted)return;
  for(;;){
   const {done,value}=await reader.read();if(signal.aborted)return;
   if(done)break;
   rest+=decoder.decode(value,{stream:true});
   const lines=rest.split('\n');rest=lines.pop()??'';
   for(const line of lines){
    if(!line.trim())continue;
    const parsed=eventSchema.safeParse(JSON.parse(line));
    if(!parsed.success)throw Error('Zoe stream invalid');
    const event:StreamEvent=parsed.data as StreamEvent;
    onEvent(event);terminal||=event.type==='answer'||event.type==='refused';
   }
  }
  rest+=decoder.decode();
  if(rest.trim()||!terminal)throw Error('Zoe stream incomplete');
 }finally{signal.removeEventListener('abort',stop);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
