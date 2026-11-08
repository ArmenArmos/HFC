import {THRESHOLD} from '@/lib/clinical/rules/rules';
import {normaliseText} from '../normalise';
import {isNumberWord} from '../number-words';
import {notBloodPressure} from '../bp-parse';
import {SHEETS,type RedFlagId,type SymptomSheet} from './sheets';

/**
 * Deterministic symptom red flags (lead safety design 18 Oct; DRAFT, PENDING ARMEN'S SIGN-OFF).
 * They run on every member message of the window BEFORE any model call, next to the existing
 * urgent words, and on the structured record after it. A hit stops the intake and opens the
 * urgent path (103 for the member, a care-team alert). The model can add a red-flag suspicion,
 * never clear one: nothing in this file reads model output except a record value of "yes".
 *
 * Over-matching is the intended failure (a doctor looks at a false alarm; a miss is the harm).
 * One difference from the STAGING urgent list, because Zoe now ASKS these questions and members
 * answer "no weakness, no numbness": a rule is not counted when a negation stands in the same
 * clause outside the matched words ("no numbness" does not fire; "not sure if it's numbness",
 * "I can't speak" and "no fever, but my arm is numb" do). Armen decides this (QUESTIONS.md R2).
 *
 * Rules marked symptom-context fire only when the window is about a symptom (an active intake or
 * a sheet trigger), so "I'm confused about the app" is not an emergency.
 */
export const SYMPTOM_RED_FLAGS_VERSION='zoe-symptom-red-flags-draft-10';

export type RedFlagHit={id:string;rf:RedFlagId|null;source:'text'|'reading'|'answer'|'model'};
type Rule={id:string;rf:RedFlagId|null;re:RegExp;symptomContext?:boolean;negatable?:boolean;
 /** A negation inside the matched words cancels the match («դեմքս չի ուռել», "face is not swollen"; O10). */innerNegation?:boolean;
 /** Fires only when the whole message also meets this (spec v1.1 Appendix A Level 1 wording), or inside an active intake (the sheet asks it). */level1If?:(t:string)=>boolean;
 /** Not counted when this says the match is a non-emergency form (spec v1.1: nocturnal breathlessness is same day). */unless?:(t:string,start:number,end:number)=>boolean};

const r=(id:string,rf:RedFlagId|null,parts:RegExp[],opts:Omit<Rule,'id'|'rf'|'re'>={}):Rule=>({id,rf,re:new RegExp(parts.map(p=>p.source).join('|'),'gu'),negatable:true,...opts});

// Chest location and its symptom can be typed in different scripts. Every language is scanned on the
// whole text; discounted() still evaluates the matched clause, never a language-filtered fragment.
const MIXED_CHEST=[/chest/u,/груд\p{L}*/u,/(?:կրծք|կուրծք)\p{L}*/u];
const MIXED_PAIN=[/pain(?:s|ful)?|hurt(?:s|ing)?|ach(?:e|es|ing)/u,/боль|боли|болью|болей|болям|болями|болях|болит|болят|болело|болела|болели|больно/u,/ցավ(?:ը|ս|ի|ով|եր(?:ը|ի|ով)?|ում|եց|ել)?/u];
const MIXED_PRESSURE=[/pressure|tight\w*/u,/давит|давящ\p{L}*|сдавл\p{L}*/u,/սեղմ\p{L}*/u];
const mixedWord=(re:RegExp)=>`(?<![\\p{L}])(?:${re.source})(?![\\p{L}])`;
const MIXED_LOCATION=new RegExp(MIXED_CHEST.map(mixedWord).join('|'),'gu');
const MIXED_SIGN=new RegExp([...MIXED_PAIN,...MIXED_PRESSURE].map(mixedWord).join('|'),'gu');
const MIXED_CLAUSE_END=/[.!?,;։\n]|(?<![\p{L}])(?:and|but|while|и|но|а|ու|և|եւ|բայց)(?![\p{L}])/u;
// Unknown words between the pair may name another subject. Only clear connecting words qualify.
const MIXED_LINK=/^(?:in|on|my|the|a|an|i|it|is|am|are|have|has|been|feel|feels|feeling|very|really|severe|sharp|strong|now|not|sure|certain|if|whether|can'?t|cannot|bear|stand|take|в|во|у|меня|есть|очень|сильно|сейчас|не|могу|может|терпеть|вынести|выдержать|проход\p{L}*|отпуска\p{L}*|прекраща\p{L}*|утиха\p{L}*|переста\p{L}*|կա|ունեմ|իմ|ինձ|է|եմ|ա|շատ|ուժեղ|հիմա|չի|չեն|չեմ|կարողանում|դիմանալ|տանել|անցնում|թողնում|դադարում|հանգստանում|ում)$/u;
// A competing body part or subject makes the relationship uncertain. Keep the normal health path
// (including its second urgency check) rather than inventing a deterministic chest emergency.
const MIXED_OTHER=/(?<![\p{L}])(?:legs?|tooth|teeth|heads?|stomach|backs?|knees?|arms?|hands?|jaw|neck|tattoos?|he|she|they|his|her|their|н[оа]г\p{L}*|зуб\p{L}*|голов\p{L}*|живот\p{L}*|спин\p{L}*|колен\p{L}*|рук\p{L}*|ше[яиюе]|челюст\p{L}*|он|она|они|его|её|ее|их|тату\p{L}*|ոտք\p{L}*|ոտն\p{L}*|ատամ\p{L}*|գլուխ\p{L}*|գլխ\p{L}*|փոր\p{L}*|որովայն\p{L}*|մեջք\p{L}*|ծունկ\p{L}*|ծնկ\p{L}*|ձեռք\p{L}*|պարանոց\p{L}*|ծնոտ\p{L}*|նա|նրա|նրանք|նրանց)(?![\p{L}])/u;
// Only cross-script pairs: existing single-language rules retain their exact boundaries and masks.
const chestWith=(symptoms:RegExp[])=>MIXED_CHEST.flatMap((chest,i)=>symptoms.flatMap((symptom,j)=>{
 if(i===j)return [];
 const location=mixedWord(chest),sign=mixedWord(symptom),gap='[^.!?,;։\\n]{0,25}?';
 return [new RegExp(`${location}${gap}${sign}|${sign}${gap}${location}`,'u')];
}));
function mixedChestDiscounted(t:string,start:number,end:number){
 const span=t.slice(start,end);
 if(MIXED_CLAUSE_END.test(span))return true;
 const bridge=span.replace(MIXED_LOCATION,' ').replace(MIXED_SIGN,' ');
 if((bridge.match(/[\p{L}']+/gu)??[]).some(w=>!MIXED_LINK.test(w)))return true;
 // A short clause window catches a subject attached to the symptom, e.g. «chest болит нога».
 let from=Math.max(0,start-25),to=Math.min(t.length,end+25);
 for(const m of t.matchAll(new RegExp(MIXED_CLAUSE_END.source,'gu'))){
  if(m.index!<start)from=Math.max(from,m.index!+m[0].length);
  else if(m.index!>=end){to=Math.min(to,m.index!);break;}
 }
 if(MIXED_OTHER.test(t.slice(from,to))||OTHER_PERSON.test(t.slice(from,to)))return true;
 // The whole pair hides an internal denial from discounted(); inspect each symptom as well.
 for(const m of span.matchAll(MIXED_SIGN)){
  const at=start+m.index!;
  if(discounted(t,at,at+m[0].length))return true;
 }
 return false;
}

export const TEXT_RULES:readonly Rule[]=Object.freeze([
 r('chest_pain_mixed','RF-01',chestWith(MIXED_PAIN),{innerNegation:true,unless:(t,start,end)=>mixedChestDiscounted(t,start,end)||chestNotLevel1(t)}),
 r('chest_pressure_mixed','RF-01',chestWith(MIXED_PRESSURE),{innerNegation:true,unless:(t,start,end)=>mixedChestDiscounted(t,start,end)||chestPastOrStableNotNow(t)}),
 r('thunderclap',null,[/worst (headache|head ?ache|pain)|worst (ever|of my life|in my life)|thunderclap|sudden(ly)?,? (very )?(severe|terrible|explosive|excruciating) (headache|pain in my head)|like (being hit|a blow|an explosion) (in|on|to) (my|the) head/u,
  /сам\p{L}* сильн\p{L}* (головн\p{L}* )?бол\p{L}*( в (моей )?жизни)?|внезапн\p{L}* (очень )?(сильн\p{L}*|резк\p{L}*) головн/u,/կյանքում(ս)? ամենաուժեղ|կյանքիս ամենա|հանկարծակի (շատ )?ուժեղ գլխացավ/u]),
 r('weakness_numbness','RF-04',[/numb(?!er)\w*|(weak|weakness|heavy|dead) (in|on) (my )?(face|arm|leg|hand|one side|left side|right side)|(face|arm|leg|hand) (is |feels |went |has gone )?(weak|numb|heavy|dead)|(can'?t|cannot) (move|lift|feel) my|droop\w*|crooked smile|smile (is |looks |went |has gone )?((suddenly|now|all|a bit|slightly|very|really) )?(crooked|lopsided)|(mouth|face) (is |looks |went |has gone )?((suddenly|now|all|a bit|slightly|very|really) )?(crooked|lopsided)/u,
  // Facial droop and Latin-letter Armenian (Fable audit 3; lead 02:43): «улыбка кривая», «կիսադեմը թեքվել է», «dzerqs tmrel a», «demqs crvel a».
  /улыбк\p{L}* крив\p{L}*|крив\p{L}* улыбк\p{L}*|(рот|уголок рта)[^.!?,;\n]{0,15}(перекос|опуст|крив)/u,/կիսադեմ\p{L}*[^.!?,;\n]{0,15}թեքվ|ժպիտ\p{L}*[^.!?,;\n]{0,15}(ծուռ|ծռվ)|բերան\p{L}*[^.!?,;\n]{0,15}(ծռվ|կախվ)/u,
  /(?<![a-z])(tmr(el|um|ac)\w*|(demq|dem\w*|beran\w*|kisadem\w*)[^.!?,;\n]{0,15}(crv|tekv|kaxv)\w*|(dzerq|dzerk|otq|otk)\w*[^.!?,;\n]{0,15}(tulac|chi sharzhv|chi sharjv)\w*|zhpit\w* cur)/u,
  /онем\p{L}*|слабост\p{L}* в (руке|ноге|лице)|(рука|нога|лицо) (не слушается|отнял\p{L}*)|не могу (поднять|пошевелить) (руку|ногу|рукой|ногой)|перекос\p{L}*/u,/թմր(?!եցն|ադեղ|անյութ)\p{L}*|(ձեռք|ոտք|դեմք)\p{L}* (թուլ\p{L}*|չի շարժվում)|դեմքս ծռվ/u]),
 r('speech_trouble','RF-04',[/slurr\w*|(can'?t|cannot|can not) (speak|talk|get (my |the )?words out)|trouble (speaking|talking|finding (my |the )?words)|hard to (speak|talk)|speech (is |went |sounds )?(slurred|strange|weird|gone)/u,
  /не мо(гу|жет|жем|гут) говорить|реч\p{L}* (?:\p{L}+ )?(нарушен|спутан|невнятн)|невнятн\p{L}* реч|заплетается язык|трудно говорить/u,/(չեմ|չի|չենք|չեն) կարողանում խոսել|խոսել (չեմ|չի|չենք|չեն) կարողանում|խոսքս (խանգարվ|դժվար)|լեզուս կապվ/u,/(chem|chi) kar(oxanum|um) xosel|xosel (chem|chi) kar(oxanum|um)|lezus kapvel/u]),
 r('vision_loss',null,[/lost (my )?(vision|sight)|(can'?t|cannot) see|went blind|double vision|seeing double|vision (loss|went|is gone|has gone)|sudden(ly)? blurr\w* vision/u,
  /не вижу|потерял\p{L}* зрени|двоится|пропало зрение/u,/չեմ տեսնում|տեսողությունս (կորավ|հանկարծ վատացավ)|կրկնակի եմ տեսնում/u,/chem tesnum|krknaki em tesnum/u],{symptomContext:true}),
 r('confusion','RF-05',[/confus\w*|disorient\w*|(don'?t|do not) know where i am/u,/спутан\p{L}*|не понимаю,? где я|дезориент\p{L}*/u,/շփոթված|չեմ հասկանում,? որտեղ եմ/u,/shpotvac|chem haskanum,? vortex em/u],{symptomContext:true}),
 r('fever_stiff_neck',null,[/(fever|temperature|high temp)[^.!?\n]{0,80}stiff\w*( neck)?|stiff neck[^.!?\n]{0,80}(fever|temperature)/u,
  /(температур|жар)\p{L}*[^.!?\n]{0,80}(шея|шеи|шею)[^.!?\n]{0,20}(напряж|не гнется|не гнётся|скован)|(напряж|скован)\p{L}* (шеи|в шее)[^.!?\n]{0,80}(температур|жар)/u,/ջերմ\p{L}*[^.!?\n]{0,80}պարանոց\p{L}*[^.!?\n]{0,30}(կարկամ|չի թեքվում|պինդ)/u]),
 r('head_injury',null,[/(hit|banged|bumped|knocked|injured|hurt) my head|head injury|blow to (my|the) head|fell[^.!?\n]{0,30}(on|hit|banged) my head/u,/удар\p{L}* (по )?голов|травм\p{L}* голов|упал\p{L}*[^.!?\n]{0,30}голов/u,/գլուխս (խփ|հարվածեց)|գլխի (վնասվածք|հարված)/u],{symptomContext:true}),
 // Spec v1.1 Appendix A (Armen, 20 Oct): syncope is Level 1 "during exertion, without warning or with trauma"; a single typical faint
 // (S036, a teen at school) is not. A faint fires with one of those features, or a cardiac, breathing, seizure or not-recovered sign
 // (syncopeIsLevel1); a loss of consciousness or a collapse fires as before. Inside an active symptom intake (not free mode) a faint
 // still fires: the sheets ask about it as a red flag (pending Armen's review of the sheets).
 r('fainting','RF-02',[/fainted|fainting|faintness|(?<!(?:^|[^\p{L}])(?:a|the) )faint(?![\p{L}])(?! (headache|line|smell|sound|light|pain|mark|taste|memory|hope|idea|trace|ache|outline|glow))|passed out|blacked out/u,/обморок|отключил(ся|ась|ись)/u,/ուշագնաց|ուշաթափ/u,/ushatap|ushagnac|ushq(s|y|e) gnac/u],{level1If:t=>syncopeIsLevel1(t)}),
 r('fainting','RF-02',[/lost consciousness|collapsed/u,/теря\p{L}* сознани|потерял\p{L}* сознани/u,/գիտակցությունս կորցր/u]),
 r('chest_spreads','RF-01',[/chest[^.!?\n]{0,60}(arm|jaw|neck|back)\b|\b(arm|jaw)[^.!?\n]{0,40}chest/u,/груд\p{L}*[^.!?\n]{0,60}(рук|челюст|шею|шеи|спин)/u,/կրծք\p{L}*[^.!?\n]{0,60}(ձեռք|ծնոտ|պարանոց|մեջք)/u],{unless:t=>chestPastOrStableNotNow(t)}),
 r('breathless_at_rest','RF-02',[/(breathless\w*|short of breath|can'?t breathe|out of breath)[^.!?\n]{0,30}(at rest|resting|sitting still|lying down)|even (at|when|while) rest\w*/u,/одышк\p{L}* в покое|задыха\p{L}*|нечем дышать|не мо(жет|жем|гут) дышать/u,/հանգստի ժամանակ[^.!?\n]{0,20}շնչ|շնչահեղձ|(չի|չենք|չեն) կարողանում շնչել|շնչել (չի|չենք|չեն) կարողանում/u,/xexdv(um|ec)\w*|shunch(s|y) ktrv\w*|od chi (herikum|bavakanacnum)/u],{unless:nocturnalOnly}),
 // The same RF-04 signs a few words after the face or one side ("one side of my face feels strange and heavy"; AI eval
 // 19 Oct, scenario V08: a missed 103). The match is the sign word itself (the face or side is a lookbehind), so each sign
 // is negated or not on its own: "my face doesn't feel heavy" does not fire, "my face is not numb but feels heavy" and
 // "odd and heavy but not weak" do (Codex RF-F2).
 r('weakness_numbness','RF-04',[/(?<=(?:face|one side|left side|right side)[^.!?;\n]{0,30})(?<![\p{L}])(weak\w*|numb(?!er)\w*|heavy|dead)(?![\p{L}])/u,
  /(?<=(?:лиц\p{L}*|одн\p{L}* сторон\p{L}*)[^.!?;\n]{0,30})(?<![\p{L}])(онем\p{L}*|тяжел\p{L}*|тяжёл\p{L}*|слаб\p{L}*)/u,
  /(?<=(?:դեմք\p{L}*|մի կողմ\p{L}*)[^.!?;\n]{0,30})(?<![\p{L}])(ծանր\p{L}*|թուլ\p{L}*|թմր\p{L}*)/u,
  // One named arm or hand (T1 audit: "my left arm is not numb but has gone heavy"): the sign after a contrast keeps its own negation.
  // Astra #384 R3: the sign must be said of the limb ("has gone heavy", "feels weak"), not of an object ("a heavy cast", "heavy black shading").
  /(?<=(?:left|right|one) (?:arm|hand)[^.!?;\n]{0,35})(?<=(?:is|are|feels?|felt|went|gone|got|became|become|turned|now|suddenly)\s+(?:(?:very|so|really|quite|a bit)\s+)?)(weak\w*|numb(?!er)\w*|heavy|dead)(?![\p{L}])(?!\s+(?!and|but|now|too|today|suddenly|since|for|again)\p{L})/u]),
 // Hand or arm weakness as members describe it (lead 19 Oct; AI eval: Sonnet once asked instead of escalating on "my left
 // hand keeps dropping things"): dropping things, cannot grip or hold. The verb is the match (the hand or arm is a
 // lookbehind), so "my hand doesn't drop things" is negated like every other sign.
 r('weakness_numbness','RF-04',[
  // EN: the hand or arm (whole words) before or after the dropping verb; cannot grip or hold a thing (Codex #348 P1/P2).
  /(?<=(?<![\p{L}])(?:hand|hands|arm|arms)(?![\p{L}])[^.!?;\n]{0,25})(?<![\p{L}])(drop|drops|dropping|dropped)(?=\s+(things|everything|stuff|it|cups?|glasses|objects|my|the|what))|(?<![\p{L}])(drop|drops|dropping|dropped)(?=\s+(things|everything|stuff|it|cups?|glasses|objects)[^.!?;\n]{0,25}(?<![\p{L}])(hand|hands|arm|arms)(?![\p{L}]))|(?<![\p{L}])(can'?t|cannot|can not) (grip|hold) (anything|things|a cup|a glass|a spoon|a pen|objects)/u,
  // RU: «рука роняет», «роняю вещи из руки», «всё валится из рук», «не могу удержать чашку».
  /(?<=(?<![\p{L}])рук\p{L}*[^.!?;\n]{0,20})(?<![\p{L}])(роня\p{L}*|выпуска\p{L}*)|(?<![\p{L}])(роня\p{L}*|выпуска\p{L}*)(?=[^.!?;\n]{0,25}(?<![\p{L}])рук\p{L}*)|(всё|все|вещи) (валится|валятся|падает|падают|выпадает|выпадают) из рук\p{L}*|не (могу|может) (удержать|держать) (чашку|стакан|ложку|ручку|вещи|предметы|ничего)|ничего не (могу|может) (удержать|держать)/u,
  // HY: «ձեռքս ամեն ինչ գցում է», «ձեռքով չեմ կարողանում բաժակը պահել» (same clause, not a diet or a promise; Codex P2).
  /(?<=ձեռք\p{L}*[^.!?;\n]{0,25})(?<![\p{L}])(գցում|գցեց|ընկնում|բաց է թողնում)\p{L}*|(?<=ձեռք\p{L}*[^.!?,;\n]{0,30})(?<![\p{L}])(չեմ|չի) կարողանում(?![^.!?,;\n]{0,20}(դիետ|ռեժիմ|խոստում|քաշ|գաղտնիք))[^.!?,;\n]{0,20}(պահել|բռնել)|(բաժակ|գդալ|գրիչ)\p{L}* (չեմ|չի) կարողանում (պահել|բռնել)/u,
  // HY-Latn: «dzerqs gcum a»; «chi/chem/che/voch» right before the verb is a denial (Codex P2).
  /(?<=dzerq\w*[^.!?;\n]{0,25})(?<![a-z])(?<!(?:chi|chem|chen|che|voch) )(gcum|gcec|ynknum)/u]),
 r('face_lips_tongue',null,[/(lips?|tongue|throat|face)[^.!?\n]{0,20}(swell\w*|swollen|puff\w*)|(swell\w*|swollen|puff\w*)[^.!?\n]{0,20}(lips?|tongue|throat|face)/u,
  /(губ|язык|горл|лиц)\p{L}*[^.!?\n]{0,20}(отек|отёк|опух|распух)|(отек|отёк|опух|распух)\p{L}*[^.!?\n]{0,20}(губ|язык|горл|лиц)/u,/(շրթ|լեզու|կոկորդ|դեմք)\p{L}*[^.!?\n]{0,20}(այտուց|ուռ)/u],{innerNegation:true}),
]);

const CLAUSE_END=/[.!?;\n]|,| but | but,|\bно\b| բայց | bayc /gu;
// Before the matched words (EN, RU, HY). Armenian: an explicit list of negated forms, never "any word
// starting with չ" (չափազանց "extremely", չորս "four" are not negations; Fable F2).
const HY_NEG='ոչ|առանց|չունեմ|չունի|չունենք|չունեք|չկա|չկան|չի|չեն|չեմ|չենք|չեք|չէ|չէր|չէի|չեղավ|չեղել|չզգացի|չեմ զգում';
// Armenian in Latin letters (Astra V11-10: «gluxs chi cavum»).
const HYL_NEG='chi|chem|chen|chenq|cheq|chka|chkan|chunem|chuni|voch|aranc';
const NEGATION_BEFORE=new RegExp(`(?<![\\p{L}\\p{N}])(no|not|never|none|without|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|haven'?t|hasn'?t|nothing|нет|не|без|никогда|${HY_NEG}|${HYL_NEG})(?![\\p{L}\\p{N}])`,'u');
// After the matched words only the verb-final forms count: HY «թմրածություն չունեմ», RU «онемения нет».
// "without warning", "for no reason", "nothing else", «без причины» are not negations of the symptom.
// Tested on the first words after the match together, so two-word forms («не падала») count (Fable B2).
const NEGATION_AFTER=new RegExp(`^(нет|не было|не чувствую|не замечал\\p{L}*|не (?:падал|падала|падали|терял|теряла|теряли|было|чувствовал|чувствовала)|${HY_NEG.replace('ոչ|առանց|','')}|${HYL_NEG.replace('|voch|aranc','')})(?![\\p{L}\\p{N}])`,'u');
// Uncertainty is not negation: "not sure if it's numbness" still fires.
const UNCERTAIN=/not sure( if| whether)?|not certain|(don'?t|do not) know( if| whether)?|no idea|չգիտեմ|վստահ չեմ|не знаю|не уверен\p{L}*/gu;

/** The clause around [start,end): from the previous clause end to the next one. */
function clauseAround(t:string,start:number,end:number){
 let from=0,to=t.length;
 for(const m of t.matchAll(CLAUSE_END)){const i=m.index!;if(i<start)from=i+m[0].length;else if(i>=end){to=i;break;}}
 return {before:t.slice(from,start),after:t.slice(end,to)};
}
// Only a negation close to the matched words counts: the 3 words before it, the 2 after it
// (Armenian and Russian put it after: «թմրածություն չունեմ», «онемения нет»).
// "Can't bear the chest pain", «не могу терпеть боль», «չեմ կարողանում դիմանալ», «чуть не упала в обморок» intensify, never negate (Fable audit 1c).
const INTENSIFIER=/(can'?t|cannot|can not) (bear|stand|take)|не (могу|может) (терпеть|вынести|выдержать)|чуть не|(չեմ|չի) կարողանում (դիմանալ|տանել)/gu;
// A pain that "won't go away", «не проходит», «չի անցնում» is ongoing, not denied (Fable audit 1b): the persistence phrase is
// removed from the window like an intensifier, so a separate denial still counts ("No numbness and pain will not stop"; Codex AR-05).
const PERSISTS=/(won'?t|doesn'?t|does not|will not) (go away|stop|ease|pass)|не (проход|отпуска|прекраща|утиха|переста)\p{L}*|(չի|չեն) (անցնում|թողնում|դադարում|հանգստանում)/gu;
const words=(s:string)=>s.replace(UNCERTAIN,' ').replace(INTENSIFIER,' ').replace(PERSISTS,' ').split(/\s+/u).filter(Boolean);
// "Never had chest pain like this before", «никогда не было такой боли»: the superlative is about now (Fable audit 1a). It cancels
// only a never-type negation: "I do not have numbness like this", «Нет такой боли» stay denials (Codex AR-05).
const NEVER=/(?<![\p{L}])(never|никогда|երբեք)(?![\p{L}])/u;
const SUPERLATIVE_NOW=/(like this|this bad|so bad|never before|such (a|bad|strong)|такой|такую|такого|такая|այսպիսի|այսպես)/u;
const LIST_CONJ=/^(ու|կամ|եւ|or|and|nor|или|и|ни)$/u;
const BARE_NO=/^\s*(no|nope|none|not really|нет|ոչ|չէ|voch)(?![\p{L}])/u;
// The second item of a denied list in the same clause: "I do not have a headache or chest pain", «нет ни головной боли, ни боли в груди»,
// «ոչ գլխացավ, ոչ կրծքի ցավ» (Astra V11-10). Only "or"-type lists: "no fever and chest pain" may assert the pain; never across "but".
const DENIED_LIST=new RegExp(`(?<![\\p{L}'])(?:no|not|don'?t have|do not have|without|нет|без|ни|ոչ|առանց|chi|voch)(?![\\p{L}'])(?:\\s+(?!but|но|а|բայց|իսկ)\\p{L}+){1,4}[\\s,]+(?:or|nor|или|ни|կամ|ոչ)\\s+(?:\\p{L}+\\s+)?$`,'u');
const negated=(t:string,start:number,end:number)=>{
 const {before,after}=clauseAround(t,start,end);
 if(DENIED_LIST.test((t.slice(Math.max(0,start-60),start).split(/[.!?;\n]/u).at(-1)??'').replace(UNCERTAIN,' ')))return true;
 // "I never had numbness before but now I do": the negation is about the past; now it is present.
 if(/^[^.!?\n]{0,40}(but now|but today|но сейчас|но теперь|բայց հիմա|իսկ հիմա)/u.test(t.slice(end)))return false;
 // The superlative cancels only never-type negations ("never", «никогда не»): "never had pain like this and I do not have
 // numbness" keeps the numbness denial (Codex AR-05 follow-up).
 {const w=words(before).slice(-3),all=words(before);const negIdx=w.map((x,i)=>NEGATION_BEFORE.test(x)?i:-1).filter(i=>i>=0);
  const off=all.length-w.length;
  const neverType=(i:number)=>NEVER.test(w[i]!)||NEVER.test(all[off+i-1]??'');
  if(NEVER.test(all.slice(-5).join(' '))&&SUPERLATIVE_NOW.test(`${before.slice(-40)}${after.slice(0,40)}`)&&negIdx.every(neverType))return false;}
 if(words(before).slice(-3).some(w=>NEGATION_BEFORE.test(w)))return true;
 {const w=words(after).slice(0,3);for(let i=0;i<w.length&&i<2;i++)if(NEGATION_AFTER.test(w.slice(i).join(' ')))return true;}
 // The first item of a denied pair: «կրծքի ցավ կամ շնչահեղձություն չունեմ», «боли или одышки нет», "chest pain or breathlessness, none" (R026, R032).
 {const w=words(after).slice(0,4);if(w.length>=3&&LIST_CONJ.test(w[0]!)&&(NEGATION_AFTER.test(w.slice(2).join(' '))||(w.length>=4&&NEGATION_AFTER.test(w.slice(3).join(' ')))))return true;}
 // A question answered at once: "Numbness? No, none."
 const rest=t.slice(end);const q=/^[^.!?\n]{0,20}\?/u.exec(rest);
 return !!q&&BARE_NO.test(rest.slice(q[0].length));
};

// History (lead 18 Oct, QA S03/N01-N03: "my mother had a stroke last year", "heart pain last year, fine now"
// opened the 103 screen). A mention is discounted when it is negated or its clause is about the past and says
// nothing about now. A present marker ("now", «сейчас», «հիմա») keeps it; someone else's current emergency counts.
const PAST=/(?<![\p{L}])(last (?:year|month|week|summer|winter|time)|in the (?:last|past) (?:month|year|few months)|over the (?:last|past) (?:month|year)|years? ago|months? ago|weeks? ago|in (?:19|20)\d\d|when i was (?:a child|a kid|young|little|\d+)|used to|once had|had (?:a |an )?\p{L}+ (?:before|once|years ago)|fine now|better now|ok(?:ay)? now|gone now|в прошлом году|в прошлом месяце|на прошлой неделе|за последний месяц|за последний год|год назад|лет назад|месяц назад|раньше|в детстве|когда-то|сейчас всё хорошо|сейчас нормально|անցյալ տարի|անցյալ ամիս|տարվա առաջ|տարի առաջ\p{L}*|(?:19|20)\d\d(?:-ին| թ| թվականին)|в (?:19|20)\d\d|ancac tari|ancyal tari|anc(?:y|)al amis|tari araj|amis araj|անցած ամիս|անցյալ շաբաթ|վերջին ամսում|վերջին մեկ ամսում|վերջին տարում|տարի առաջ|տարիներ առաջ|ամիս առաջ|նախկինում|ժամանակին|հիմա լավ եմ|հիմա ամեն ինչ լավ է)(?![\p{L}])/u;
// Only a complete future-stroke question without any other assertion gets this exception.
export const futureStrokeQuestion=(raw:string)=>/[?՞]/u.test(raw)&&/^(?:will i (?:have|get) (?:a )?stroke|(?:а )?(?:у меня )?инсульт будет|(?:а )?будет ли у меня инсульт|ինսուլտ (?:կլինի|կունենամ)|insult (?:klini|em unenalu))\s*\??[.։]?$/u.test(normaliseText(raw));
// A fear or a "what if" about the future is not the event now (QA round 2 E01: "what if I get a stroke like my father").
const HYPOTHETICAL=/(?<![\p{L}])(what if|if i (?:get|have|had|ever)|in case i|afraid (?:of|that i|i'?ll|i will)|scared (?:of|that i|i'?ll)|worried (?:about|that i|i'?ll|i will)|fear (?:of|that)|could i (?:get|have)|а (?:что )?если|вдруг у меня|боюсь,? что|боюсь (?:получить|инсульта|инфаркта)|если у меня будет|իսկ եթե|եթե ինձ մոտ|վախենում եմ,? որ|վախենում եմ ինսուլտ|վախենում եմ ինֆարկտ)(?![\p{L}])/u;
// Family history and education (Fable audit 14), scoped to the mention itself so a current symptom in the same sentence
// still counts (Codex AR-01): "died of a ___" right before it, "when she was 80" right after it, and question forms
// ("what are the signs of a ___?", "does BP cause ___?", «как снизить риск ___?») only in a sentence that asks.
const HISTORY_BEFORE=/(died of|passed away from|умер\p{L}* от|умерла от|մահացել է)\s+(a |an |от )?$/u;
const HISTORY_AFTER=/^\s*(when (he|she) was (\d+|young|little|a child|a kid))(?![\p{L}])/u;
const QUESTION_BEFORE=/(signs of|symptoms of|risk of|cause|causes|prevent|признаки|симптомы|риск|опасен|ախտանիշներ\p{L}*|ռիսկ\p{L}*)\s+(a |an |getting |having )?$/u;
/** The sentence around [start,end). */
const sentenceOf=(t:string,start:number,end:number)=>t.slice(Math.max(0,...[...t.slice(0,start).matchAll(/[.!?;։\n]/gu)].map(m=>m.index!+1)),end)+(/^[^.!?;։\n]*/u.exec(t.slice(end))?.[0]??'');
const NOW=/(?<![\p{L}])(now|right now|today|currently|at the moment|сейчас|сегодня|прямо сейчас|հիմա|այսօր|հենց հիմա)(?![\p{L}])/u;
// Reading or education about the topic (C1 audit: "Reading your chest pain leaflet, I do not have any symptoms", «Читаю памятку про
// боль в груди», «Ինսուլտի կանխարգելման մասին հոդվածը», "stroke prevention advice"): an education word right next to the mention.
const EDU_AFTER=/^[^.!?,;\n]{0,12}(?<![\p{L}])(?:leaflet|article|brochure|booklet|prevention|preventing|awareness|education|профилактик\p{L}*|памятк\p{L}*|стать\p{L}*|брошюр\p{L}*|կանխարգել\p{L}*|մասին (?:ձեր |այդ |այս )?(?:հոդված|տեղեկատվ|նյութ)\p{L}*|հոդված\p{L}*|masin (?:dzer )?hodvac\w*|hodvac\w*|kanxargel\w*)(?![\p{L}])/u;
const EDU_BEFORE=/(?<![\p{L}])(?:leaflet|article|brochure|booklet|reading about|read about|prevention of|preventing|памятк\p{L}* (?:про|о|об)|стать\p{L}* (?:про|о|об)|читаю (?:про|о|об)|профилактик\p{L}*|брошюр\p{L}* (?:про|о|об))(?![\p{L}])[^.!?,;\n]{0,12}$/u;
// "I have chest pain as the leaflet describes" is a current symptom (Astra #384 R1): a first-person assertion in the clause wins.
const ASSERTS_NOW=/(?<![\p{L}'])(?:i have|i've got|i've|i am having|i'm having|i feel|i got|у меня|меня беспокоит|ունեմ|ունի|unem|uni)(?![\p{L}'])/u;
const education=(t:string,start:number,end:number)=>{const {before,after}=clauseAround(t,start,end);
 if(ASSERTS_NOW.test(`${before}${t.slice(start,end)}${after}`.replace(/(?<![\p{L}])(?:not|no|don'?t|do not|нет|не|չ)\s*\p{L}*/gu,' ')))return false;
 return EDU_AFTER.test(t.slice(end,end+60))||EDU_BEFORE.test(t.slice(Math.max(0,start-45),start));};
/** The mention at [start,end) is denied (negation only; an onset date is not a denial: "heart failure since last year"). */
export const denied=(t:string,start:number,end:number)=>negated(t,start,end);
/** The mention at [start,end) does not describe the member now: negated, about the past, or about someone else. */
export function discounted(t:string,start:number,end:number){
 // "I never had numbness before but now I do": about now, whatever came before.
 if(/^[^.!?\n]{0,40}(but now|but today|но сейчас|но теперь|բայց հիմա|իսկ հիմա)/u.test(t.slice(end)))return false;
 if(negated(t,start,end))return true;
 const {before,after}=clauseAround(t,start,end);const clause=`${before}${t.slice(start,end)}${after}`;
 if(/\b(fine|better|ok(?:ay)?|gone) now\b|сейчас (?:всё )?(?:хорошо|нормально)|հիմա (?:լավ|ամեն ինչ լավ)/u.test(clause))return true;
 if(NOW.test(clause))return false;
 if(education(t,start,end))return true;
 // Someone else's CURRENT emergency still escalates (call 103 for them); only their or the member's history
 // is discounted, and only when the member says nothing about themself now in the clause.
 // The "what if" may stand earlier in the sentence: «Боюсь, что будет инсульт».
 const sentence=t.slice(Math.max(0,...[...t.slice(0,start).matchAll(/[.!?\n]/gu)].map(m=>m.index!+1)),start);
 const asks=/^[^.!\n]*\?/u.test(t.slice(end));
 return PAST.test(clause)||HYPOTHETICAL.test(`${sentence} ${clause}`)||HISTORY_BEFORE.test(t.slice(Math.max(0,start-30),start))||HISTORY_AFTER.test(t.slice(end))
  ||(asks&&QUESTION_BEFORE.test(t.slice(Math.max(0,start-30),start)));
}
/** The member's quote, found in their message, is negated or not about them now (a "yes" from such a quote is refused). */
export function quoteDiscounted(message:string,quote:string){
 const t=normaliseText(message).replaceAll('’',"'"),q=normaliseText(quote).replaceAll('’',"'");
 if(!q)return false;
 // Every occurrence counts: one current mention stands even after a past or negated one ("Last year I would
 // struggle to get air. Today I struggle to get air."; Codex F2, 18 Oct).
 let found=false;
 for(let i=t.indexOf(q);i>=0;i=t.indexOf(q,i+1)){found=true;if(!discounted(t,i,i+q.length))return false;}
 return found;
}

const BP_TEXT=/(?<![\d.\/-])(\d{2,3})\s*(?:\/|\\|over|на|-ի|-i|-|ի(?=\s)|i(?=\s))\s*(\d{2,3})(?![\d]|[.\/-]\d)/gu;
// Blood pressure as members write it (Fable audit 5): «ճնշումս 18-ի 11 ա», «185-ի 115», "180 120", «chnshums 18i 11», and a
// single systolic («Ճնշումս 200 ա», «верхнее 190», "systolic 195"). The forms without a separator, the two-digit shorthand
// (×10) and a lone systolic count only next to a blood-pressure word.
const BP_WORD=/(ճնշ\p{L}*|chnsh\w*|давлен\p{L}*|(?<![\p{L}])bp(?![\p{L}])|blood pressure|pressure|վերին\p{L}*|верхн\p{L}*|systolic|top number|tonometer|տոնոմետր\p{L}*|тонометр\p{L}*)/u;
const BP_SPACE=/(?<![\d.\/-]|\d\s)(\d{2,3})\s+(\d{2,3})(?![\d]|[.\/-]\d|\s+\d)/gu;
// A lone systolic: the blood-pressure word right before it ("BP 200", «Ճնշումս 200», «верхнее 190», "systolic 195"), not a price, date or phone.
const BP_LONE=/(?:ճնշ\p{L}*|chnsh\w*|давлен\p{L}*|(?<![\p{L}])bp|blood pressure|վերին\p{L}*|верхн\p{L}*|systolic|top number)(?:\s+(?:is|was|of|at|=|:|-|до|около|էր|է|ա))?\s*(\d{3})(?![\d]|[.\/-]\d|\s*(?:\$|dollars?|steps?|people|years?|руб|долл|դրամ|քայլ))/gu;
const nearBpWord=(t:string,i:number,end:number)=>BP_WORD.test(t.slice(Math.max(0,i-25),Math.min(t.length,end+25)));
/** Blood pressure readings in a plausible range; a lone systolic has diastolic 0. */
export function bpPairs(text:string):{systolic:number;diastolic:number}[]{
 const t=normaliseText(text);
 const out:{systolic:number;diastolic:number}[]=[];const used:[number,number][]=[];
 const add=(m:RegExpMatchArray,needsWord:boolean)=>{
  let s=Number(m[1]),d=Number(m[2]);const i=m.index!,end=i+m[0].length;
  const near=nearBpWord(t,i,end);
  if(needsWord&&!near)return;
  // A lab value, dose or phone number labelled as such is not a reading (T1 audit: "My phone number is 190/80; I have a headache").
  if(notBloodPressure(t,i,end))return;
  // "18 over 11" in a blood-pressure sentence is 180/110.
  if(near&&s>=10&&s<=30&&d>=5&&d<=20){s*=10;d*=10;}
  if(s>=70&&s<=300&&d>=30&&d<=200&&s>d){out.push({systolic:s,diastolic:d});used.push([i,end]);}
 };
 for(const m of t.matchAll(BP_TEXT))add(m,false);
 for(const m of t.matchAll(BP_SPACE))if(!used.some(([a,b])=>m.index!<b&&m.index!+m[0].length>a))add(m,true);
 for(const m of t.matchAll(BP_LONE)){const i=m.index!,end=i+m[0].length,n=Number(m[1]);
  if(n>=180&&n<=300&&!used.some(([a,b])=>i<b&&end>a))out.push({systolic:n,diastolic:0});}
 return out;
}
/** The clinical algorithm's crisis range (THRESHOLD, rules.ts). */
export const inCrisis=(p:{systolic:number;diastolic:number})=>p.systolic>=THRESHOLD.crisisSystolic||p.diastolic>=THRESHOLD.crisisDiastolic;

export const symptomMentioned=(texts:readonly string[],sheets:readonly SymptomSheet[]=SHEETS)=>texts.some(x=>{const t=normaliseText(x);return sheets.some(s=>s.trigger.test(t));});

export type LatestReading={systolic:number;diastolic:number;minutesAgo:number;entrySource?:string|null}|null;
export const recentCrisisReading=(reading:LatestReading|undefined)=>!!reading&&reading.minutesAgo>=0&&reading.minutesAgo<=24*60&&inCrisis(reading);
/**
 * Text and reading red flags over member texts. symptomContext: an intake is active, or a
 * symptom is mentioned in these texts. A stored reading counts when it is from the last 24 hours.
 */
export function textRedFlags(texts:readonly string[],opts:{intakeActive:boolean;latestReading?:LatestReading;
 /** In an alarm conversation or after the now-question, the open intake alone is not a new current symptom. */
 storedReadingNeedsText?:boolean;
 /** The messages Zoe has not answered yet (the newest included), for the stored-reading rule; absent: the newest message only. */
 readingContextTexts?:readonly string[];
 /** Every message of the window for the symptom context (answered ones too: "I have a headache" then "I feel confused"; Astra);
  *  absent: the matched texts. Triggers are matched only in `texts`. */
 symptomContextTexts?:readonly string[]}):RedFlagHit[]{
 const context=opts.intakeActive||symptomMentioned(opts.symptomContextTexts??texts);
 const hits=new Map<string,RedFlagHit>();
 for(const raw of texts){
  if(futureStrokeQuestion(raw))continue;
  const t=normaliseText(raw).replaceAll('’',"'");
  for(const rule of TEXT_RULES){
   if(rule.symptomContext&&!context)continue;
   if(rule.level1If&&!opts.intakeActive&&!rule.level1If(t))continue;
   for(const m of t.matchAll(rule.re)){
    if(rule.negatable&&discounted(t,m.index!,m.index!+m[0].length)&&!(rule.id==='fainting'&&urgentFaintMention(t,m.index!,m.index!+m[0].length)))continue;
    if(rule.innerNegation&&gapNegated(m[0]))continue;
    if(rule.unless?.(t,m.index!,m.index!+m[0].length))continue;
    hits.set(rule.id,{id:rule.id,rf:rule.rf,source:'text'});break;
   }
  }
  // A crisis reading WITH a symptom is RF-03 (never negated: a number is a number). The symptom must be asserted: a reading of
  // 186/122 with "no headache, no chest pain" is same day (spec v1.1 Level 2, S005), not 103 (R005).
  if((opts.intakeActive||symptomAsserted(raw))&&bpPairs(raw).some(inCrisis))hits.set('bp_crisis',{id:'bp_crisis',rf:'RF-03',source:'text'});
 }
 const reading=opts.latestReading;
 // Window is measured_at in [now-24h, now]: a future-dated reading (negative minutesAgo) never counts.
 // The symptom must be asserted in a message Zoe has not answered yet (or an intake is open): a symptom she already answered
 // must not turn every later message, such as a lab question («Hba1c 7 է, ինչ անեմ», Armen 20 Oct 22:24), into a 103, while
 // "severe headache" then "what do I do?" before any answer keeps it (Astra #377 F1). A crisis reading without such a symptom is
 // the same-day floor (health-answer.ts sameDayFloor), not 103.
 const ctxTexts=opts.readingContextTexts??texts.slice(-1);
 const readingContext=(!opts.storedReadingNeedsText&&opts.intakeActive)||ctxTexts.some(x=>symptomAsserted(x));
 if(readingContext&&recentCrisisReading(reading))hits.set('bp_crisis_reading',{id:'bp_crisis_reading',rf:'RF-03',source:'reading'});
 return [...hits.values()];
}

// -------------------------------------------------------------------------------------------------
// Level 1 context (spec v1.1 Appendix A, Armen's sign-off 20 Oct 2026; ARMEN_WORDING.md §4). Shared with the urgent list
// (urgent-staging.ts). Each helper narrows a trigger only where v1.1 names the case as not Level 1; a Level 1 feature anywhere
// in the message keeps the 103.

const NEG_WORD=new RegExp(`(?<![\\p{L}\\p{N}'])(no|not|never|without|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|wasn'?t|haven'?t|hasn'?t|нет|не|без|ни|${HY_NEG}|${HYL_NEG})(?![\\p{L}\\p{N}'])`,'u');
/** A negation between matched words ("chest is not hurting", «դեմքս չի ուռել»); persistence, intensifiers and uncertainty are not negations. */
export const gapNegated=(gap:string)=>NEG_WORD.test(gap.replace(UNCERTAIN,' ').replace(INTENSIFIER,' ').replace(PERSISTS,' '));

/** Some occurrence of re in t that is not negated, past or someone else's history. */
export function asserted(t:string,re:RegExp){
 for(const m of t.matchAll(new RegExp(re.source,'gu'))){
  // The whole word, and the next word when it is not a negation («կրծքիս ցավ չկա»: the denial follows "ցավ", not "կրծք").
  let end=m.index!+m[0].length;end+=/^\p{L}*/u.exec(t.slice(end))![0].length;
  const next=/^\s+(\p{L}+)/u.exec(t.slice(end));if(next&&!NEGATION_BEFORE.test(next[1]!)&&!NEGATION_AFTER.test(next[1]!))end+=next[0].length;
  if(!discounted(t,m.index!,end))return true;
 }
 return false;
}
/** A symptom (any symptom sheet's trigger) that is asserted, not only mentioned ("no headache" does not count). */
export function symptomAsserted(raw:string,sheets:readonly SymptomSheet[]=SHEETS){
 const t=normaliseText(raw).replaceAll('’',"'");
 return sheets.some(s=>asserted(t,s.trigger));
}

// Syncope Level 1 features: exertion, no warning, trauma, a cardiac or breathing sign, a seizure, pregnancy, lying down, not recovered.
const SYNCOPE_EXERTION=new RegExp([
 /exercis\w*|work(?:ing)? ?out|training|when i run|running|jogging|sprint\w*|swimming|swim|cycling|biking|riding (?:a |my )?bike|dancing|hiking|lifting|carrying|playing|sport\w*|gym|football|basketball|tennis|on the stairs|climbing|during (?:a |the )?(?:run|game|match|race|pe|class|exertion)|after (?:a |my )?run(?:ning)?|exertion|effort/u.source,
 /մարզ\p{L}*|վազ\p{L}*|լող\p{L}*|հեծանիվ\p{L}*|պար\p{L}*|խաղալիս|ծանր\p{L}* (?:բարձրաց|տանել)\p{L}*|ֆիզկուլտ\p{L}*|ֆուտբոլ\p{L}*|սանդուղք\p{L}*|ծանրաբեռնվածու\p{L}*|marz\w*|vazel\w*|vazum\w*|loxal\w*|loxum\w*|hecaniv\w*/u.source,
 /тренир\p{L}*|бег\p{L}*|бежал\p{L}*|плыл\p{L}*|плава\p{L}*|велосипед\p{L}*|танц\p{L}*|поднимал\p{L}*|нес\p{L}* тяж\p{L}*|игра\p{L}*|спорт\p{L}*|физкульт\p{L}*|нагрузк\p{L}*|футбол\p{L}*|по лестниц\p{L}*/u.source,
].join('|'),'u');
const SYNCOPE_L1=new RegExp([SYNCOPE_EXERTION.source,
 /without (?:any )?warning|no warning|out of nowhere|suddenly|all of a sudden|внезапно|без предупреждения|вдруг|ни с того ни с сего|հանկարծ\p{L}*|առանց նախազգուշ\p{L}*|hankarc\w*/u.source,
 /hit (?:his |her |my |their )?head|banged|injur\w*|hurt (?:himself|herself|myself|themselves)|bleed\w*|broke|fell (?:down the stairs|on (?:his|her|my) (?:head|face))|ударил\p{L}*|травм\p{L}*|разбил\p{L}*|кров\p{L}*|ушиб\p{L}*|խփ\p{L}*|վնասվ\p{L}*|կոտր\p{L}*|արյուն\p{L}*|xpel|xpec/u.source,
 /heart|palpitat\w*|chest|pounding|racing|сердц\p{L}*|груд\p{L}*|сердцебиен\p{L}*|սիրտ\p{L}*|սրտ(?!խ|աբան)\p{L}*|կրծք\p{L}*|krck\w*|krtsk\w*|sirt\w*/u.source,
 /short of breath|breathless\w*|can'?t breathe|одышк\p{L}*|задыха\p{L}*|не хватает воздуха|շնչահեղձ\p{L}*|շունչ\p{L}*|շնչ\p{L}*/u.source,
 /shaking|convuls\w*|jerk\w*|seizure|судорог\p{L}*|дергал\p{L}*|ցնց\p{L}*|cnc\w*/u.source,
 /pregnan\w*|беремен\p{L}*|հղի/u.source,
 /lying down|while lying|лежа|лёжа|պառկած/u.source,
 /(?:not|isn'?t|hasn'?t|won'?t|didn'?t) (?:waking|woken|wake|responding|come round|coming round|breathing)|still (?:unconscious|out|not awake)|unresponsive|не приходит в себя|не просыпается|не реагирует|не дышит|ուշքի չի գալիս|չի արթնանում|չի արձագանքում|չի շնչում/u.source,
].join('|'),'u');
/** The message describes a faint with a v1.1 Level 1 feature (or a sign that is an emergency in itself). */
// A habit is not the event ("She plays tennis"; Astra V11-11): habitual activity phrases are removed before the features are looked for.
const HABIT=/(?<![\p{L}])(?:plays?|does|goes to|go to|likes?|loves?|enjoys?|practi[cs]es?|is into|used to|занимается|ходит на|ходит в|играет в|любит|հաճախում է|զբաղվում է|խաղում է|սիրում է)\s+\p{L}+/gu;
export const syncopeIsLevel1=(t:string)=>asserted(t.replace(HABIT,m=>' '.repeat(m.length)),SYNCOPE_L1)||episodeAsserted(t.replace(HABIT,m=>' '.repeat(m.length)),SYNCOPE_EXERTION)||olderFaint(t);
// Armen, 2 Nov: "I feel fine now" and a recent date do not lower a faint on exertion. Only these two discounts: "years ago", "used to",
// "last year", someone else's faint or an education question stay as discounted() and PAST leave them (Fable F3).
const FAINT_FINE_OR_RECENT=/(?<![\p{L}])(?:(?:fine|better|ok(?:ay)?|gone) now|сейчас (?:вс[её] )?(?:хорошо|нормально)|հիմա (?:լավ(?: եմ)?|ամեն ինչ լավ(?: է)?)|hima lav(?: em)?|yesterday|last week|(?:\d+|a|one|two|three|a few|few) weeks? ago|last month|(?:a|one) month ago|вчера|на прошлой неделе|(?:\d+ )?недел\p{L}* назад|в прошлом месяце|месяц назад|երեկ|անցյալ շաբաթ|անցած շաբաթ|անցյալ ամիս|անցած ամիս|շաբաթ առաջ|erek|anc(?:ac|yal) (?:shabat|amis))(?![\p{L}])/gu;
const FAINT_LONG_AGO=/(?<![\p{L}])(?:as an? (?:kid|child|teen\p{L}*)|в юности|մանկ\p{L}*)(?![\p{L}])/u;
/** An exertional or older-person faint of the member's own stays urgent even when it was recent and they feel fine now. */
export function urgentFaintMention(t:string,start:number,end:number){
 const s=sentenceOf(t,start,end),own=!OTHER_PERSON.test(s)&&s.search(ELDER_AT)<0&&!THIRD.test(s);
 if(!own||!(episodeAsserted(s.replace(HABIT,m=>' '.repeat(m.length)),SYNCOPE_EXERTION)||olderFaint(t)))return false;
 const u=t.replace(FAINT_FINE_OR_RECENT,m=>' '.repeat(m.length));
 return !PAST.test(sentenceOf(u,start,end))&&!FAINT_LONG_AGO.test(s)&&!discounted(u,start,end);
}

// P52 (Armen 20 Oct 19:54): fainting in an older person (65 or over) is Level 1 by itself. The age or older-person word must
// belong to the person who fainted (Astra #377 F2): in the faint's own sentence, the age or person nearest the faint word, never a
// possessive ("my grandmother's pills"). Ages with or without a unit ("I am 65", «Ես 70 եմ», «Мне 70»; F3). The member's profile
// age is not read here.
const FAINT_AT=/fainted|fainting|faint(?![\p{L}])|passed out|blacked out|lost consciousness|collapsed|обморок\p{L}*|потерял\p{L}* сознание|отключил\p{L}*|ուշագնաց\p{L}*|ուշաթափ\p{L}*|ushatap\w*|ushagnac\w*/gu;
const AGE_AT=[
 /(?<![\p{N}.,/])(\d{1,3})[\s-]*(?:years?(?:[\s-]*old)?|y\.?o\.?|year-old|տարեկան\p{L}*|tarekan\w*|лет|год\p{L}*)(?![\p{L}])/gu,
 /(?<![\p{L}])(?:i am|i'm|he is|he's|she is|she's|is|was|aged|age|мне|ему|ей|отцу|маме|папе|мужу|жене)\s+(\d{1,3})(?![\p{N}]|[.,]\d|[/:])/gu,
 /(?<![\p{N}.,/])(\d{1,3})\s+(?:եմ|ես|է|էր|em|e|a)(?![\p{L}])/gu,
];
const ELDER_AT=/elderly|old (?:man|woman|lady)|grand(?:ma|pa|mother|father|mom|dad)(?!'s|s')\p{L}*|пожил\p{L}*|бабушк(?!ин)\p{L}*|дедушк(?!ин)\p{L}*|տարեց\p{L}*|ծեր\p{L}*|տատիկ\p{L}*|պապիկ\p{L}*|տատս|պապս|tatik\w*|papik\w*/gu;
const OTHER_PERSON=/(?<![\p{L}])(?:grand(?:son|daughter|child)\p{L}*|внук\p{L}*|внуч\p{L}*|թոռ\p{L}*|son|daughter|mother|mom|mum|father|dad|husband|wife|brother|sister|friend|neighbou?r|child|baby|boy|girl|сын\p{L}*|доч\p{L}*|мам\p{L}*|пап\p{L}*|муж\p{L}*|жен\p{L}*|брат\p{L}*|сестр\p{L}*|ребен\p{L}*|ребён\p{L}*|друг\p{L}*|сосед\p{L}*|որդի\p{L}*|աղջիկ\p{L}*|մայր\p{L}*|հայր\p{L}*|ամուսին\p{L}*|կին\p{L}*|եղբայր\p{L}*|քույր\p{L}*|երեխա\p{L}*|ընկեր\p{L}*|հարևան\p{L}*)(?![\p{L}])/u;
const FIRST=/(?<![\p{L}])(?:i|i'm|я|ես|es)(?![\p{L}])|(?<![\p{L}])\p{L}+ա(?=[\s։.!]|$)(?<!եղավ)/u;
const THIRD=/(?<![\p{L}])(?:he|she|он|она|նա|na)(?![\p{L}])|եղավ|ուշաթափվեց(?![\p{L}])|ushagnac exav/u;
/** Whose faint: 'first' (I), 'third' (he or she), or null (a named other person, or unclear). */
function faintSubject(sentence:string):'first'|'third'|null{
 if(OTHER_PERSON.test(sentence))return null;
 if(THIRD.test(sentence)&&!/(?<![\p{L}])(?:i|я|ես)(?![\p{L}])/u.test(sentence))return 'third';
 return FIRST.test(sentence)?'first':null;
}
/** Whose age a mention is: 'first' ("I am 70", «Мне 70», «Ես 70 եմ»), 'third' (another person or an older-person word), or null. */
function personOf(sentence:string,at:number):'first'|'third'|null{
 const before=sentence.slice(Math.max(0,at-20),at),after=sentence.slice(at,at+30);
 if(/(?:i am|i'm|мне|ես|es)\s*$/u.test(before)||/^\d+\s*(?:տարեկան\s*)?(?:եմ|em)(?![\p{L}])/u.test(after))return 'first';
 return 'third';
}
// Who fainted (Astra N1-1, 22 Oct): "I fainted" (the last pronoun just before the faint word, or an Armenian first-person verb after it)
// counts only the member's own stated age, never an older relative named nearby ("My grandmother helped me after I fainted").
const SUBJ_AT=/(?<![\p{L}])(i|i'm|i've|я|ես|es|he|she|он|она|նա|na)(?![\p{L}])/gu;
function faintPronoun(sentence:string,f:number):'first'|'third'|null{
 const p=[...sentence.slice(Math.max(0,f-20),f).matchAll(SUBJ_AT)].at(-1)?.[1];
 if(p)return ['i',"i'm","i've",'я','ես','es'].includes(p)?'first':'third';
 return /^\p{L}+\s+(?:եղա|եմ|em)(?![\p{L}])|^\p{L}*վեցի(?![\p{L}])/u.test(sentence.slice(f))?'first':null;
}
// An age said of someone else: right before a relative or older-person word ("70-year-old father", «20-летний сын»), or right after one,
// a third-person pronoun or a dative ("my father is 80", «Отцу 80», «Հայրս 80», "he is 80").
const REL_SRC=`${OTHER_PERSON.source}|${ELDER_AT.source}`;
// Up to two describing words may sit between ("70-year-old frail mother", «пожилая больная мама», «70 տարեկան հիվանդ մայրը»; Astra N1-1).
const AGE_UNIT='^\\d{1,3}[\\s-]*(?:years?[\\s-]*old|year-old|y\\.?o\\.?|-?летн\\p{L}*|лет|տարեկան\\p{L}*)?(?:[\\s-]+\\p{L}+){0,2}?[\\s-]*';
const AGE_BEFORE_REL=new RegExp(`${AGE_UNIT}(?:${REL_SRC})`,'u');
/** The age or older-person word at 'from' describes the person named at 'to' ("80-year-old father", not "80-year-old father helped when my son"). */
const describes=(sentence:string,from:number,to:number,age:boolean)=>(age?new RegExp(`${AGE_UNIT}$`,'u'):/^\p{L}+(?:[\s-]+\p{L}+){0,2}[\s-]+$/u).test(sentence.slice(from,to));
const REL_BEFORE_AGE=new RegExp(`(?:${REL_SRC}|(?<![\\p{L}])(?:he|she|он|она|նա|na|ему|ей|отцу|маме|папе|мужу|жене)(?![\\p{L}]))[^.,;!?\\d]{0,12}$`,'u');
const othersAge=(sentence:string,at:number)=>AGE_BEFORE_REL.test(sentence.slice(at))||REL_BEFORE_AGE.test(sentence.slice(Math.max(0,at-24),at));
export function olderFaint(t:string):boolean{
 // Each age at its number, once ("is 80 years old" matches two forms); each older-person word; each other named person (no age).
 const people=(sentence:string)=>{const ages=new Map<number,boolean>();
  for(const re of AGE_AT)for(const m of sentence.matchAll(re))ages.set(m.index!+m[0].indexOf(m[1]!),Number(m[1])>=65&&Number(m[1])<=120);
  return [...[...ages].map(([at,old])=>({at,old,kind:'age'as const})),...[...sentence.matchAll(ELDER_AT)].map(m=>({at:m.index!,old:true,kind:'elder'as const})),
   ...[...sentence.matchAll(new RegExp(OTHER_PERSON.source,'gu'))].map(m=>({at:m.index!,old:false,kind:'person'as const}))];};
 const sentences=t.split(/(?<=[.!?;։])\s+|\n+/u);
 for(let i=0;i<sentences.length;i++){
  const sentence=sentences[i]!,prevS=i>0?sentences[i-1]!:'';
  const faints=[...sentence.matchAll(FAINT_AT)].map(m=>m.index!);
  if(!faints.length)continue;
  const own=people(sentence),prev=people(prevS);
  for(const f of faints){
   const pronoun=faintPronoun(sentence,f);
   if(pronoun==='first'){
    // "I fainted" (Astra N1-1): any age 65+ in this sentence or the one before that is not said of someone else ("At 70, I fainted",
    // «Ես 70 եմ»); an older relative named nearby never counts ("My grandmother helped me after I fainted").
    if(own.some(p=>p.kind==='age'&&p.old&&!othersAge(sentence,p.at))||prev.some(p=>p.kind==='age'&&p.old&&!othersAge(prevS,p.at)))return true;
    continue;
   }
   // The fainting person is the nearest mention before the faint ("My 72-year-old father fainted", "Бабушка упала в обморок"); a named
   // relative takes the age or older-person word right before them ("Пожилой сосед"), else an age said after the faint ("my son fainted,
   // he is 20"), never a bystander's (Astra N1-1).
   const after=own.filter(p=>p.at>f&&p.kind==='age'&&!AGE_BEFORE_REL.test(sentence.slice(p.at))).sort((x,y)=>x.at-y.at)[0];
   const subj=own.filter(p=>p.at<f).sort((x,y)=>y.at-x.at)[0];
   if(subj&&subj.kind!=='person'){if(subj.old)return true;continue;}
   if(subj){
    const adj=own.filter(p=>p.kind!=='person'&&p.at<subj.at&&describes(sentence,p.at,subj.at,p.kind==='age')).sort((x,y)=>y.at-x.at)[0];
    if((adj??after)?.old)return true;
    continue;
   }
   // "My father is 80 years old. He fainted." (Astra #377 F2 round 3): with no one named before the faint, the sentence before, when
   // every age or older-person word it has is the same older person and the faint's subject is that person; else an age after the faint.
   const named=prev.filter(p=>p.kind!=='person'),who=new Set(named.map(p=>personOf(prevS,p.at)));
   if(named.length>0&&named.every(p=>p.old)&&who.size===1&&[...who][0]===(pronoun??faintSubject(sentence)))return true;
   if(after?.old)return true;
  }
 }
 return false;
}

// Nocturnal breathlessness (S042: waking at night short of breath, more pillows) is same day in v1.1; breathlessness at rest,
// right now, or with frothy sputum or blue lips stays Level 1.
const NIGHT_WAKE=/(?:wake|wakes|woke|waking) up[^.!?\n]{0,40}(?:at night|in the night)|(?:at night|in the night)[^.!?\n]{0,40}(?:wake|wakes|woke|waking)|(?:wake|wakes|woke|waking) (?:up )?(?:short of breath|breathless|gasping|from)|просыпа\p{L}*|будит|արթնան\p{L}*|արթնաց\p{L}*|artnan\w*|zartnum\w*/u;
// Breathless at rest, right now, still, suddenly, or with frothy sputum or blue lips keeps the 103 (Astra V11-02); asserted, so
// "not breathless at rest" does not count.
const ACUTE_BREATH=/at rest|resting|sitting still|right now|(?:short of breath|breathless|gasping|struggling to breathe|can'?t breathe) (?:even |still |right )?now|still (?:short of breath|breathless|can'?t breathe|struggling|gasping)|now (?:i am |i'm )?(?:short of breath|breathless|gasping|struggling)|even (?:when|while) (?:awake|sitting)|sudden\w*|can'?t breathe|cannot breathe|в покое|прямо сейчас|сейчас (?:задыха|не могу дышать|одышк)\p{L}*|до сих пор|вдруг|внезапн\p{L}*|не могу дышать|нечем дышать|հանգստի ժամանակ|հանգիստ վիճակ|հենց հիմա|հիմա էլ|դեռ (?:շնչահեղձ|շունչս)\p{L}*|հանկարծ\p{L}*|չեմ կարողանում շնչել|hima el|hankarc\w*|blue|pink|froth\w*|розов\p{L}*|пен\p{L}*|синие|синеют|կապտ\p{L}*|վարդագույն|փրփուր/u;
export function nocturnalOnly(t:string,start:number,end:number){
 const {before,after}=clauseAround(t,start,end);
 const sentence=t.slice(Math.max(0,...[...t.slice(0,start).matchAll(/[.!?\n]/gu)].map(m=>m.index!+1)),start)+t.slice(start,end)+(/^[^.!?\n]*/u.exec(t.slice(end))?.[0]??'');
 return NIGHT_WAKE.test(`${before}${t.slice(start,end)}${after} ${sentence}`)&&!asserted(t,ACUTE_BREATH);
}

// Chest pain that is reproducible on pressing or movement, or present for days, with no Level 1 feature in the message
// (ARMEN_WORDING §4 item 3; dataset S028: doctor within days). Severe, pressing, spreading, exertional, sudden pain, or pain
// with sweating, nausea, breathlessness, dizziness, palpitations or diabetes stays 103.
const CHEST_REPRODUCIBLE=/press(?:ing)? on|when (?:i )?(?:press|push|touch|move|turn|twist|lift|bend)|if (?:i )?(?:press|push|touch|move|turn|twist)|on (?:touch|pressing|movement)|to the touch|tender|position|при (?:надавлив|нажати|движени|поворот)\p{L}*|надавлива\p{L}*|нажима\p{L}*|когда (?:двига|поворач|наклоня)\p{L}*|меняю положение|սեղմելիս|երբ սեղմում|սեղմում եմ|շարժվելիս|շրջվելիս|թեքվելիս|դիրքը փոխ\p{L}*|դիրքից|sexmelis|sexmum em|erb sexm\w*|sharjvelis|shrjvelis/u;
const CHEST_DAYS=/(?:for|since|past|last|over) (?:the )?(?:\d+|two|three|four|five|six|seven|several|a few|few) days|for (?:a|one|two|\d+) weeks?|(?:\d+|two|three|four|five|six|seven|several) days|(?:\d+|երկու|երեք|չորս|հինգ|վեց|յոթ|մի քանի) օր|(?:\d+|մեկ|մի|երկու) շաբաթ|(?:\d+|два|три|четыре|пять|шесть|семь|несколько) (?:дн\p{L}*|сут\p{L}*)|(?:неделю|две недели|\d+ недел\p{L}*)/u;
// Severity, here so the urgent words and the not-now exception read one list.
const CHEST_SEVERE=/crush\w*|severe|strong|terrible|unbearable|worst|excruciating|intense|very bad|сильн\p{L}*|невыносим\p{L}*|ужасн\p{L}*|остр\p{L}*|ուժեղ\p{L}*|անտանելի|սաստիկ\p{L}*|սուր|ujex\w*|uzhex\w*|sastik\w*|antaneli|shat cav\w*/u;
const CHEST_L1=new RegExp([
 /arm|jaw|neck|back|shoulder|radiat\w*|spread\w*|рук\p{L}*|челюст\p{L}*|ше[яиюе]|спин\p{L}*|лопат\p{L}*|плеч\p{L}*|отда[её]т|թև\p{L}*|ձեռք\p{L}*|ծնոտ\p{L}*|պարանոց\p{L}*|վիզ\p{L}*|մեջք\p{L}*|ուս\p{L}*|տալիս է/u.source,
 /sweat\w*|clammy|пот\p{L}*|потею|потл\p{L}*|քրտն\p{L}*/u.source,
 /breath\w*|дыш\p{L}*|одышк\p{L}*|задых\p{L}*|воздух\p{L}*|շունչ\p{L}*|շնչ\p{L}*/u.source,
 /nause\w*|vomit\w*|тошн\p{L}*|рвот\p{L}*|սրտխառն\p{L}*|փսխ\p{L}*/u.source,
 /pressure|squeez\w*|heavy|heaviness|tight\w*|burn\w*|давит|давящ\p{L}*|сжима\p{L}*|сдавл\p{L}*|жж\p{L}*|тяжест\p{L}*|ճնշ\p{L}*|սեղմող|սեղմում է|ծանր\p{L}*|այր\p{L}*/u.source,
 CHEST_SEVERE.source,
 /stairs|walking|exercis\w*|exertion|climb\w*|лестниц\p{L}*|ходьб\p{L}*|нагрузк\p{L}*|սանդուղք\p{L}*|քայլ\p{L}*|ֆիզիկական|մարզ\p{L}*/u.source,
 /sudden\w*|вдруг|внезапн\p{L}*|հանկարծ\p{L}*/u.source,
 /dizz\w*|faint\w*|головокруж\p{L}*|обмор\p{L}*|գլխապտույտ\p{L}*|գլուխս պտտ\p{L}*|ուշագն\p{L}*|ուշաթափ\p{L}*/u.source,
 /palpitat\w*|racing|сердцебиен\p{L}*|սրտխփոց\p{L}*/u.source,
 /diabet\w*|диабет\p{L}*|շաքարային|insulin|инсулин\p{L}*|ինսուլին\p{L}*/u.source,
 /getting worse|worsening|усилива\p{L}*|ուժեղանում|ուժեղացել|սաստկանում|ujexanum|ujexacel/u.source,
 /qrtn\w*|shunch\w*|srtxarn\w*|pxs\w*/u.source,
].join('|'),'u');
/** Chest pain that v1.1 does not put at Level 1: reproducible or present for days, and no Level 1 feature asserted. */
const CHEST_WORD=/chest|heart|груд\p{L}*|сердц\p{L}*|կրծք\p{L}*|սիրտ\p{L}*|սրտ\p{L}*|krck\w*|krtsk\w*|krtsq\w*|krcq\w*|kurck\w*|sirt\w*|srt\w*/u;
// The duration or reproducibility must be said of the chest pain, in the same sentence (Astra V11-04: "My chest has been hurting
// for twenty minutes. My cold started three days ago").
// Chest pain lasting minutes or hours is Level 1 (v1.1: "more than a few minutes"), said in the chest sentence ("My appointment is in
// twenty minutes" is not; Astra V11-11).
const CHEST_MINUTES=/minutes?|hours?|минут\p{L}*|час\p{L}*|րոպե\p{L}*|ժամ(?!անակ)\p{L}*|rope\w*|jam(?:ic|a)?(?![\p{L}])/u;
// Unlike asserted(), a past association still belongs to the episodes: "sweating last week" is not a denial.
const episodeAsserted=(t:string,re:RegExp)=>[...t.matchAll(new RegExp(re.source,'gu'))].some(m=>!denied(t,m.index!,m.index!+m[0].length));
// General recovery phrases are deliberately loose: below they must belong to the chest sentence.
const CHEST_NOT_NOW=/(?<![\p{L}])(?:not (?:happening )?(?:right )?now|(?:no (?:chest )?pain|nothing) (?:right )?now|everything is fine now|now everything is fine|(?:now )?(?:my |the )?(?:chest pain|chest|pain) is (?:gone|fine)(?: now)?|(?:now (?:i'm|i am|i feel) (?:fine|ok|okay|good|well|normal|better)|(?:i'm|i am|i feel) (?:fine|ok|okay|good|well|normal|better) now)|(?:now )?(?:it is|it's) (?:gone(?: now)?|all good)|it (?:passed|went away|is over)|went away|all good now|doesn't hurt now|no longer hurts|(?:прямо )?сейчас (?:нет(?: боли)?|не болит|не беспокоит|ничего не беспокоит|вс[её] (?:хорошо|в порядке)|нормально|прошла|прошло)|уже не болит|հիմա (?:(?:ցավ(?:ը)? )?(?:չկա|չի ցավում)|ոչինչ (?:չկա|չի ցավում)|ամեն ինչ (?:լավ|կարգին|նորմալ) է|(?:լավ|կարգին|նորմալ) եմ(?: զգում)?|արդեն անցել է)|(?:արդեն )?անցել է|hima (?:(?:cav(?:y)? )?(?:chka|chi (?:cavum|tsavum))|vochinch (?:chka|chi cavum)|amen inch (?:lav|kargin|normal) (?:e|a)|(?:lav|kargin|normal) em(?: zgum)?|arden ancel e)|(?:arden )?ancel e)(?![\p{L}])/gu;
// A calendar day in the past can establish a settled episode; hours/minutes and last night cannot.
const CHEST_PAST_DAY=/(?<![\p{L}\p{N}])(?:the day before yesterday|yesterday|(?:[1-9]\d*|one|two|three|four|five|six|seven|a few|few|several) days? ago|last (?:week|month)|позавчера|вчера|(?:[1-9]\d*|один|два|три|несколько|пару) (?:день|дня|дней) назад|(?:на )?прошл\p{L}* (?:недел\p{L}*|месяц\p{L}*)|նախանցյալ օրը|երեկ|(?:[1-9]\d*|մեկ|երկու|երեք|մի քանի) օր առաջ|անցյալ (?:շաբաթ|ամիս)|erek|nakhancyal ory|(?:[1-9]\d*|mek|erku|ereq|mi qani) or araj|anc(?:ac|yal) (?:shabat|amis))(?![\p{L}\p{N}])/gu;
const CHEST_PATTERN=/(?<![\p{L}])(?:for (?:the )?(?:\d+|a|one|two|three|six|several) (?:weeks?|months?|years?)|(?:once|twice|\d+ times) a (?:week|month|year)|(?:in the )?last (?:week|month|year)|(?:уже |в течение )?(?:\d+|два|две|шесть) (?:недел\p{L}*|месяц\p{L}*|год\p{L}*|лет)|(?:на )?прошл\p{L}* (?:недел\p{L}*|месяц\p{L}*|год\p{L}*)|(?:\d+|մեկ|երկու|վեց) (?:շաբաթ|ամիս|տարի)|անցյալ (?:շաբաթ|ամիս|տարի)|(?:\d+|mek|erku|vec) (?:shabat|amis|tari)|anc(?:ac|yal) (?:shabat|amis|tari))(?![\p{L}])/u;
const CHEST_REST_RELIEF=/(?:goes? away|stops?|eases?|resolves?|relie[fv]e\w*|settles?) (?:with|after|on|when i) rest\w*|проход\p{L}* (?:в покое|после отдыха)|հանգստանալիս անցնում|հանգստից հետո անցնում|hangstanal(?:uc|is) ancnum/u;
const CHEST_ABSENCE_UNCERTAIN=new RegExp(`${UNCERTAIN.source}|(?:do not|don't) believe|не верю|չեմ հավատում|(?:can'?t|cannot|can not|unable to|couldn'?t) (?:say|confirm|tell|claim)|не (?:могу|может) (?:сказать|подтвердить)|(չեմ|չի) կարող(?:անում)? (?:ասել|հաստատել)|(?:chem|chi) kar(?:ox|um|oxanum) (?:asel|hastatel)`,'u');
const CHEST_RECENT=/(?<![\p{L}])(?:now|currently|still (?:hurts|pain|hurting|having (?:chest )?pain)|today|yesterday|last night|this (?:morning|evening|afternoon)|tonight|(?:an?|one|\d+|a few|few|several) (?:minutes?|hours?) ago|сейчас|сегодня|сегодняшн\p{L}*|вчера|утром|ночью|вечером|сегодня ночью|(?:час|минут\p{L}*) назад|հիմա|այսօր|այս առավոտ|այս գիշեր|երեկ(?:ոյան|վա)?|գիշերը|րոպե առաջ|ժամ առաջ|hima|aysor|ays aravot|ays gisher|erek(?:oyan|va)?|gishery?|rope araj|jam araj)(?![\p{L}])/u;
const CHEST_AT_REST=/at rest|while rest\w*|when (?:i am |i'm )?rest\w*|woke me|wakes? me|at night|in bed|lying down|sitting|в покое|разбуди\p{L}*|будит|в постели|лёжа|лежа|сидя|հանգստի ժամանակ|հանգիստ վիճակում|արթնաց\p{L}*|անկողն\p{L}*|պառկած\p{L}*|նստած\p{L}*|hangsti zhamanak|artnac\w*|ankoxn\w*|parkac\w*|nstac\w*/u;
const CHEST_ASSOCIATION=/(?<![\p{L}])(?:спин\p{L}*|поясниц\p{L}*|ше[яиюе]|лопат\p{L}*|плеч\p{L}*|отда[её]т|մեջք\p{L}*|պարանոց\p{L}*|վիզ\p{L}*|ուս\p{L}*|տարածվ\p{L}*|mejq\w*|paranoc\w*|arms?|jaw|neck|back|shoulder|radiat\w*|spread\w*|sweat\w*|clammy|breath\w*|short of breath|out of breath|vomit\w*|nause\w*|faint\w*|passed out|blacked out|рук\p{L}*|челюст\p{L}*|пот\p{L}*|одыш\p{L}*|задых\p{L}*|рвот\p{L}*|тошн\p{L}*|обмор\p{L}*|ձեռք\p{L}*|թև\p{L}*|ծնոտ\p{L}*|քրտն\p{L}*|շնչ\p{L}*|շունչ\p{L}*|փսխ\p{L}*|սրտխառն\p{L}*|ուշագնաց\p{L}*|ուշաթափ\p{L}*|dzerq\w*|dznot\w*|qrtn\w*|shunch\w*|shnch\w*|pxs\w*|srtxarn\w*|ushagnac\w*|ushatap\w*|dizz\w*|palpitat\w*|pounding|racing|головокруж\p{L}*|кружит\p{L}*|сердцебиен\p{L}*|колотит\p{L}*|գլխապտույտ\p{L}*|պտտվ\p{L}*|սրտխփոց\p{L}*|glxaptuyt\w*|srtxpoc\w*)(?![\p{L}])/u;
// Any asserted long episode blocks the exception. Short 2–3 min or ~5 min episodes do not.
const CHEST_LONG_EPISODE=/(?<![\p{L}\p{N}])(?:(?:>|more than|over|longer than|более|больше|ավելի քան)\s*(?:15|fifteen)\s*(?:min\w*|мин\p{L}*|րոպե|rope)|half an hour|полчаса|կես ժամ|kes jam|all night|всю ночь|ամբողջ գիշեր)(?![\p{L}])/u;
// Only recognize explicitly short minute episodes; an unparsed duration keeps today's urgent behaviour.
// This also protects long durations written out in HY/RU without a general number-word parser.
const CHEST_EPISODE_MINUTE='min(?:ute)?s?|мин(?:ут\\p{L}*)?|րոպե\\p{L}*|rope\\w*';
const SHORT_MINUTES='(?:[1-9]|1[0-5]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|одну|одна|один|две|два|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|մեկ|մի|երկու|երեք|չորս|հինգ|վեց|յոթ|ութ|ինը|տասը|տաս|տասնմեկ|տասներկու|տասներեք|տասնչորս|տասնհինգ|mek|mi|erku|ereq|chors|hing|vec|yot|ut|iny|tas|tasnmek|tasnerku|tasnereq|tasnchors|tasnhing)';
const SETTLED_CHEST_WORDS=new Set(normaliseText('i am had have has a an the once twice chest pain sting stinging twinge tightness pressure discomfort ache last month week year ago years months weeks days day stairs for times time about some now it is was gone fine ok okay well all everything better at moment right my '
 +'у меня был была было боль боли в груди колол колет покалывание один раз раза месяц месяца назад неделю недели год года прошлом прошлый прошлую сейчас всё все хорошо уже мой '
 +'անցյալ ամիս շաբաթ տարի մի անգամ երկու երեք կրծքավանդակում կրծքավանդակի կրծքիս կրծքում ծակոց ցավ ունեցել եմ ունեի հիմա ամեն ինչ լավ է չկա արդեն առաջ '
 +'ancyal amis shabat tari mi angam krckavandakum krcqis krcq cav caqoc unecel em hima amen inch lav e chka '
 +'yesterday before two three four five six seven few couple of minute minutes second seconds short briefly lasted hurting on way to work felt feel hurt hurts stung sharp in but nothing passed and over good normal it\'s i\'m went away '
 +'вчера позавчера прошлой несколько пару минуты минут минуту секунд секунды секунду две два три четыре пять болела болело грудь на неделе кольнуло дня прошла прошло ничего беспокоит нормально порядке '
 +'երեկ նախանցյալ օրը քանի մեկ րոպե վայրկյան կրծքավանդակիս կրծքավանդակս ցավեց ցավում ունեցա ծակեց մեջ ոչինչ անցել կարգին նորմալ '
 +'erek nakhancyal ory qani mek rope krtsqi krtsqis uneca unem ancel kargin normal').split(/\s+/u));
// Only a reading and the words that introduce it: no symptom word can hide in it.
const BP_READING_SENTENCE=/^(?:(?:my |the |today'?s? |now |just |it |is |was |are |reading |measured |bp |blood pressure |pressure |мо[её] |мой |давление |ад |сегодня |сейчас |только что |измерил\p{L}* |ճնշումս |արյան ճնշում |ճնշում |իմ |հիմա |այսօր |է |էր |)+\d{2,3}\s*(?:\/|over|на|-)\s*\d{2,3}(?:\s*(?:mmhg|мм рт\.? ст\.?|մմ))?[.!?։]*)$/iu;
/** The shared closed vocabulary for past chest evidence and the after-alert gate. */
const isSettledChestWord=(word:string)=>SETTLED_CHEST_WORDS.has(word);
// Only chest-specific absence can stand alone by default. A personal recovery sentence has the narrow short/past-day rule below.
const CHEST_NOT_NOW_LOOSE=/^(?!(?:not |no chest pain|сейчас (?:нет|не болит|не беспокоит)|հիմա (?:(?:ցավ(?:ը)? )?(?:չկա|չի ցավում))|hima (?:(?:cav(?:y)? )?(?:chka|chi (?:cavum|tsavum)))))/u;
const CHEST_SHORT_EPISODE=new RegExp(`(?<![\\p{L}\\p{N}.,–-])(?:${SHORT_MINUTES}(?:\\s*[-–]\\s*${SHORT_MINUTES})?|a|a few|a couple of|few|несколько|пару|մի քանի|mi qani)\\s*(?:${CHEST_EPISODE_MINUTE})(?![\\p{L}])|(?<![\\p{L}])(?:(?<!\\d\\s*)минуту|минуты? (?:две|три|четыре|пять))(?![\\p{L}])`,'gu');
const CHEST_SECONDS='seconds?|секунд\\p{L}*|վայրկյան\\p{L}*|vayrkyan';
const CHEST_SHORT_SECONDS=new RegExp(`(?<![\\p{L}\\p{N}.,–-])(?:[1-9]|[1-5]\\d|one|two|three|a|a few|a couple of|few|несколько|пару|одну|две|три|մի քանի|մեկ|երկու|երեք)\\s*(?:${CHEST_SECONDS})(?![\\p{L}])`,'gu');
const CHEST_BRIEF=/(?<![\p{L}])(?:briefly|кратковременно|ненадолго|կարճատև|կարճատեւ)(?![\p{L}])/u;
const hasShortChestDuration=(t:string)=>!!t.match(CHEST_SHORT_EPISODE)||!!t.match(CHEST_SHORT_SECONDS)||CHEST_BRIEF.test(t);
const CHEST_DURATION_UNIT=new RegExp(`(?<![\\p{L}])(?:${CHEST_EPISODE_MINUTE}|${CHEST_SECONDS}|hours?|час\\p{L}*|ժամ|jam)(?![\\p{L}])`,'u');
// A short suffix must not erase an unparsed compound/range/sum ("twenty five", "15 + 15").
const COMPOUND_MINUTES='twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|plus|to|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|плюс|до|քսան|երեսուն|քառասուն|հիսուն|վաթսուն|յոթանասուն|ութսուն|իննսուն|հարյուր|գումարած|qsan|eresun';
const CHEST_COMPLEX_DURATION=new RegExp(`(?<![\\p{L}])(?:${COMPOUND_MINUTES})[ -]+(?:${SHORT_MINUTES}|\\d+)\\s*(?:${CHEST_EPISODE_MINUTE}|${CHEST_SECONDS})(?![\\p{L}])|\\d+\\s*[+×*/]\\s*\\d+\\s*(?:${CHEST_EPISODE_MINUTE}|${CHEST_SECONDS})`,'u');
// A lower bound does not establish a short episode, even when its number/phrase is short.
const CHEST_DURATION_LOWER_BOUND=new RegExp(`(?:>|more than|over|longer than|at least|более|больше|не менее|ավելի քան|առնվազն)\\s*(?:${SHORT_MINUTES}|a few|a couple of|нескольких|несколько|մի քանի)\\s*(?:${CHEST_EPISODE_MINUTE}|${CHEST_SECONDS})(?![\\p{L}])`,'u');
const CHEST_PRESENT_COMPLAINT=/(?<![\p{L}])(?:(?:i )?(?:have|has|feel|feels|having) \p{L}+|i (?:hurt|am (?:ill|sick|weak|unwell|numb))|hurts|aches|(?<!was |were )(?:hurting|aching)|is (?:tight|pressing)|болит|болят|давит|жж[её]т|сдавливает|сжимает|ցավում է|ցավում եմ|սեղմում է|այրում է|cavum (?:e|em)|sexmum e)(?![\p{L}])/u;
// Unfinished qualifications cannot establish recovery, even without a repeated symptom noun.
const CHEST_RECOVERY_CONTRADICTION=/(?<![\p{L}])(?:still|except|yet|ещ[её]|кроме|но|դեռ|բացի|բայց|der|bayc)(?![\p{L}])/u;
// Only an entire adjacent sentence about the member's recovery may settle the previous episode.
const PERSONAL_CHEST_RECOVERY=/^(?:(?:now )?(?:i'm|i am|i feel) (?:fine|ok|okay|good|well|normal|better)(?: now)?|сейчас (?:вс[её] (?:хорошо|в порядке)|нормально)|հիմա (?:(?:լավ|կարգին|նորմալ) եմ|ամեն ինչ (?:լավ|կարգին|նորմալ) է)|hima (?:(?:lav|kargin|normal) em|amen inch (?:lav|kargin|normal) e))$/u;
// Split conjunctions as well as punctuation: duration and recovery cannot borrow another activity's clause.
const chestClauses=(t:string)=>t.split(/[,，.!?;։\n]+|(?<![\p{L}])(?:and|but|и|а|но|եւ|ու|բայց)(?![\p{L}])/u).map(c=>c.trim()).filter(Boolean);
const chestTokens=(t:string)=>t.match(/[\p{L}\p{N}']+/gu)??[];
const DURATION_FRAME=new Set(normaliseText('for about it lasted lasts was a of в течение длилась длилось տեւել տևել է մոտ').split(/\s+/u));
const RECOVERY_SUBJECT=new Set(normaliseText("now it my the pain chest heart i am is was уже боль боли грудь груди сейчас я в порядке ցավ ցավը կրծքիս կրծքում կրծքավանդակում հիմա").split(/\s+/u));
// A recognized short suffix cannot consume just the end of a compound number.
const unparsedChestDuration=(t:string)=>t.split(/[.!?;։\n]+/u).some(sn=>{
 if(!CHEST_DURATION_UNIT.test(sn))return false;
 const rest=sn.replace(CHEST_PAST_DAY,' ').replace(new RegExp(CHEST_PATTERN.source,'gu'),' ')
  .replace(/один раз|մի անգամ|mi angam/gu,' ').replace(CHEST_SHORT_EPISODE,' ').replace(CHEST_SHORT_SECONDS,' ');
 return chestTokens(rest).some(w=>/\p{N}/u.test(w)||isNumberWord(w));
});
/** Only fully consumed short durations add vocabulary; stray number words still fail closed. */
export const hasSettledChestVocabulary=(raw:string)=>{
 const rest=normaliseText(raw).replaceAll('’',"'").replace(CHEST_NOT_NOW,'gone').replace(CHEST_PAST_DAY,' ')
  .replace(CHEST_SHORT_EPISODE,' ').replace(CHEST_SHORT_SECONDS,' ').replace(CHEST_BRIEF,' ');
 return chestTokens(rest).every(w=>isSettledChestWord(w)||/^\d+$/u.test(w));
};
// Recurring reports need the same recovery and duration binding as calendar-day episodes.
// Their established exertion/rest clauses remain allowed; they cannot lend recovery to a different subject.
const boundChestEvidence=(t:string,pastDay:boolean)=>{
 if(pastDay&&!hasSettledChestVocabulary(t))return false;
 const clauses=chestClauses(t);
 return clauses.every((clause,i)=>{
  const chest=CHEST_WORD.test(clause),recovery=[...clause.matchAll(CHEST_NOT_NOW)].length>0,short=hasShortChestDuration(clause);
  if(pastDay&&!chest&&!recovery&&!short)return false;
  if(short&&!chest){
   if(pastDay&&!CHEST_WORD.test(clauses[i-1]??''))return false;
   const rest=clause.replace(CHEST_SHORT_EPISODE,' ').replace(CHEST_SHORT_SECONDS,' ').replace(CHEST_BRIEF,' ');
   if(chestTokens(rest).some(w=>!DURATION_FRAME.has(w)))return false;
  }
  if(recovery){
   const rest=clause.replace(CHEST_NOT_NOW,' ');
   if(!chest&&chestTokens(rest).some(w=>!RECOVERY_SUBJECT.has(w)))return false;
   // Even a clause containing "chest" cannot attribute recovery to another body part or person.
   if(chest&&!hasSettledChestVocabulary(rest.replace(CHEST_PATTERN,' ').replace(CHEST_REST_RELIEF,' ')
    .replace(SYNCOPE_EXERTION,' ').replace(/(?<![\p{L}])(?:stairs|on|when|i|run|with|rest|при|по|հանգստանալիս)(?![\p{L}])/gu,' ')))return false;
  }
  return true;
 });
};
/** Armen, 2 Nov: a past/recurring chest pattern explicitly absent now, without acute or associated danger signs. */
export function chestPastOrStableNotNow(raw:string):boolean{
 const t=normaliseText(raw).replaceAll('’',"'");
 const absences=[...t.matchAll(CHEST_NOT_NOW)];
 if(!CHEST_WORD.test(t)||!absences.length||unparsedChestDuration(t))return false;
 // A sentence that only states a blood pressure reading ("My BP is 170/115.") is neither chest evidence nor a second subject:
 // the BP step takes it (bp-chat.ts) and every symptom guard below still reads the whole message.
 const chestEvidence=t.split(/(?<=[.!?;։])\s+|\n+/u).filter(sn=>!BP_READING_SENTENCE.test(sn)).join(' ');
 if(!boundChestEvidence(chestEvidence,chestEvidence.split(/[.!?;։\n]+/u).some(sn=>CHEST_WORD.test(sn)&&sn.match(CHEST_PAST_DAY))))return false;
 // The absence itself must be asserted, never quoted as false or denied ("no pain now is not true").
 if(absences.some(m=>denied(t,m.index!,m.index!+m[0].length)||/^\s*(?:is|was)\s+(?:not (?:true|correct)|false|wrong|a lie)/u.test(t.slice(m.index!+m[0].length))))return false;
 // "No pain now." right after a chest sentence is about the chest; "nothing now" needs the chest word in its own sentence.
 if(absences.some(m=>{
  if(!CHEST_NOT_NOW_LOOSE.test(m[0])||CHEST_WORD.test(sentenceOf(t,m.index!,m.index!+m[0].length)))return false;
  const previous=t.slice(0,m.index!).split(/[.!?;։\n]+/u).filter(x=>x.trim()).at(-1)??'';
  if(/^no pain/u.test(m[0])&&CHEST_WORD.test(previous))return false;
  // Only an immediately adjacent, standalone personal recovery can complete an explicitly short past-day episode.
  const current=sentenceOf(t,m.index!,m.index!+m[0].length).trim();
  return !(current===m[0]&&PERSONAL_CHEST_RECOVERY.test(m[0])&&CHEST_WORD.test(previous)&&previous.match(CHEST_PAST_DAY)&&hasShortChestDuration(previous));
 }))return false;
 // A past-day recovery cannot leave an unclassified qualification after its final absence phrase.
 // Pattern reports retain the existing separate "no pain at rest" sentence path.
 if(t.match(CHEST_PAST_DAY)&&!CHEST_PATTERN.test(t)){
  const last=absences.at(-1)!;
  if(!/^[\s.!?;։]*$/u.test(t.slice(last.index!+last[0].length)))return false;
  if(/(?:более|больше|не менее)\s*минуту/u.test(t))return false;
 }
 const rest=t.replace(CHEST_NOT_NOW,' ');
 // Uncertainty never establishes that pain is absent now. Do not let a past/fine-now clause hide danger signs.
 if(CHEST_ABSENCE_UNCERTAIN.test(t))return false;
 if(CHEST_PRESENT_COMPLAINT.test(rest)||CHEST_RECOVERY_CONTRADICTION.test(rest)||CHEST_DURATION_LOWER_BOUND.test(rest)||CHEST_DURATION_UNIT.test(rest)&&CHEST_COMPLEX_DURATION.test(rest)||NOW.test(rest)||CHEST_RECENT.test(rest.replace(CHEST_PAST_DAY,' '))||episodeAsserted(rest.replace(new RegExp(CHEST_REST_RELIEF.source,'gu'),' '),CHEST_AT_REST)||episodeAsserted(rest,CHEST_LONG_EPISODE)||episodeAsserted(rest.replace(CHEST_SHORT_EPISODE,' ').replace(CHEST_SHORT_SECONDS,' '),CHEST_DURATION_UNIT)||episodeAsserted(rest,CHEST_ASSOCIATION)||episodeAsserted(rest,CHEST_SEVERE))return false;
 const chestSentences=t.split(/[.!?;։\n]+/u).filter(sn=>CHEST_WORD.test(sn));
 // A separate present-tense chest complaint cannot borrow the earlier absence or chronic context.
 if(chestSentences.some(sn=>!CHEST_PATTERN.test(sn)&&!sn.match(CHEST_PAST_DAY)&&!SYNCOPE_EXERTION.test(sn)&&![...sn.matchAll(CHEST_NOT_NOW)].length))return false;
 // Calendar-day episodes require explicit short duration in their own chest sentence.
 if(chestSentences.some(sn=>sn.match(CHEST_PAST_DAY)&&!CHEST_PATTERN.test(sn)&&!hasShortChestDuration(sn)))return false;
 return chestSentences.some(sn=>CHEST_PATTERN.test(sn)||sn.match(CHEST_PAST_DAY))||(episodeAsserted(rest,SYNCOPE_EXERTION)&&CHEST_REST_RELIEF.test(rest));
}
/** For accounting for an adjacent recovery sentence in the closed alert gate. */
export const isChestRecoverySentence=(raw:string)=>normaliseText(raw).replaceAll('’',"'").replace(CHEST_NOT_NOW,' ').replace(/[.!?;։]/gu,' ').trim()==='';
/** The alert gate must reject these words even when negated or asked as a question. */
const CHEST_DANGER_WORD=new RegExp(`^(?:${CHEST_WORD.source}|${CHEST_ASSOCIATION.source}|${CHEST_SEVERE.source})$`,'u');
export const mentionsChestDangerWord=(word:string)=>CHEST_DANGER_WORD.test(word);
/** A heart test's result, the next step of a chest matter whatever the gap (LDL or a blood count alone is not). */
export const chestResults=(raw:string)=>/(?<![\p{L}])(?:ecg|ekg|экг|էսգ|էկգ|holter|холтер|հոլտեր|troponin|тропонин|stress test)(?![\p{L}])/u.test(normaliseText(raw));
export const chestNotLevel1=(t:string)=>{if(chestPastOrStableNotNow(t))return true;
 // A calendar date is not evidence of pain persisting for days. It needs the settled-episode rule above.
 if(t.match(CHEST_PAST_DAY)&&!CHEST_PATTERN.test(t))return false;
 const sns=t.split(/(?<=[.!?;])\s+|\n+/u).filter(sn=>CHEST_WORD.test(sn));
 return sns.some(sn=>CHEST_REPRODUCIBLE.test(sn)||CHEST_DAYS.test(sn))&&!sns.some(sn=>CHEST_MINUTES.test(sn))&&!asserted(t,CHEST_L1);};
// A heart attack in the past (S019 a brother's at 48; S026 "did I have a heart attack without knowing?") is history, not now.
// Past tense alone is not enough ("My father had a heart attack and is lying on the floor"; Astra V11-01): the sentence must place
// it at an age, a date or a time ago, call it history, say the person died or survived, or ask whether it happened unnoticed.
const INFARCT_PAST=/(?<![\p{L}])(at (?:the age of )?\d{2}|aged \d{2}|when (?:he|she|i) was|(?:\d+|a|one|two|few|several) (?:years?|months?) ago|last (?:year|month)|in (?:19|20)\d\d|history of|after (?:a|my|his|her|the) heart attack|died|passed away|survived|did (?:i|he|she|they|we|you) (?:have|get|suffer)|could (?:i|he|she) have had|without (?:knowing|noticing)|silent|в \d{2} лет|в (?:19|20)\d\d|(?:\d+|год|лет|несколько) (?:год\p{L}*|лет|месяц\p{L}*) назад|в прошлом году|после инфаркта|умер\p{L}*|не знал\p{L}*|не заметил\p{L}*|\d{2} տարեկանում|տարեկանում|տարի առաջ|տարվա առաջ|(?:19|20)\d\d-ին|ancac tari|ancyal tari|ամիս առաջ|անցյալ տարի|ինֆարկտից հետո|մահացել|չեմ իմացել|չի իմացել|չիմանալով|tarekanum|tari araj|mahacel|chem imacel)(?![\p{L}])/u;
const INFARCT_NOW=/(?<![\p{L}])(now|right now|just now|just had|today|having|is happening|сейчас|прямо сейчас|сегодня|հիմա|հենց հիմա|այսօր)(?![\p{L}])/u;
/** The sentence speaks of a heart attack that happened before, not one happening now. */
// "Now I am fine" is not a heart attack now («Инфаркт был в 2016 году, сейчас всё спокойно», «հիմա լավ եմ», «hima lav em»; C1 audit).
const FINE_NOW=/(?:now|today) (?:i am |i'm |i feel )?(?:fine|well|ok(?:ay)?|good)|(?:fine|well|ok(?:ay)?) now|сейчас (?:всё |все )?(?:спокойно|хорошо|нормально|в порядке)|сейчас чувствую себя (?:хорошо|нормально)|հիմա (?:ամեն ինչ )?(?:լավ|նորմալ)\p{L}*(?: եմ| է)?|hima (?:amen inch )?lav(?: em| e| a)?/gu;
export const infarctInPast=(sentence:string)=>INFARCT_PAST.test(sentence)&&!INFARCT_NOW.test(sentence.replace(FINE_NOW,' '));

/** The RF ids of a set of hits, for the care-team alert (staff only). */
export const redFlagIds=(hits:readonly RedFlagHit[])=>[...new Set(hits.map(h=>h.rf).filter((x):x is RedFlagId=>x!==null))].sort();
