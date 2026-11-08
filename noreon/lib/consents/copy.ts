/**
 * Member consent wording (WP F), in the order shown. The card renders these lines and the server hashes exactly the
 * same lines (consentTextHash below), so a stored text_hash is the hash of the text the member saw.
 *
 * DRAFT WORDING, NOT LEGALLY APPROVED (pending legal, Tatevik and the clinicians), like the Zoe consent before it.
 * Changing any line means a new version constant below: the database stores the version with each decision, and a
 * decision about older wording stays a decision about that wording.
 *
 * Framework-free (no next/* imports, no node:crypto): shared by the server and the browser.
 */
import type {Locale} from '../locale';
import {NOREON_HY,ZOE_HY} from '../brand';

export const MEMBER_CONSENT_VERSION='member-consent-draft-1';
export const CAREGIVER_CONSENT_VERSION='caregiver-consent-draft-1';
export const CONSENT_COPY_STATUS='draft-unapproved'as const;

type L=Readonly<Record<Locale,string>>;
const c=(hy:string,en:string,ru:string):L=>Object.freeze({hy,en,ru});
const say=(l:Locale,line:L)=>line[l]??line.hy;

/** The kinds a member decides on the consents card; caregiver sharing is decided on the caregiver card. */
export const MEMBER_CONSENT_KINDS=['data_processing','voice_processing','research']as const;
export type MemberConsentKind=typeof MEMBER_CONSENT_KINDS[number];
export const ALL_CONSENT_KINDS=['data_processing','caregiver_sharing','voice_processing','research','telegram_channel']as const;
export type ConsentKind=typeof ALL_CONSENT_KINDS[number];

export const CONSENT_TITLE:Readonly<Record<ConsentKind,L>>=Object.freeze({
 data_processing:c('Ձեր տվյալների մշակումը','Processing your health data','Обработка ваших данных о здоровье'),
 caregiver_sharing:c('Տվյալների տրամադրումը ձեզ օգնող մարդկանց','Sharing with people who help you','Доступ для людей, которые вам помогают'),
 voice_processing:c('Ձայնային զրույցներ','Voice conversations','Голосовые разговоры'),
 research:c('Հետազոտություն','Research','Исследования'),
 telegram_channel:c('Telegram-ով հաղորդագրություններ','Messages on Telegram','Сообщения в Telegram'),
});

const STATEMENT:Readonly<Record<MemberConsentKind,readonly L[]>>=Object.freeze({
 data_processing:[
  c(`${NOREON_HY.base}ը մշակում է ձեր պատասխանները, չափումները, անալիզները և հաղորդագրությունները, որպեսզի ձեր խնամքի թիմը կարողանա հոգ տանել ձեր սրտի և անոթների առողջության մասին։`,
   'Noreon Health processes your answers, readings, test results and messages so that your care team can look after your heart and blood vessel health.',
   'Нореон Хелс обрабатывает ваши ответы, измерения, анализы и сообщения, чтобы ваша медицинская команда могла заботиться о здоровье вашего сердца и сосудов.'),
  c('Ձեր տվյալները տեսնում են միայն ձեր խնամքի թիմը և այն մարդիկ, որոնց դուք եք թույլ տվել։','Only your care team and the people you allow can see your data.','Ваши данные видят только ваша медицинская команда и люди, которым вы это разрешили.'),
  c('Կարող եք ցանկացած պահի հետ վերցնել այս համաձայնությունը։','You can withdraw this consent at any time.','Вы можете отозвать это согласие в любой момент.'),
 ],
 voice_processing:[
  c(`Երբ խոսում եք ${ZOE_HY.dative}, ձեր ձայնը վերածվում է տեքստի, որպեսզի ${ZOE_HY.definite} հասկանա ձեզ։`,
   'When you speak to Zoe, your voice is turned into text so that Zoe can understand you.',
   'Когда вы говорите с Зоей, ваш голос превращается в текст, чтобы Зоя могла вас понять.'),
  c('Ձայնագրությունը չենք պահում։ Պահվում է միայն տեքստը, ինչպես գրավոր հաղորդագրությունը։','We do not keep the recording. Only the text is kept, like a written message.','Мы не храним запись. Сохраняется только текст, как у письменного сообщения.'),
  c('Կարող եք ցանկացած պահի անջատել ձայնը և գրել։','You can turn voice off and type at any time.','Вы можете в любой момент выключить голос и писать.'),
 ],
 research:[
  c('Ձեր տվյալները, առանց ձեր անվան և հեռախոսահամարի, կարող են օգտագործվել սրտանոթային խնամքը բարելավող հետազոտություններում։',
   'Your data, without your name or phone number, may be used in research that improves heart and blood vessel care.',
   'Ваши данные без имени и номера телефона могут использоваться в исследованиях, которые улучшают помощь при болезнях сердца и сосудов.'),
  c('Սա պարտադիր չէ։ Ձեր խնամքը նույնն է, ինչ էլ որոշեք։','This is optional. Your care is the same whatever you decide.','Это необязательно. Ваша помощь не изменится, что бы вы ни решили.'),
 ],
});

/** Every line of one member consent statement, in the order shown. */
export function consentLines(kind:MemberConsentKind,l:Locale):string[]{
 return [say(l,CONSENT_TITLE[kind]),...STATEMENT[kind].map(line=>say(l,line))];
}
export const consentText=(kind:MemberConsentKind,l:Locale)=>consentLines(kind,l).join('\n');

export const CAREGIVER_SCOPES=['view_plan','view_readings','log_readings','confirm_doses','receive_alerts','message_care_team']as const;
export type CaregiverScope=typeof CAREGIVER_SCOPES[number];
export const SCOPE_LABEL:Readonly<Record<CaregiverScope,L>>=Object.freeze({
 view_plan:c('Տեսնել ձեր խնամքի պլանը','See your care plan','Видеть ваш план лечения'),
 view_readings:c('Տեսնել ձեր ճնշման չափումները','See your blood pressure readings','Видеть ваши измерения давления'),
 log_readings:c('Գրանցել ճնշման չափումներ ձեր փոխարեն','Log blood pressure readings for you','Записывать измерения давления за вас'),
 confirm_doses:c('Նշել ձեր ընդունած դեղերը','Mark the medicines you took','Отмечать принятые вами лекарства'),
 receive_alerts:c('Ստանալ ծանուցումներ, երբ ինչ-որ բան ուշադրություն է պահանջում','Get alerts when something needs attention','Получать уведомления, когда что-то требует внимания'),
 message_care_team:c('Գրել ձեր խնամքի թիմին ձեր մասին','Write to your care team about you','Писать вашей медицинской команде о вас'),
});
export const CAREGIVER_RELATIONSHIPS=['spouse','partner','child','parent','sibling','relative','friend','other']as const;
export type CaregiverRelationship=typeof CAREGIVER_RELATIONSHIPS[number];
export const RELATIONSHIP_LABEL:Readonly<Record<CaregiverRelationship,L>>=Object.freeze({
 spouse:c('Ամուսին կամ կին','Husband or wife','Муж или жена'),partner:c('Զուգընկեր','Partner','Партнёр'),child:c('Զավակ','Son or daughter','Сын или дочь'),
 parent:c('Ծնող','Parent','Родитель'),sibling:c('Եղբայր կամ քույր','Brother or sister','Брат или сестра'),relative:c('Ազգական','Relative','Родственник'),
 friend:c('Ընկեր','Friend','Друг'),other:c('Այլ','Someone else','Другой человек'),
});

/**
 * The caregiver-sharing statement for one invitation: who, and exactly what they may do. The scopes are listed in
 * their canonical order, so the same choice always reads (and hashes) the same.
 */
export function caregiverConsentLines(l:Locale,name:string,scopes:readonly CaregiverScope[]):string[]{
 const chosen=CAREGIVER_SCOPES.filter(s=>scopes.includes(s));
 return [
  say(l,CONSENT_TITLE.caregiver_sharing),
  say(l,c(`Դուք թույլ եք տալիս ${name}-ին օգնել ձեզ ${NOREON_HY.genitive} հավելվածում։`,`You allow ${name} to help you in the Noreon Health app.`,`Вы разрешаете человеку по имени ${name} помогать вам в приложении Нореон Хелс.`)),
  say(l,c('Նա կկարողանա՝','They will be able to:','Этот человек сможет:')),
  ...chosen.map(s=>`- ${say(l,SCOPE_LABEL[s])}`),
  say(l,c('Նա չի տեսնի այն, ինչ նշված չէ, և չի կարող փոխել ձեր բուժումը։','They will not see anything not listed here and cannot change your treatment.','Этот человек не увидит ничего сверх перечисленного и не может изменить ваше лечение.')),
  say(l,c('Նա պետք է մուտք գործի այս հեռախոսահամարով և ընդունի հրավերը։ Կարող եք ցանկացած պահի փոխել կամ հետ վերցնել թույլտվությունը։',
   'They must sign in with this phone number and accept the invitation. You can change or withdraw this permission at any time.',
   'Этот человек должен войти с этим номером телефона и принять приглашение. Вы можете изменить или отозвать разрешение в любой момент.')),
 ];
}
export const caregiverConsentText=(l:Locale,name:string,scopes:readonly CaregiverScope[])=>caregiverConsentLines(l,name,scopes).join('\n');

/** sha256 hex of the exact text shown (Web Crypto: the same on the server and in the browser). */
export async function consentTextHash(text:string):Promise<string>{
 const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
