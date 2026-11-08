import {z} from 'zod';
import {toolResultSchema,answerContentSchema,type StreamEvent} from '@/lib/staff-zoe/contracts';

const refusalCodes=['access','off','busy','replayed','invalid','unavailable'] as const;

/** The stream reader checks only an event's type. A nurse never sees an event whose content is incomplete or invalid. */
export function checkedZoeEvent(event:unknown):StreamEvent{
 const e=(typeof event==='object'&&event!==null?event:{}) as {type?:unknown;cards?:unknown;content?:unknown;code?:unknown};
 if(e.type==='cards'){const cards=z.array(toolResultSchema).safeParse(e.cards);if(cards.success)return {type:'cards',cards:cards.data};}
 if(e.type==='answer'){const content=answerContentSchema.safeParse(e.content);if(content.success)return {type:'answer',content:content.data};}
 if(e.type==='refused'){const code=refusalCodes.find(known=>known===e.code);if(code)return {type:'refused',code};}
 throw Error('Zoe event invalid');
}
