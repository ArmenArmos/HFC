import type {ChatMemberIdentity} from '@/lib/staff/chat-member-identity-schema';
import 'server-only';
import {nameSkeleton,nameWordMatches,matchingNameRows,hasNameInflection} from './name-skeleton';
import type {MemberSearchInput} from '@/lib/staff/member-search-schema';
import {conversationReadSchema,recentSchema,savedAnswer,type AnswerContent} from './contracts';

export type ChatZoeConversation={conversationId:string;memberId:string;memberName:string|null;savedAt:string};
export type ChatZoeHistoryTurn={key:string;conversationId:string;memberId:string;memberName:string|null;seq:number;role:'staff'|'zoe';text:string;content:AnswerContent|null;savedAt:string};
export type ChatZoeHistoryResponse={kind:'history';turns:ChatZoeHistoryTurn[];conversations:ChatZoeConversation[];target:ChatZoeConversation|null}|{kind:'off'|'refused'|'unavailable'};
type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** A small saved-history window. Every required read must succeed before any history is returned. */
export async function readChatZoeHistory(client:Rpc,now=Date.now()):Promise<ChatZoeHistoryResponse>{
 try{
  const recent=await client.rpc('staff_zoe_recent');
  if(recent.error)return {kind:'unavailable'};
  const parsed=recentSchema.safeParse(recent.data);
  if(!parsed.success)return {kind:'unavailable'};
  if(!parsed.data.enabled)return {kind:'off'};
  const since=now-24*60*60*1000;
  if(parsed.data.rows.some(row=>!Number.isFinite(Date.parse(row.at))))return {kind:'unavailable'};
  const rows=parsed.data.rows.filter(row=>Date.parse(row.at)>=since&&Date.parse(row.at)<=now).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));
  const unique=rows.filter((row,index)=>rows.findIndex(other=>other.id===row.id)===index).slice(0,3);
  const conversations:ChatZoeConversation[]=[],turns:ChatZoeHistoryTurn[]=[];
  for(const row of unique){
   const read=await client.rpc('staff_zoe_read',{p_conversation:row.id});
   if(read.error)return {kind:'unavailable'};
   const conversation=conversationReadSchema.safeParse(read.data);
   if(!conversation.success)return {kind:'unavailable'};
   if(!conversation.data.enabled)return {kind:'off'};
   const data=conversation.data;
   if(data.id!==row.id||data.member.id!==row.memberId)return {kind:'unavailable'};
   conversations.push({conversationId:data.id,memberId:data.member.id,memberName:data.member.name,savedAt:row.at});
   for(const message of data.messages){
    const at=Date.parse(message.at);
    if(!Number.isFinite(at))return {kind:'unavailable'};
    if(at<since||at>now)continue;
    const content=message.role==='zoe'?savedAnswer(message.content):null;
    if(message.role==='zoe'&&!content)return {kind:'unavailable'};
    turns.push({key:`zoe:${data.id}:${message.seq}`,conversationId:data.id,memberId:data.member.id,memberName:data.member.name,seq:message.seq,role:message.role,text:message.body,content,savedAt:message.at});
   }
  }
  turns.sort((a,b)=>Date.parse(a.savedAt)-Date.parse(b.savedAt)||a.conversationId.localeCompare(b.conversationId)||a.seq-b.seq);
  return {kind:'history',turns:turns.slice(-20),conversations,target:conversations[0]??null};
 }catch{return {kind:'unavailable'};}
}

/** Read this doctor's selected conversation directly, without the general home's recent/24-hour window. */
export async function readPatientChatZoeHistory(client:Rpc,conversationId:string,memberId:string):Promise<ChatZoeHistoryResponse>{
 try{
  const r=await client.rpc('staff_zoe_read',{p_conversation:conversationId});
  if(r.error)return {kind:'refused'};
  const p=conversationReadSchema.safeParse(r.data);
  if(!p.success)return {kind:'unavailable'};
  if(!p.data.enabled)return {kind:'off'};
  const data=p.data;
  if(data.id!==conversationId||data.member.id!==memberId)return {kind:'refused'};
  const turns:ChatZoeHistoryTurn[]=[];
  for(const message of data.messages){
   if(!Number.isFinite(Date.parse(message.at)))return {kind:'unavailable'};
   const content=message.role==='zoe'?savedAnswer(message.content):null;
   if(message.role==='zoe'&&!content)return {kind:'unavailable'};
   turns.push({key:`zoe:${data.id}:${message.seq}`,conversationId:data.id,memberId,memberName:data.member.name,seq:message.seq,role:message.role,text:message.body,content,savedAt:message.at});
  }
  turns.sort((a,b)=>a.seq-b.seq);
  const conversation={conversationId:data.id,memberId,memberName:data.member.name,savedAt:turns.at(-1)?.savedAt??''};
  return {kind:'history',turns,conversations:[conversation],target:conversation};
 }catch{return {kind:'unavailable'};}
}

// Only these question openers are exempt from first-word identity checks.
const OPENERS=new Set(`what what's whats who how why when where which show tell find give is are do does did can could please
ինչ ով ինչպես ինչու երբ որտեղ որն որ ցույց ասա պատմիր գտիր տուր է են կարող խնդրում
что кто как почему когда где какой какая какие которое который покажи расскажи скажи найди дай есть можешь можете мог могли пожалуйста`.normalize('NFKC').split(/\s+/u));
// A capitalised common word anywhere else may be a name.
const STOP=new Set(`what whats is are was were how why when who which tell me my about for of the a an and or to in on with please show find latest last recent result results test tests blood pressure bp ldl hdl cholesterol glucose health summary summarize summarise risk plan member patient doctor name names անուն անունը имя имени zoe does did do has have his her their s
ինչ ինչու ինչպես երբ ով որն է են էր էին ինձ իմ մասին համար և կամ ու որ այս այդ վերջին նոր արդյունք արդյունքները արդյունքներ քննություն քննությունները արյան ճնշում խոլեստերին շաքար անդամ անդամի բժշկի ցույց տուր գտիր ամփոփիր
что какой какая какие как почему когда кто где это есть был была мне мой моя о об для и или в на с его её их последние последний анализ анализы результаты результат давление кровь холестерин сахар участник участника пациент пациента врач покажи найди расскажи
trend trending change changed week month year today yesterday previous since between compared average high low normal medicine medicines dose doses visit nurse message messages record recorded reading readings taking missed goal target alert alerts any this that after before review doing monday tuesday wednesday thursday friday saturday sunday
միտում միտումները փոփոխություն փոփոխությունները փոխվել փոխված շաբաթ շաբաթը շաբաթվա ամիս ամիսը ամսվա տարի տարին տարվա այսօր երեկ նախորդ անցած անցյալ սկսած ից միջև համեմատ համեմատած միջին բարձր ցածր նորմալ դեղ դեղը դեղեր դեղերը դեղերի դեղաչափ դեղաչափը դեղաչափեր դեղաչափերը պլան պլանը այց այցը բուժքույր բուժքույրը բժիշկ բժիշկը հաղորդագրություն հաղորդագրությունները գրառում գրառումները գրանցված գրանցել ցուցանիշ ցուցանիշները չափում չափումները ընդունում ընդունել բաց թողած բացթողում նպատակ նպատակը թիրախ թիրախը ահազանգ ահազանգերը ճնշումը երկուշաբթի երեքշաբթի չորեքշաբթի հինգշաբթի ուրբաթ շաբաթ կիրակի
тренд тенденция тенденции динамика изменение изменения изменилось изменился изменилась изменились неделя неделю недели неделе месяц месяца месяце год года году сегодня вчера предыдущий предыдущая предыдущие прошлый прошлая прошлую прошлой прошлые прошлого последний последняя последнюю последней последних начиная между сравнению сравнении сравнить средний средняя среднее высокий высокая высокое низкий низкая низкое нормальный нормальная нормальное лекарство лекарства лекарств лекарствами препарат препараты препаратов доза дозы доз дозу дозировка план плана визит визиты медсестра медсестры доктор врача сообщение сообщения сообщений запись записи записанные записано записанный показание показания показаний измерение измерения измерений прием приём принимать принимает пропуск пропуски пропущенные пропущенных пропущены цель цели целевой целевые оповещение оповещения тревога тревоги за от по до после понедельник понедельника вторник вторника среда среды четверг четверга пятница пятницы суббота субботы воскресенье воскресенья
he him she they them this that these those been going get got happened happen tonight now lately recently again still next should write wrote written say said urgent chest pain i may might will would shall must explain describe check see look read open list review summarise
նա նրան նրա ինքը իրեն իր նրանք նրանց այս այդ սրանք դրանք անդամ հիվանդ անում արել եղել գնում ստանալ ստացել ստացավ պատահել պատահեց տեղի ունեցել այսօր երեկ այսգիշեր հիմա վերջերս կրկին դեռ հաջորդ պետք ամփոփել ամփոփում գրել գրեց գրված ասել ասաց ասված ահազանգ ահազանգեր հաղորդագրություններ շտապ կրծքավանդակ կրծքավանդակի ցավ ցավը ես
он ему им она ей ее они этим тем эти те этот тот эта та это то участники пациенты делает делал делала делали делать было были идет идёт шёл шла получить получил получила получили случилось произошло случиться произойти сегодня вчера ночью сейчас недавно вновь снова ещё еще следующий следующая следующие дальше следует должен должна должны нужно обобщи обобщить резюме напиши написал написала написали написано писать говорит говорил говорила говорили сказал сказала сказали сказать срочно срочный срочная грудь груди боль боли я`.normalize('NFKC').split(/\s+/u));
// Ordinary wording that may open or sit inside a doctor's sentence ("Отклони этот план", "Բարի լույս, Zoe", "Լավ, ...", "Approve the plan", "in Armenia"). It only
// exempts a capitalised word from the "could be another member's name" check, and never when that word is a name word of a roster member (a surname "Good" stays a name),
// so it is kept apart from STOP, which the name matching also uses.
const ORDINARY=new Set(`hello hi hey good morning evening afternoon ok okay well so right thanks thank approve reject decline accept delete remove erase order book remind reply write draft compare double stop start raise lower change add check list explain review send forget ignore
armenia yerevan gyumri system assistant
սպասիր բարի լույս բարեւ բարև օր երեկո ողջույն լավ հիանալի շնորհակալություն զոյա հաստատիր հաստատել մերժիր մերժել գրիր գրի ցույց տուր ասա բացիր գտիր պատմիր ստուգիր համեմատիր հիշեցրու պատրաստիր ջնջիր մոռացիր սպասիր հիմա ասում գրում սրա դրա նրա իր իրեն սա դա այս այդ ինչպես ինչ ով որ երբ ինչու քանի արդյոք կարող խնդրում ուզում նախ հետո դեղը դեղաչափը հայաստան հայաստանում երևան երեւան գյումրի
привет добрый доброе утро день вечер здравствуйте хорошо ладно ну так спасибо зоя отклони отклонить одобри одобрить покажи показать открой открыть ответь ответить сделай подготовь подготовить удали удалить забудь напиши написать поставь проверь проверить сравни сравнить дай скажи расскажи найди посмотри объясни составь назначь закажи приведи собери отправь вчера сегодня завтра через по с на для как что кто он она ему ей это этот эта вот если когда армения армении ереван гюмри`.normalize('NFKC').split(/\s+/u));
// Abbreviations a doctor writes as capitals; anything else in capitals ("NAREK") is treated as a name.
// Common sentence openers of a typed paragraph (a nurse or doctor writes several sentences): after a full stop or line break the next capitalised word is ordinary wording unless it is
// a name. Kept as an allow-list so an unknown name ("Арман вчера дома было 135 85", "Արմեն չէ Արամ") still asks; a roster surname is never exempted (see rosterAll).
const SENTENCE_OPENERS=new Set(`i you he she it we they the this that these those there here and but or so then now also only just still already again maybe yes no not never always sometimes today tomorrow yesterday tonight if when while because since after before until once what why how who where which can could should would will might must do does did have has had is are was were be get got make let try tell ask say send write read look see take give need want like know think feel put set open close mark note lab labs result results value values keep leave stop start please sorry another other next last first second third new old more less very too really actually basically anyway however finally quick urgent
и а но да нет только лишь именно вообще кстати конечно ей ему им ему его её ее их мне тебе нам вам ты мы вы я он она оно они это этот эта эти тот та те все всё что кто как когда где куда откуда почему зачем если пока тогда потом сейчас уже ещё еще просто пришли пришлите поставь поставьте закрой отправь отправляй напиши запиши скажи сделай дай возьми проверь посмотри найди открой отметь добавь убери пусть пускай можно нужно надо должен ладно ну вот тоже также спасибо извини сегодня завтра вчера утром вечером днём ночью теперь снова опять тут там здесь у них ней нём натощак приходи приходить пить принимать иногда всегда никогда очень слишком у него неё нее нём там
և ու բայց կամ թե եթե երբ ինչ ով որ ինչու որտեղ ինչպես հիմա այսօր երեկ վաղը արդեն դեռ միայն պարզապես նաև էլ նոր հին հաջորդ վերջին առաջին լաբի թղթի վրա գրեմ ինձ ես դու նա մենք դուք նրանք սա դա այս այդ այն այո ոչ չէ ոչինչ ամեն բոլոր ամբողջ շատ քիչ վատ էս խնդրում գրիր գրի ասա տուր ցույց բաց փակիր ուղարկիր ստուգիր նշիր ավելացրու հանիր հեռացրու ունի ունեմ ունեն կա չկա կարող պետք հարկավոր պիտի ինքը իրեն իր նրա նրան`.normalize('NFKC').split(/\s+/u));
const ACRONYMS=new Set('esc eas ldl hdl bp ecg ekg gp egfr ck tsh alt ast hba1c mri ct ace arb pdf ai sms url dob id nrn eu usa score score2 sbp dbp'.split(' '));
/** NFKC without the Armenian emphasis, exclamation and question marks that sit inside a word ("Ի՞նչ", "Ինչո՞ւ") and would split it in two. */
const plainText=(text:string)=>text.normalize('NFKC').replace(/[\u055B\u055C\u055E]/gu,'');
export function isQuestionStopWord(token:string):boolean{return STOP.has(token);}
export function questionMemberTokens(raw:unknown,maxTokens=4):string[]|null{
 if(typeof raw!=='string'||raw.length>1000||/[\u0000-\u001f\u007f]/u.test(raw))return null;
 const words=(plainText(raw).match(/[\p{L}]+(?:[-'][\p{L}]+)*/gu)??[]).flatMap(word=>/^[\p{L}]+-[\p{L}]{1,3}$/u.test(word)&&!/^[\p{L}]+-[A-Za-z]+$/u.test(word)?[word.split('-')[0]!]:[word]);
 const tokens=[...new Set(words.flatMap((original,index)=>{
  const word=original.toLocaleLowerCase().replace(/'s$/u,'');
  return [...word].length>=2&&[...word].length<=100&&!(index===0&&OPENERS.has(word))&&(!STOP.has(word)||/^\p{Lu}/u.test(original))?[word]:[];
 }))];
 // A long, unresolved phrase is not evidence for one member from a truncated subset.
 return tokens.length>maxTokens?null:tokens;
}

export type ChatQuestionMemberResponse={kind:'member';memberId:string;memberName:string;identity?:ChatMemberIdentity}|{kind:'choose';rows:({id:string;name:string}&Partial<ChatMemberIdentity>)[]}|{kind:'keep'|'none'|'ambiguous'|'invalid'|'refused'|'unavailable'};
type QuestionMemberSearch=(query:string,cursor?:MemberSearchInput['cursor'])=>Promise<{kind:'members';page:{rows:{id:string;name:string|null}[];hasMore:boolean;nextCursor:MemberSearchInput['cursor']}}|{kind:'refused'|'unavailable'|'invalid'|'day'|'poll'|'missing_bp'|'record'}>;

/** Same assigned-name RPC and cursor, with no partial roster presented as complete. */
export async function readChatNameRoster(search:QuestionMemberSearch){
 const rows:{id:string;name:string|null}[]=[];
 let cursor:MemberSearchInput['cursor']=null;
 for(let page=0;page<10;page++){
  const result=await search('',cursor);
  if(result.kind!=='members')return null;
  rows.push(...result.page.rows);
  if(!result.page.hasMore)return rows;
  if(!result.page.nextCursor)return null;
  cursor=result.page.nextCursor;
 }
 return null;
}

/** The caller authenticates and validates before reading its assigned roster. */
export async function searchChatMemberNames(query:string,search:QuestionMemberSearch){
 const result=await search(query);
 if(result.kind!=='members'||!/[\p{L}]/u.test(query))return result;
 const roster=await readChatNameRoster(search);
 if(!roster)return {kind:'unavailable' as const};
 const rows=matchingNameRows(roster,query);
 return {kind:'members' as const,page:{rows:rows.slice(0,50),hasMore:rows.length>50,nextCursor:null},requiresChoice:rows.length>0&&!matchingNameRows(roster,query,false).length};
}

/** Resolve identity from the same bounded roster checks for each staff chat. */
export async function resolveQuestionMember(question:unknown,current:{memberId:string;memberName:string}|undefined,search:QuestionMemberSearch):Promise<ChatQuestionMemberResponse>{
 const tokens=questionMemberTokens(question,current?Infinity:4);if(!tokens)return {kind:'invalid'};
 const inflected=hasNameInflection(String(question));
 if(!tokens.length&&!current)return {kind:'none'};
 const words=(name:string):string[]=>plainText(name).toLowerCase().match(/[\p{L}\p{M}]+/gu)??[];
 const skeletonWords=(name:string)=>words(name).map(nameSkeleton);
 const same=(a:string,b:string)=>nameSkeleton(a)===nameSkeleton(b);
 const questionWords=` ${skeletonWords(String(question)).join(' ')} `;
 const names=new Map<string,string>();let truncated=false;
 let completeRoster:{id:string;name:string|null}[]|null=null;
 const collect=(rows:{id:string;name:string|null}[])=>{for(const row of rows)names.set(row.id,row.name??'');};
 const coverage=(name:string)=>tokens.filter(token=>words(name).some(word=>nameWordMatches(token,word))).length;
 const choose=():ChatQuestionMemberResponse=>({kind:'choose',rows:[...names].sort(([a],[b])=>a===current?.memberId?-1:b===current?.memberId?1:(names.size>5?coverage(names.get(b)??'')-coverage(names.get(a)??''):0)||a.localeCompare(b)).slice(0,5).map(([id,name])=>({id,name}))});
 try{
 if(current?.memberId){
  const memberRow={id:current.memberId,name:current.memberName};
  const confirm=():ChatQuestionMemberResponse=>({kind:'choose',rows:[memberRow]});
  const roster=new Map<string,string>();let cursor:MemberSearchInput['cursor']=null,complete=false;
  try{
   for(let page=0;page<10;page++){
    const result=await search('',cursor);
    if(result.kind!=='members')return confirm();
    for(const row of result.page.rows){
     roster.set(row.id,row.name??'');
     if(row.id===current.memberId)memberRow.name=row.name??memberRow.name;
    }
    if(!result.page.hasMore){complete=true;break;}
    if(!result.page.nextCursor)return confirm();
    cursor=result.page.nextCursor;
   }
  }catch{/* An incomplete roster offers only the current member for an explicit press. */}
  if(!complete)return confirm();
  if(!roster.has(current.memberId))return {kind:'unavailable'};
  names.set(memberRow.id,memberRow.name);
  const originalWords=plainText(String(question)).match(/[\p{L}\p{M}]+/gu)??[];
  const questionList=originalWords.map(word=>word.toLowerCase()),currentWords=new Set(words(memberRow.name));
  const fullNames=[...roster].filter(([id,name])=>id!==current.memberId&&words(name).length&&questionWords.includes(` ${skeletonWords(name).join(' ')} `));
  const switched=fullNames.length===1?fullNames[0]:undefined;
  const namePositions=(name:string)=>{
   const nameWords=words(name),at=nameWords.length?questionList.findIndex((_,i)=>nameWords.every((word,j)=>same(questionList[i+j]??'',word))):-1;
   return new Set(at<0?[]:nameWords.map((_,i)=>at+i));
  };
  const switchPositions=namePositions(switched?.[1]??'');
  const explainedPositions=new Set([...namePositions(memberRow.name),...switchPositions]);
  const remainingWords=new Set(questionList.filter((_,i)=>!explainedPositions.has(i)));
  // A name word that is also ordinary wording ("May", "Will") still names that member when it is written as a name (capitalised after the first word)
  // or is a modal that doubles as a given name; the pure function words of a full name ("Claude The Tester": "the") never do.
  const FUNCTION=new Set('the a an of and or to in on for with is are was were what how why when who which me my he she they this that it i be'.split(' '));
  const writtenAsName=(word:string)=>!FUNCTION.has(word)&&(['may','will'].includes(word)||originalWords.some((original,i)=>i>0&&!explainedPositions.has(i)&&original===original[0]!.toLocaleUpperCase()+original.slice(1).toLocaleLowerCase()&&original.toLocaleLowerCase()===word&&/\p{Lu}/u.test(original)));
  let otherReference=false;
  for(const [id,name] of roster){
   // A middle or last name word that is ordinary question wording ("Claude The Tester": "the") is no reference to that member;
   // a first or only name word still is ("An Nguyen"), and so is every other name word.
   if(id!==current.memberId&&words(name).some((word,at)=>(!isQuestionStopWord(word)||at===0||writtenAsName(word))&&[...remainingWords].some(q=>same(q,word)&&(!isQuestionStopWord(q)||q===word||writtenAsName(q))))){names.set(id,name);otherReference=true;}
  }
  for(const [id,name] of fullNames)names.set(id,name);
  // A full-name switch must be unique and cannot discard a separate reference to current.
  const duplicateName=switched&&[...roster.values()].filter(name=>skeletonWords(name).join(' ')===skeletonWords(switched[1]).join(' ')).length!==1;
  const currentReferenced=switched&&questionList.some((word,i)=>!switchPositions.has(i)&&[...currentWords].some(w=>same(w,word)));
  // A sentence opener is exempt only when it is ordinary question wording; "Narek, what did he write?" opens with a name.
  // Only supported inflections and one-letter mistakes of a whole token suggest another member.
  const variant=(query:string,name:string)=>!same(query,name)&&nameWordMatches(query,name);
  const rosterWords=[...roster].filter(([id])=>id!==current.memberId).flatMap(([,name])=>words(name).filter(word=>!isQuestionStopWord(word)));
  const rosterAll=new Set([...roster.values()].flatMap(words));
  const nameVariant=questionList.some((word,i)=>!explainedPositions.has(i)&&!isQuestionStopWord(word)&&![...currentWords].some(w=>same(w,word))&&rosterWords.some(r=>variant(word,r)));
  const plainWord=(word:string)=>((ORDINARY.has(word)||SENTENCE_OPENERS.has(word))&&![...rosterAll].some(w=>same(w,word)))||ACRONYMS.has(word)||[...word].length===1;
  const unknownCapital=questionList.some((word,i)=>!explainedPositions.has(i)&&/\p{Lu}/u.test(originalWords[i])&&!isQuestionStopWord(word)&&![...currentWords].some(w=>same(w,word))&&!plainWord(word));
  // A member named like a pronoun or an ordinary word ("He", "May") is never switched to on that word alone.
  const commonName=fullNames.some(([,name])=>{const w=words(name);return w.length===1&&(isQuestionStopWord(w[0]!)||questionList.some(q=>same(q,w[0]!)&&isQuestionStopWord(q)));});
  // A one-word name ("Hope", "Grace") switches only when written as a name: capitalised, and not as the question's own first word unless a comma follows it.
  const bareWordName=fullNames.some(([,name])=>{
   const w=words(name);if(w.length!==1)return false;
   const at=questionList.findIndex(q=>same(q,w[0]!));
   return at<0||!/^\p{Lu}/u.test(originalWords[at]!)||(at===0&&!new RegExp(`^\\s*${originalWords[0]!}\\s*[,:]`,'u').test(plainText(String(question))));
  });
  const adjacentSurname=questionList.some((word,i)=>!switchPositions.has(i)&&[...currentWords].some(w=>same(w,word))&&[i-1,i+1].some(j=>
   j>=0&&j<questionList.length&&!switchPositions.has(j)&&/^\p{Ll}[\p{Ll}\p{M}]*$/u.test(originalWords[j])&&![...currentWords].some(w=>same(w,questionList[j]))&&!isQuestionStopWord(questionList[j])));
  if(nameVariant){for(const [id,name] of roster)if(id!==current.memberId&&words(name).some(w=>!isQuestionStopWord(w)&&questionList.some((q,i)=>!explainedPositions.has(i)&&variant(q,w))))names.set(id,name);return choose();}
  if(inflected||fullNames.length>1||duplicateName||otherReference||currentReferenced||unknownCapital||adjacentSurname||commonName||bareWordName)return choose();
  return switched?{kind:'member',memberId:switched[0],memberName:switched[1]}:{kind:'keep'};
 }
  // Filtering question words is never enough evidence for an automatic result.
  // Read the complete assigned roster, names only, before every keep or member.
  const automatic=async(selected=current):Promise<ChatQuestionMemberResponse>=>{
   if(!selected)return {kind:'none'};
   const memberRow={id:selected.memberId,name:names.get(selected.memberId)??selected.memberName};
   const confirm:ChatQuestionMemberResponse={kind:'choose',rows:[memberRow]};
   const matches=new Map<string,string>();
   // The selected member's own whole name, once, explains the words it is made of, a shared surname included. Any other
   // occurrence of those words in the question is checked against the roster like every other word.
   const questionList=words(String(question)),selectedName=words(memberRow.name);
   const at=selectedName.length?questionList.findIndex((_,i)=>selectedName.every((word,j)=>same(questionList[i+j]??'',word))):-1;
   const questionWordSet=new Set(at>=0?[...questionList.slice(0,at),...questionList.slice(at+selectedName.length)]:questionList);
   let cursor:MemberSearchInput['cursor']=null;
   try{
    for(let page=0;page<10;page++){
     const result:Awaited<ReturnType<typeof search>>=completeRoster?({kind:'members' as const,page:{rows:completeRoster,hasMore:false,nextCursor:null}} as never):await search('',cursor);
     if(result.kind!=='members')return confirm;
     for(const row of result.page.rows){
      if(row.id===selected.memberId){memberRow.name=row.name??memberRow.name;continue;}
      if(skeletonWords(row.name??'').join(' ')===skeletonWords(memberRow.name).join(' ')||words(row.name??'').some(word=>[...questionWordSet].some(q=>same(q,word))))matches.set(row.id,row.name??'');
     }
     if(!result.page.hasMore)return matches.size?{kind:'choose',rows:[memberRow,...[...matches].map(([id,name])=>({id,name}))]}:selected.memberId===current?.memberId?{kind:'keep'}:{kind:'member',memberId:selected.memberId,memberName:memberRow.name};
     if(!result.page.nextCursor)return confirm;
     cursor=result.page.nextCursor;
    }
   }catch{/* Incomplete roster: one press on the resolved member can continue safely. */}
   return confirm;
  };
  if(!tokens.length)return await automatic();
  const requiredTokens:string[]=[];
  for(const query of tokens){
   const result=await search(query);
   if(result.kind!=='members')return {kind:result.kind==='refused'?'refused':'unavailable'};
   collect(result.page.rows);truncated ||= result.page.hasMore;
   if(!isQuestionStopWord(query)||result.page.rows.length)requiredTokens.push(query);
  }
  if(truncated)return {kind:'ambiguous'};
  // Literal ILIKE cannot see another script. Compare only the complete assigned roster.
  const roster=await readChatNameRoster(search).catch(()=>null);
  if(!roster){
   const full=[...names].filter(([,name])=>questionWords.includes(` ${skeletonWords(name).join(' ')} `));
   return full.length===1?{kind:'choose',rows:full.map(([id,name])=>({id,name}))}:names.size?choose():{kind:'unavailable'};
  }
  completeRoster=roster;
  for(const token of requiredTokens)collect(matchingNameRows(roster,token));
  if(inflected)return names.size?choose():{kind:'none'};
  // A stop word with no matches was ordinary wording, not an unresolved identity.
  if(!requiredTokens.length)return await automatic();
  // The screen supplies only a search hint. Use the returned identity, never its name hint, as evidence.
  if(current&&!names.has(current.memberId)){
   const result=await search(current.memberName.normalize('NFKC').toLowerCase());
   if(result.kind!=='members')return {kind:result.kind==='refused'?'refused':'unavailable'};
   if(result.page.hasMore)return {kind:'ambiguous'};
   const row=result.page.rows.find(row=>row.id===current.memberId);
   if(!row)return {kind:'unavailable'};
   collect([row]);
  }
  // Only an entire display name occurring as consecutive words can identify a new record.
  const verified=[...names].filter(([,name])=>words(name).length&&questionWords.includes(` ${skeletonWords(name).join(' ')} `));
  if(verified.length>1)return choose();
  const explainedBy=new Map<string,string>();
  if(current)explainedBy.set(current.memberId,names.get(current.memberId)??'');
  if(verified.length===1){
   const [id,name]=verified[0],confirmation=await search(name.normalize('NFKC').toLowerCase());
   if(confirmation.kind!=='members')return {kind:confirmation.kind==='refused'?'refused':'unavailable'};
   collect(confirmation.page.rows);
   if(confirmation.page.hasMore)return {kind:'ambiguous'};
   const exact=confirmation.page.rows.filter(row=>skeletonWords(row.name??'').join(' ')===skeletonWords(name).join(' '));
   if(exact.length!==1||exact[0].id!==id)return choose();
   explainedBy.set(id,name);
  }
  // One identity must explain every token; covering separate pieces with different names is not enough.
  const explained=[...explainedBy].filter(([,name])=>requiredTokens.every(token=>words(token).every(word=>words(name).some(n=>same(n,word)))));
  if(explained.length!==1)return names.size?choose():{kind:'none'};
  const [id,name]=explained[0];
  return await automatic({memberId:id,memberName:name});
 }catch{return {kind:'unavailable'};}
}
