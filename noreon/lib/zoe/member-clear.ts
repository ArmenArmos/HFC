import {alarmTriggerSchema} from './alarm-conversation';
import {STAGING_ENTRIES} from './urgent-staging';
import {z} from 'zod';
import {normaliseText} from './normalise';
import type {ReplyLanguage} from './provider';

export const MEMBER_CLEAR_VERSION='zoe-member-clear-2';
export const memberClearOn=(env:Record<string,string|undefined>)=>env.NOREON_ZOE_MEMBER_CLEAR==='true';
export const memberClearContextSchema=z.strictObject({
 refused103:z.boolean().optional(),
 startedAt:z.iso.datetime({offset:true}).nullable(),sinceMinutes:z.number().int().min(0).nullable(),
 clearThroughSeq:z.number().int().nullable().default(null),clearSinceMinutes:z.number().int().min(0).nullable().default(null),
 readingId:z.uuid().nullable(),readingVersion:z.string().max(32).nullable().default(null),readingSavedAt:z.iso.datetime({offset:true}).nullable(),
 readingMeasuredAt:z.iso.datetime({offset:true}).nullable().optional(),
 trigger:alarmTriggerSchema.nullable().optional(),openedBy:z.enum(['rule','model']).nullable().optional(),throughSeq:z.number().int().nullable().optional(),
 readingClearReason:z.enum(['new_reading','corrected_reading']).nullable(),suppressStoredReading:z.boolean(),
});
export type MemberClearReason='feels_well'|'reading_disputed'|'member_request'|'new_reading'|'corrected_reading';
// Whole-message affirmative allowlists: negations, questions, quoted examples and extra clauses never clear.
// Urgent words and symptom red flags run before this parser in the pipeline.
const phrases:Record<'feels_well'|'reading_disputed'|'member_request',string>={
 feels_well:"(?:i(?:'m| am) feeling (?:good|better|fine)(?: now)?|i feel (?:good|better|fine|well|ok|okay)(?: now)?|i(?:'m| am) (?:fine|ok|okay|well)(?: now)?|it (?:has )?passed|(?:ես )?ինձ ավելի լավ եմ զգում|ինձ լավ եմ զգում|ես ինձ լավ եմ զգում|լավ եմ(?: հիմա)?|լավ եմ զգում|ես լավ եմ զգում|հիմա լավ եմ|անցավ|(?:արդեն )?անցել է|ինձ լավ եմ զգում հիմա|(?:es )?lav em(?: hima| zgum)?|(?:es )?indz (?:aveli )?lav em zgum|ancav|antsav|arden ancel e|я (?:сейчас |теперь )?чувствую себя (?:хорошо|лучше|нормально)|мне (?:сейчас |теперь )?хорошо|(?:вс[её] )?прошло|я (?:сейчас )?в порядке(?: сейчас)?)",
 reading_disputed:"(?:(?:the |my )?reading was wrong|i entered it by mistake|i (?:entered|saved) (?:the |my )?reading by mistake|ցուցանիշը սխալ էր|ճնշումը սխալ եմ մուտքագրել|սխալմամբ եմ մուտքագրել|սխալ եմ գրել|chapumy sxal er|cnshumy sxal em mutqagrel|sxal em grel|sxalmamb em mutqagrel|показание было неверным|показание было ошибочным|я (?:вв[её]л|ввела) (?:это )?по ошибке|я ошибся при вводе|я ошиблась при вводе)",
 member_request:"(?:i was (?:kidding|joking)|false alarm|by mistake|cancel|(?:ես )?կատակ էի անում|սխալ ահազանգ|սխալմամբ|չեղարկել|(?:es )?katak ei anum|sxal ahazang|sxalmamb|chegharkel|charkel|я (?:шутил|шутила|пошутил|пошутила)|ложная тревога|по ошибке|отмена|отменить|clear (?:the |my )?(?:103 )?alarm|stop (?:the |my )?alarm|անջատեք ահազանգը|փակեք ահազանգը|anjateq ahazangy|pakeq ahazangy|отключите тревогу|снимите тревогу)",
};
const patterns=Object.entries(phrases).map(([reason,p])=>({reason:reason as MemberClearReason,re:new RegExp(`^${p}$`,'u')}));
export function memberClearPhrase(raw:string):MemberClearReason|null{
 if(/[?՞？]/u.test(raw))return null;
 const t=normaliseText(raw).replaceAll('’',"'").replace(/[.!։]+$/u,'').replace(/\s+/gu,' ').trim();
 return patterns.find(p=>p.re.test(t))?.reason??null;
}
const NEGATED_WELL=/(?<![\p{L}])(?:(?:do not|don'?t|not) feel(?:ing)? (?:good|fine|well|ok|okay|(?:any )?better)|not (?:feeling )?(?:fine|well|ok|okay|good|(?:any )?better)|feel(?:ing)? (?:unwell|bad)|(?:has not|hasn'?t|not) passed|did(?: not|n'?t) pass|չեմ զգում|լավ չեմ|չի անցել|lav chem|chem (?:lav |indz lav )?zgum|chem lav|chi ancel|չեմ լավ|не чувствую себя (?:хорошо|лучше)|не (?:(?:стало|становится) )?лучше|нехорошо|не в порядке|не прошло|чувствую себя плохо|себя плохо чувствую|мне плохо|не очень хорошо)(?![\p{L}])/u;
export const negatesBeingWell=(raw:string)=>NEGATED_WELL.test(normaliseText(raw).replaceAll('’',"'"));
// Unlike an explicit whole-message clear, a reading can clear an ordinary follow-up
// (including "why"). Conditional, quoted and negative states must still keep the alarm.
const CONDITIONAL=/(?<![\p{L}])(?:if|unless|եթե|ete|yete|если|esli)(?![\p{L}])/u;
const QUOTED=/["“”«»„]|(?<![\p{L}])['‘][^'’\n]+['’](?![\p{L}])/u;
export function vetoesReadingClear(raw:string):boolean{
 return negatesBeingWell(raw)||CONDITIONAL.test(normaliseText(raw))||QUOTED.test(raw);
}
/** A pending calmer reading cannot clear a message containing urgent vocabulary, even when denied or historical. */
export function mentionsUrgentWords(raw:string):boolean{
 const t=normaliseText(raw);
 return STAGING_ENTRIES.some(e=>e.all.length>0&&e.all.every(stem=>t.includes(stem)));
}
/** UNAPPROVED STAGING COPY. Armen and Yesayi must approve before go-live. */
export const MEMBER_CLEAR_TEXT:Record<ReplyLanguage,string>={
 en:'Glad to hear it. If it comes back or gets worse, call 103.',
 hy:'Ուրախ եմ լսել։ Եթե կրկնվի կամ վատանա, զանգահարեք 103։',
 ru:'Рада это слышать. Если это повторится или станет хуже, звоните 103.',
};
