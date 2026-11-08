import {z} from 'zod';
import {CRISIS_LINE_TEXT,urgentStepsText} from './health-answer';
import {normaliseText} from './normalise';
import {CRISIS_TEXT,latinArmenian} from './conversation';
import {mentionsMedicine} from './output-guard';
import {BATCH_CORRECTION,BATCH_OTHER_PERSON,type ZoeEvent} from './pipeline';
import type {ReplyLanguage} from './provider';
import {classifyScope} from './scope';
import {URGENT_MEDICINE_TEXT,URGENT_TEXT} from './symptoms/intake';
import {STAGING_LEXICON_VERSION,stagingMatches,stagingPlaceholderActive} from './urgent-staging';
import {urgentDecision} from './urgent-test';

type Env=Record<string,string|undefined>;

/**
 * The fixed 103 text for a Telegram member Zoe skips (no Zoe consent, no assigned doctor, Zoe off; zoe_run_claim). Zoe does not read
 * these members and no model is called: only the urgent word list runs here, the same list and the same text as lib/zoe/pipeline.ts
 * for a member she does read (scripts/check-urgent-reach.ts pins that they match). The text is never stored or logged here.
 */
const messages=z.array(z.object({seq:z.number().int(),text:z.string()})).min(1);
export const unreadUrgentRowsSchema=z.array(z.object({runId:z.uuid(),locale:z.enum(['en','hy']).nullable(),freeMode:z.boolean(),messages}));
export type UnreadUrgentRow=z.infer<typeof unreadUrgentRowsSchema>[number];
export type UnreadUrgentResult={seq:number|null;answer:string|null;language:ReplyLanguage|null;alertReason:'zoe_urgent_route'|'zoe_self_harm'|null;events:ZoeEvent[]};

const unique=(flags:string[])=>[...new Set(flags.flatMap(f=>f.split(',')).filter(Boolean))].sort().join(',');

/** Whether a list is in force. Without one nothing is read: the unsigned list is "skipped", never "not urgent". */
export const unreadUrgentActive=(env:Env=process.env)=>urgentDecision('',env).outcome!=='skipped';

/** One skipped run's result for zoe_unread_urgent_finish. directAnswers: the caller has a real model (the pipeline's free-mode switch). */
export function unreadUrgentResult(row:UnreadUrgentRow,opts:{env?:Env;directAnswers:boolean}):UnreadUrgentResult{
 const env=opts.env??process.env,batch=row.messages,latest=batch.at(-1)!,texts=batch.map(m=>m.text);
 const decisions=batch.map(m=>urgentDecision(m.text,env)),hits=decisions.filter(d=>d.outcome==='escalate');
 // The pipeline's Codex A2-1: a combination split across the messages this run covers, and not when one corrects an earlier one
 // or speaks of someone else. Only the combination rules count.
 const mixed=batch.some(m=>BATCH_CORRECTION.test(normaliseText(m.text))||BATCH_OTHER_PERSON.test(normaliseText(m.text)));
 const combos=!hits.length&&batch.length>1&&!mixed&&stagingPlaceholderActive(env)&&env.NOREON_ZOE_TEST_LEXICON!=='true'
  ?stagingMatches(texts.join('\n')).filter(e=>e.all.length===0&&!e.selfHarm&&!e.oneMessage):[];
 const last=decisions.at(-1)!,first=hits[0];
 const flags=unique([...hits.map(d=>String(d.attributes['noreon.zoe.urgent.red_flags']??'')),...combos.flatMap(e=>e.redFlag?[e.redFlag]:[])]);
 const escalate=!!first||combos.length>0;
 const event:ZoeEvent={name:'zoe.guard.urgent_match',outcome:escalate?'escalate':'allow',reason:first?.reason??(combos.length?'urgent_combination_across_unanswered':last.reason),
  rule:first?.rule??(combos.length?'zoe.urgent_staging_placeholder':last.rule),ruleVersion:first?.ruleVersion??(combos.length?STAGING_LEXICON_VERSION:last.ruleVersion),actor:'system',
  attributes:{...(first??last).attributes,'noreon.zoe.guard.name':'urgent_match','noreon.zoe.unread':true,...(escalate?{'noreon.zoe.urgent.red_flags':flags}:{})}};
 if(!escalate)return {seq:null,answer:null,language:null,alertReason:null,events:[event]};
 // The pipeline's safetyLang, crisis, crisisText and urgentText, over the messages this run covers.
 const sc=classifyScope(latest.text);
 const lang:ReplyLanguage=(sc.language==='hy-Latn'||latinArmenian(latest.text))&&row.locale!=='en'?'hy':sc.replyLanguage??row.locale??'hy';
 const freeMode=row.freeMode&&opts.directAnswers,medicine=mentionsMedicine(latest.text);
 const selfHarm=batch.some(m=>stagingMatches(m.text).some(e=>e.selfHarm));
 const answer=selfHarm?(freeMode?`${CRISIS_TEXT[lang]} ${CRISIS_LINE_TEXT[lang]}`:CRISIS_TEXT[lang])
  :freeMode?urgentStepsText(lang,texts,medicine):medicine?URGENT_MEDICINE_TEXT[lang]:URGENT_TEXT[lang];
 return {seq:latest.seq,answer,language:lang,alertReason:selfHarm?'zoe_self_harm':'zoe_urgent_route',events:[event]};
}
