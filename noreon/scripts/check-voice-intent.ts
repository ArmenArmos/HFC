import assert from 'node:assert/strict';
import {voiceIntent,spokenTime,type VoiceAction} from '@/lib/voice-core/intent';
import {digitsFromSpoken} from '@/lib/voice-core/spoken-numbers';
import {VOICE_STYLE_ADDENDUM,VOICE_STYLE_VERSION,voicePromptVersion,voiceTurn,withVoiceStyle} from '@/lib/zoe/voice-style';
import {BRAND_NAMES_PROMPT_RULE} from '@/lib/brand';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';

/**
 * WP V: the deterministic voice to action parser (lib/voice-core/intent.ts). Spoken numbers in Armenian, Russian and
 * English become the same reading a member would type; ambiguity, negation, questions, history and other people give
 * {kind:'none'}; staff utterances never open a member by name; each role opens only what it may.
 */
type Case=[text:string,locale:'hy'|'en'|'ru',expected:VoiceAction];
const bp=(systolic:number,diastolic:number,pulse:number|null=null):VoiceAction=>({kind:'log_bp',systolic,diastolic,pulse});
const NONE:VoiceAction={kind:'none'};
const member:Case[]=[
 // Armenian, digits and spoken numbers
 ['Ճնշումս 145/92 է','hy',bp(145,92)],
 ['ճնշումս հարյուր քառասունհինգի իննսուներկու է','hy',bp(145,92)],
 ['գրանցիր ճնշումս 128/80, զարկը 64','hy',bp(128,80,64)],
 ['ճնշումս հարյուր երեսունի ութսուն է, անոթազարկը յոթանասուներկու','hy',bp(130,80,72)],
 ['Ճնշումս 18-ի 12 է','hy',bp(180,120)],
 ['հարյուր երեսուն ութսուն','hy',NONE],
 ['երեկ ճնշումս 150/95 էր','hy',NONE],
 ['մայրիկիս ճնշումը 160/100 է','hy',NONE],
 ['ճնշումս 145/92 է՞ դա շատ է','hy',NONE],
 ['առավոտյան դեղերը խմեցի','hy',{kind:'confirm_dose',when:'morning'}],
 ['երեկոյան հաբերը չեմ խմել','hy',NONE],
 ['հիշեցրու ժամը 20:00-ին երեկոյան դեղերի համար','hy',{kind:'set_reminder',time:'20:00'}],
 ['հիշեցրու ժամը ութին','hy',NONE],
 ['հիշեցրու երեկոյան ժամը ութին ճնշումը չափել','hy',{kind:'set_reminder',time:'20:00'}],
 ['ցույց տուր իմ խոլեստերինի գրաֆիկը','hy',{kind:'show_ldl'}],
 ['ցույց տուր ճնշմանս գրաֆիկը','hy',{kind:'show_bp_trend'}],
 ['ուզում եմ կապվել բուժքրոջ հետ','hy',{kind:'contact_care_team'}],
 ['այո','hy',{kind:'confirm'}],
 ['այո, պահպանիր','hy',{kind:'confirm'}],
 ['ոչ, մի պահպանիր','hy',{kind:'cancel'}],
 // Russian
 ['давление сто сорок пять на девяносто два','ru',bp(145,92)],
 ['запиши давление 130 на 85 пульс 70','ru',bp(130,85,70)],
 ['давление сто тридцать на восемьдесят пульс шестьдесят восемь','ru',bp(130,80,68)],
 ['вчера давление было 150 на 90','ru',NONE],
 ['у мамы давление 170 на 100','ru',NONE],
 ['давление 145 на 92 это много?','ru',NONE],
 ['я выпил утренние таблетки','ru',{kind:'confirm_dose',when:'morning'}],
 ['я не выпил вечерние таблетки','ru',NONE],
 ['напомни в 20:00 выпить лекарства','ru',{kind:'set_reminder',time:'20:00'}],
 ['напомни в восемь вечера измерить давление','ru',{kind:'set_reminder',time:'20:00'}],
 ['напомни в восемь','ru',NONE],
 ['покажи мой холестерин','ru',{kind:'show_ldl'}],
 ['да, сохрани','ru',{kind:'confirm'}],
 ['нет, не сохраняй','ru',{kind:'cancel'}],
 // English
 ['my blood pressure is one forty five over ninety two','en',bp(145,92)],
 ['log my bp 120/80 pulse 66','en',bp(120,80,66)],
 ['one hundred and thirty over eighty five','en',bp(130,85)],
 ['145 over 92 and 150 over 95','en',NONE],
 ['is 145/92 too high','en',NONE],
 ['my husband\'s pressure is 150/90','en',NONE],
 ['bp 145 92 70 80','en',NONE],
 ['I took my evening pills','en',{kind:'confirm_dose',when:'evening'}],
 ['I took my medicines','en',{kind:'confirm_dose',when:'now'}],
 ['I forgot to take my pills','en',NONE],
 ['remind me at 8 pm to measure my blood pressure','en',{kind:'set_reminder',time:'20:00'}],
 ['remind me at 7:30 in the morning','en',{kind:'set_reminder',time:'07:30'}],
 ['remind me at 8','en',NONE],
 ['show my LDL progress','en',{kind:'show_ldl'}],
 ['show my blood pressure chart for this week','en',{kind:'show_bp_trend'}],
 ['what is LDL','en',NONE],
 ['please contact my nurse','en',{kind:'contact_care_team'}],
 ['yes','en',{kind:'confirm'}],
 ['no, don\'t save','en',{kind:'cancel'}],
 ['yes but not now','en',NONE],
 ['hello Zoe, how are you','en',NONE],
];
let n=0;
for(const [text,locale,expected] of member){
 assert.deepEqual(voiceIntent(text,locale,'patient'),expected,`patient ${locale}: ${text}`);n++;
}
// A caregiver logs readings and confirms doses for the member (their scopes are checked in SQL) but sets no reminders.
assert.deepEqual(voiceIntent('давление 130 на 85','ru','caregiver'),bp(130,85));n++;
assert.deepEqual(voiceIntent('remind me at 8 pm','en','caregiver'),NONE);n++;

// Staff: fixed worklist phrases only, bounded by the role's permissions, never a member by name.
const staff:[string,'hy'|'en'|'ru',import('@/lib/rbac/roles').AppRole,VoiceAction][]=[
 ['open my worklist','en','nurse',{kind:'open_worklist'}],
 ['show urgent alerts','en','nurse',{kind:'open_alerts'}],
 ['acknowledge the alert','en','nurse',{kind:'acknowledge_alert'}],
 ['подтверди оповещение','ru','nurse',{kind:'acknowledge_alert'}],
 ['approve the plan','en','family_physician',{kind:'open_plan_approval'}],
 ['утвердить план','ru','cardiologist',{kind:'open_plan_approval'}],
 ['approve the plan','en','nurse',NONE],
 ['set the target','en','cardiologist',{kind:'open_target'}],
 ['set the target','en','care_coordinator',NONE],
 ['հաստատիր պլանը','hy','family_physician',{kind:'open_plan_approval'}],
 ['ցույց տուր այսօրվա հերթը','hy','care_coordinator',{kind:'open_worklist'}],
 ['open voice settings','en','noreon_admin',{kind:'open_voice_settings'}],
 ['open voice settings','en','clinic_admin',NONE],
 ['what is waiting','en','noreon_admin',{kind:'open_operations'}],
 ['open Anna Petrosyan','en','nurse',NONE],
 ['open Anna','en','family_physician',NONE],
 ['log my bp 120/80','en','nurse',NONE],
];
for(const [text,locale,role,expected] of staff){assert.deepEqual(voiceIntent(text,locale,role),expected,`${role} ${locale}: ${text}`);n++;}
// Members never get staff actions.
assert.deepEqual(voiceIntent('open my worklist','en','patient'),NONE);n++;
assert.ok(n>=40,`at least 40 utterances (${n})`);

// Spoken numbers and times.
assert.equal(digitsFromSpoken('сто сорок пять на девяносто два'),'145 на 92');
assert.equal(digitsFromSpoken('ճնշումս հարյուր քառասունհինգի իննսուներկու է'),'ճնշումս 145-ի 92 է');
assert.equal(digitsFromSpoken('one forty five over ninety-two'),'145 over 92');
assert.equal(spokenTime('remind me at 20:00'),'20:00');
assert.equal(spokenTime('remind me at 8 pm'),'20:00');
assert.equal(spokenTime('remind me at 8'),null,'a 12-hour time without a part of the day is ambiguous');
assert.equal(voiceIntent('','hy','patient').kind,'none');
assert.equal(voiceIntent('x'.repeat(301),'en','patient').kind,'none');

// Voice-mode reply style (lib/zoe/voice-style.ts): only on a voice turn, versioned, brand names, no medical rules.
const job=(voice:boolean)=>({messageSeq:2,messages:[{seq:1},{seq:2,...(voice?{voice:true as const}:{})}]});
assert.equal(voiceTurn(job(true)),true);assert.equal(voiceTurn(job(false)),false);
assert.equal(voiceTurn({messageSeq:2,messages:[{seq:1,voice:true},{seq:2}]}),false,'only the newest message decides');
assert.equal(withVoiceStyle('SYSTEM',false),'SYSTEM');
assert.ok(withVoiceStyle('SYSTEM',true).startsWith('SYSTEM\n')&&withVoiceStyle('SYSTEM',true).includes(BRAND_NAMES_PROMPT_RULE));
assert.equal(voicePromptVersion('zoe-conversation-9',true),`zoe-conversation-9+${VOICE_STYLE_VERSION}`);
assert.equal(voicePromptVersion('zoe-conversation-9',false),'zoe-conversation-9');
assert.match(VOICE_STYLE_ADDENDUM,/every rule above still applies and wins/);
assert.doesNotMatch(VOICE_STYLE_ADDENDUM,/Aram|Petrosyan|log_bp_reading|alert_care_team|set_reminder|show_ldl_progress|160|180\/120|130 upper/,'no demo patient, tools or thresholds');
assert.doesNotMatch(VOICE_STYLE_ADDENDUM,/Զոի|!|—/u);
// The demo's emergency instruction is covered by the existing urgent path only as far as "call 103 now".
for(const l of ['hy','en','ru']as const)assert.match(URGENT_TEXT[l],/103/);
console.log(`Voice intent: ${n} utterances across hy/ru/en (spoken numbers, negation, ambiguity, history, other people, roles), times, and the voice style addendum passed.`);
