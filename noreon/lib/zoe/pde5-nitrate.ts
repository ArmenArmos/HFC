import {normaliseText} from './normalise';
import type {ReplyLanguage} from './provider';

export const PDE5_NITRATE_VERSION='zoe-pde5-nitrate-2';
/** One vocabulary for the prompt, deterministic guard and replay assertions. Complete,
 * unqualified sentences are deliberate: quoted, hedged or negated substrings do not count. */
export const PDE5_NITRATE_CATEGORICAL:Record<ReplyLanguage,readonly string[]>={
 en:['Never take these medicines together','These medicines must never be taken together'],
 ru:['Никогда не принимайте эти лекарства вместе','Эти лекарства нельзя принимать вместе'],
 hy:['Այս դեղերը երբեք մի ընդունեք միասին','Այս դեղերը չի կարելի ընդունել միասին'],
};
/** Model-free fallback. RU/HY are staging drafts pending Armen/Yesayi sign-off. */
export function pde5NitrateReply(l:ReplyLanguage):string{
 const gap={en:', whatever the gap.',ru:', независимо от интервала.',hy:'՝ անկախ ընդմիջումից։'}[l];
 const ask={en:'Do not take either medicine until you have asked your doctor.',ru:'Не принимайте ни одно из этих лекарств, пока не спросите своего врача.',hy:'Մի ընդունեք այս դեղերից որեւէ մեկը, մինչեւ ձեր բժշկին հարցնելը։'}[l];
 return `${PDE5_NITRATE_CATEGORICAL[l][0]}${gap} ${ask}`;
}
/** Permission, timing and exceptions anywhere in the answer invalidate the warning.
 * Latin forms belong with their language; every list is checked even in a mixed reply. */
const PDE5_NITRATE_PERMISSIVE:Record<ReplyLanguage,readonly RegExp[]>={
 en:[
  /\b(?:usually|generally|normally|unless|except|however|but|not true|false|after|wait)\b/u,
  /\b(?:tomorrow|later|different day|next day|small dose|low dose|half a tablet|under supervision|with (?:a )?doctor's supervision)\b/u,
  /\b(?:is safe|are safe|can be combined|combine[ds]? safely|you can|you may|it is fine|is okay|is allowed|is acceptable|safe window|in most cases)\b/u,
 ],
 ru:[
  /(?:обычно|кроме|однако|неверно|неправда|подожд\p{L}*)/u,
  /(?:завтра|позже|другой день|следующего дня|через|под наблюдением|с разрешения|можно|разрешается|допустим|безопасно|как правило|маленьк\p{L}* доз|небольш\p{L}* доз)/u,
  /\b(?:zavtra|pozzhe|cherez|mozhno|bezopasno|dopustim\w*|pod nablyudeniem|v drugoy den)\b/u,
 ],
 hy:[
  /(?:սովորաբար|բացառությամբ|բայց|սխալ|սպաս\p{L}*|\bbayc\b|\bspas\w*)/u,
  /(?:վաղը|ավելի ուշ|այլ օր|հետո|օր անց|հսկողությամբ|թույլտվությամբ|կարելի է|կարող եք|անվտանգ է|թույլատրելի|փոքր դոզ|ցածր դոզ|հիմնականում)/u,
  /\b(?:vaghy|vaxy|aveli ush|ayl or|heto|hskoghutyamb|kareli e|karox eq|anvtang e|poqr doza)\b/u,
 ],
};
/** A narrow continuation vocabulary, rather than an open-ended medical-language parser.
 * Unknown sentences fall back to the existing safe line. These are only doctor/pharmacist
 * referrals, categorical cautions, and immediate 103 advice, with no permission to combine. */
const SAFE_CONTINUATIONS:Record<ReplyLanguage,readonly RegExp[]>={
 en:[
  /^(?:please )?(?:ask|speak to|talk to|contact|check with|consult) (?:your |a )?(?:doctor|pharmacist)(?: first| before taking either(?: medicine)?| about (?:these medicines|this combination))?$/u,
  /^(?:if (?:both were taken and you feel dizzy|you (?:feel dizzy|feel faint|have chest pain|have trouble breathing)), )?(?:please )?call 103(?: now| immediately)?$/u,
  /^this combination can cause dangerously low blood pressure$/u,
  /^do not take either(?: medicine)? until you (?:have spoken|speak) to (?:your |a )?(?:doctor|pharmacist)$/u,
  /^there is no safe window$/u,
 ],
 ru:[
  /^(?:сначала )?(?:спросите (?:своего )?(?:врача|фармацевта)|обратитесь к (?:своему )?(?:врачу|фармацевту)|(?:проконсультируйтесь|поговорите) с (?:врачом|фармацевтом))$/u,
  /^(?:если (?:уже приняли оба лекарства и кружится голова|кружится голова|теряете сознание|болит грудь|трудно дышать), )?(?:звоните|позвоните) 103(?: сейчас| немедленно)?$/u,
  /^это сочетание может опасно снизить давление$/u,
  /^не принимайте ни одно из этих лекарств до разговора с врачом$/u,
  /^безопасного интервала нет$/u,
 ],
 hy:[
  /^(?:նախ )?(?:հարցրեք|դիմեք) (?:ձեր )?(?:բժշկին|դեղագործին)$/u,
  /^խորհրդակցեք (?:ձեր )?(?:բժշկի|դեղագործի) հետ$/u,
  /^(?:եթե (?:արդեն ընդունել եք երկուսն էլ եւ գլխապտույտ ունեք|գլխապտույտ ունեք|ուշագնաց եք լինում|կրծքավանդակի ցավ ունեք|դժվար եք շնչում), )?զանգահարեք 103(?: հիմա| անմիջապես)?$/u,
  /^այս համակցությունը կարող է վտանգավոր իջեցնել ճնշումը$/u,
  /^մի ընդունեք այս դեղերից որեւէ մեկը մինչեւ բժշկի հետ խոսելը$/u,
  /^անվտանգ ընդմիջում չկա$/u,
 ],
};
const word=(source:string)=>new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`,'u');
const PDE5=word('sildenafil|sildenaphil|tadalafil|vardenafil|avanafil|viagra|cialis|levitra|spedra|stendra|pde[ -]?5(?: inhibitors?)?|силденафил\\p{L}*|тадалафил\\p{L}*|варденафил\\p{L}*|аванафил\\p{L}*|виагр\\p{L}*|сиалис\\p{L}*|левитр\\p{L}*|սիլդենաֆիլ\\p{L}*|տադալաֆիլ\\p{L}*|վարդենաֆիլ\\p{L}*|ավանաֆիլ\\p{L}*|վիագրա\\p{L}*|սիալիս\\p{L}*|լեւիտրա\\p{L}*|լեվիտրա\\p{L}*');
const NITRATE=word('nitroglycerin(?:e)?|nitroglicerin|nitroglitserin|izosorbid(?:e)?|nitro(?:[ -]?spray)?|gtn|glyceryl trinitrate|isosorbide(?: (?:mononitrate|dinitrate))?|imdur|isoket|nitrates?|nitrater|нитроглицерин\\p{L}*|имдур|изокет|нитроспрей\\p{L}*|изосорбид\\p{L}*|нитрат\\p{L}*|նիտրոգլիցերին\\p{L}*|նիտրատ\\p{L}*|իզոսորբիդ\\p{L}*');
const INTERACTION=word('together|combine|mix|interaction|gap|wait|after|hours?|days?|miasin|het|spasem|zham|or heto|вместе|совмест\\p{L}*|сочета\\p{L}*|через|подожда\\p{L}*|сутки|միասին|հետ|սպաս\\p{L}*|ժամ\\p{L}*|հետո');
export type Pde5NitrateContext={earlier:readonly string[];medicines:readonly string[]};
/** History supplies the other medicine, never the current topic. A timing/combination
 * follow-up may refer back to both; a new unrelated question may not. No urgency window changes. */
export function pde5NitrateContext(latest:string,context:Pde5NitrateContext):boolean{
 const now=normaliseText(latest),prior=normaliseText([...context.earlier,...context.medicines].join('\n'));
 const p=PDE5.test(now),n=NITRATE.test(now);
 if(p&&n)return true;
 if(p&&NITRATE.test(prior)||n&&PDE5.test(prior))return true;
 // Only an explicit reference to the pair or a direct timing follow-up carries it forward.
 return !p&&!n&&INTERACTION.test(now)&&PDE5.test(prior)&&NITRATE.test(prior)&&
  (word('them|these|both|it|их|они|это|դրանք|երկուս\\p{L}*|dranq|erku').test(now)||
   /(?:what if|and if)\s+(?:i\s+)?(?:wait|take (?:it|them) after)|(?:а если|իսկ|isk)[^.!?\n]{0,12}(?:через|միասին|սպաս|հետո|miasin|spas)/u.test(now));
}
export function guardPde5NitrateReply(reply:string,language:ReplyLanguage,relevant:boolean):string[]{
 if(!relevant)return [];
 const text=normaliseText(reply);
 // Quoted policy is not advice to the member. Removing it also prevents a sentence
 // fragment outside quotes from being stitched into an accepted warning.
 const unquoted=text.replace(/"[^"]*"|“[^”]*”|«[^»]*»|‘[^’]*’|'[^']*'|`[^`]*`/gu,' ');
 const sentences=unquoted.split(/[.!?\n]+/u).map(s=>s.trim());
 const categorical=PDE5_NITRATE_CATEGORICAL[language].map(normaliseText);
 const hasWarning=categorical.some(p=>sentences.includes(p));
 const fullSentences=text.split(/[.!?\n]+/u).map(s=>s.trim()).filter(Boolean);
 const safe=fullSentences.every(s=>categorical.includes(s)||SAFE_CONTINUATIONS[language].some(p=>p.test(s)));
 // "There is no safe window" is a categorical caution, not permission. The full
 // sentence match above prevents that negative phrase from licensing extra words.
 const permission=fullSentences.some(s=>!SAFE_CONTINUATIONS[language].some(p=>p.test(s))&&Object.values(PDE5_NITRATE_PERMISSIVE).some(list=>list.some(p=>p.test(s))));
 return hasWarning&&safe&&!permission?[]:['health.pde5_nitrate_missing_warning'];
}
