/** Bounded navigation/read commands. No model interprets a cohort predicate or writes a clinical answer. */
export type DoctorCardKind='results'|'uploads'|'safety'|'tasks'|'consultation'|'gp'|'ldl'|'conversation'|'observations';
type SimpleKind='alerts'|'today'|'dashboard'|'bp'|'overdue'|'missing_bp'|'unsupported';
/** Preparation opens the existing doctor card. Saving and publication still need its buttons. */
export function prepareCarePlanIntent(raw:string):{query:string}|null{
 const q=raw.trim().replace(/[.!։]+$/u,'').replace(/[՞՜՛]/gu,'');
 const match=/^(?:please\s+)?(?:prepare|draft)\s+(?:a\s+|the\s+)?care plan(?:\s+for\s+(.+))?$/iu.exec(q)
  ??/^(?:пожалуйста[, ]+)?(?:подготовь|подготовить|составь|составить)\s+(?:черновик\s+)?план(?:а)?\s+(?:лечения|ухода)(?:\s+для\s+(.+))?$/iu.exec(q)
  ??/^(?:խնդրում եմ[, ]+)?(?:պատրաստիր|պատրաստել|կազմիր|կազմել)\s+խնամքի\s+պլան(?:ի\s+սևագիր|ը)?(?:\s+(.+?)\s+համար)?$/iu.exec(q);
 if(!match)return null;
 const query=(match[1]??'').trim();
 if(query&&(query.length>100||query.split(/\s+/u).length>4||! /^[\p{L}\p{M}][\p{L}\p{M}\s'’\-]*$/u.test(query)))return null;
 return {query};
}
export type WorkspaceIntent={[K in SimpleKind]:{kind:K}}[SimpleKind]|{kind:'approvals_history';day:'today'|'yesterday'}|{kind:'members';query:string}|{kind:'card';card:DoctorCardKind;query:string};
/** Exact read commands for the selected member in chat v2. Extra clauses stay record questions. */
export function memberRecordIntent(raw:string):'plan'|'results'|'gp'|null{
 const q=raw.trim().replace(/[?.։]+$/u,'').trim();
 const match=/^(?:show|open)\s+(?:(?:him|her)\s+)?(?:(?:the|his|her)\s+)?(care plan|plan|results|gp report|report|lab report|labs)(?:\s+for (?:this|the|selected) member)?$/iu.exec(q)
  ??/^(?:покажи|показать|открой|открыть)\s+(?:(?:его|её|ее)\s+)?(план|результаты|отчёт|отчет|лабораторный отчёт|лабораторный отчет|отчёт для врача|анализы)$/iu.exec(q)
  ??/^(?:ցույց տուր|բացիր|բացել)\s+(?:նրա\s+)?(պլանը|արդյունքները|հաշվետվությունը|բժշկի հաշվետվությունը|անալիզները)$/iu.exec(q);
 if(!match)return null;
 if(/^(?:care plan|plan|план|պլանը)$/iu.test(match[1]))return 'plan';
 return /report|отч[её]т|հաշվետվությունը/iu.test(match[1])?'gp':'results';
}
export function workspaceIntent(raw:string):WorkspaceIntent{
 const q=raw.trim();
 const record=memberRecordIntent(q);
 if(record&&record!=='plan')return {kind:'card',card:record,query:''};
 if(/^(?:(?:show|open) )?(?:alerts|ահազանգեր(?:ը)?|оповещения)$/iu.test(q)||/^(?:բացել ահազանգերը|открыть оповещения)$/iu.test(q))return {kind:'alerts'};
 const named=/^show\s+(.+?)['’]s\s+results$/iu.exec(q)??/^открыть результаты\s+(.+)$/iu.exec(q)??/^բացել\s+(.+?)(?:ի|ի՞) արդյունքները$/iu.exec(q);
 if(named)return {kind:'card',card:'results',query:named[1].trim()};
 const cards:[DoctorCardKind,RegExp][]=[
  ['conversation',/^(?:open conversation|բացել զրույցը|открыть разговор)$/iu],
  ['observations',/^(?:record blood pressure|record a note|գրանցել ճնշումը|գրանցել նշում|записать давление|записать заметку)$/iu],
  ['results',/^(?:(?:show|open) results|բացել արդյունքները|открыть результаты)$/iu],
  ['uploads',/^(?:(?:show|open|review) uploads|բացել վերբեռնումները|открыть загрузки)$/iu],
  ['safety',/^(?:(?:show|open) safety holds|բացել անվտանգության սահմանափակումները|открыть ограничения безопасности)$/iu],
  ['tasks',/^(?:(?:show|open) tasks|բացել առաջադրանքները|открыть задачи)$/iu],
  ['consultation',/^(?:(?:show|open) consultation|բացել խորհրդատվությունը|открыть консультацию)$/iu],
  ['gp',/^(?:(?:show|open) gp report|բացել բժշկի հաշվետվությունը|открыть отчёт для врача)$/iu],
  ['ldl',/^(?:(?:show|open) ldl goal|բացել ցխլ նպատակը|открыть цель лпнп)$/iu],
 ];
 for(const [card,pattern] of cards)if(pattern.test(q))return {kind:'card',card,query:''};
 if(/^(?:who needs (?:me|my attention)(?: first| now| most)?(?: this morning| today| now)?|who(?: should i see| is waiting for me| is waiting)(?: first| now| today)?|what needs (?:me|my attention)(?: first| now)?(?: today)?|ով է այսօր իմ ուշադրության կարիքն ունենում|кому я нужен в первую очередь сегодня|кому нужно моё внимание(?: сегодня| в первую очередь)?|кому нужно мое внимание(?: сегодня| в первую очередь)?|кто ждёт меня(?: сегодня)?|кто ждет меня(?: сегодня)?)\??$/iu.test(q))return {kind:'today'};
 if(/^(?:today|show (?:my )?(?:day|today)|այսօր|сегодня)$/iu.test(q))return {kind:'today'};
 if(/^(?:show (?:my )?dashboard|dashboard|վահանակ|панель)$/iu.test(q))return {kind:'dashboard'};
 if(/^(?:(?:(?:show|open) )?(?:(?:my|his|her|the member['’]s) )?(?:bp|blood pressure) (?:chart|graph)|ճնշման գրաֆիկ|график давления)\??$/iu.test(q))return {kind:'bp'};
 if(/^(?:who (?:is|are) overdue|show overdue(?: tasks)?|overdue|ժամկետանց|просроченные)$/iu.test(q))return {kind:'overdue'};
 if(/^(?:who hasn['’]t logged bp this week|who has not logged bp this week|ով չի գրանցել ճնշումն այս շաբաթ|кто не записал давление на этой неделе)\??$/iu.test(q))return {kind:'missing_bp'};
 if(/^(?:(?:show|list) (?:all )?my (?:patients|members)|my (?:patients|members)|իմ անդամները|мои участники)$/iu.test(q))return {kind:'members',query:''};
 return plainWorkspaceIntent(q);
}

// Exact shortcuts above keep their precedence. Plain words below describe only the
// doctor's list. Stems marked * allow common inflections, not arbitrary substrings.
const words = {
 en: {
  question:['who','whom','what','which','how many','anyone'],
  queue:['need','needs','first','frist','urgent','urgently','waiting','overnight','night','start','left'],
  allowed:['who','whom','what','which','how','many','anyone','need','needs','first','frist','urgent','urgently','waiting','overnight','night','start','left','is','are','do','i','me','my','attention','for','with','should','see','today','now','this','morning','was','happened','still'],
  alerts:['alerts','alert'], overdue:['overdue'],
  bp:['bp','blood pressure'], missing:['hasnt','has not','did not','missing','no'],
  history:['approved','approve','sent','send'], date:['yesterday','today'], selfHistory:['did i','have i','i approved','i sent'],
  historyAllowed:['what','which','did','have','i','approved','approve','sent','send','yesterday','today','and','really','actually','went','out'],
 },
 ru: {
  question:['кто','кому','с кого','что','у кого'],
  queue:['срочн*','нужен','нужна','нужно','нужны','ждёт','ждет','ночью','ночь','начать','осталось','перв*'],
  allowed:['кто','кому','с','кого','что','у','срочн*','нужен','нужно','ждёт','ждет','ночью','ночь','начать','осталось','было','сегодня','сейчас','я','мне','меня','моего','внимания','внимание','в','первую','очередь','нужна','нужны','моя','моей','помощь','помощи','перв*','на','мой','список'],
  alerts:['оповещ*','уведомлен*'], overdue:['просроч*'],
  bp:['давлен*','ад'], missing:['не','нет'],
  history:['одобрил*','утвердил*','отправил*','ушло'], date:['вчера','сегодня'], selfHistory:['я'],
  historyAllowed:['что','я','вчера','сегодня','одобрил*','утвердил*','отправил*','ушло','и','реально','уже'],
 },
 hy: {
  question:['ով','ում','ումի*','ումից','ինչ','որ'],
  queue:['շտապ','սկսեմ','կարիք*','սպասում','գիշեր*','մնաց','առաջին*'],
  allowed:['ով','ումի*','ումից','ինչ','որ','շտապ','սկսեմ','կարիք*','սպասում','գիշեր*','մնաց','է','են','կա','բան','այսօր','հիմա','ինձ','իմ','վրա','ուշադրության','օգնությունը','պետք','էլ','ում','առաջին*','ցուցակում'],
  alerts:['ահազանգ*'], overdue:['ժամկետանց','ուշաց*'],
  bp:['ճնշում*'], missing:['չի','չեն','չկա'],
  history:['հաստատել','ուղարկել','հաստատեցի','ուղարկեցի'], date:['երեկ','այսօր'], selfHistory:['եմ','հաստատեցի','ուղարկեցի'],
  historyAllowed:['ինչ','եմ','երեկ','այսօր','հաստատել','ուղարկել','հաստատեցի','ուղարկեցի','ու','և','իրականում'],
 },
} as const;
const greetings=['good morning zoe','good morning','hello zoe','hello','hi zoe','please','zoe','доброе утро','слушай','пожалуйста','բարի լույս','զոյա','օրս փակենք'];
const memberReferences=['he','him','his','she','her','this member','this patient','another member','other member','another doctor','other doctor','other clinic','another clinic','նա','նրան','նրա','այս անդամ*','իրեն','մյուս կլինիկ*','այլ անդամ*','он','она','ему','ей','его','её','ее','этот пациент*','этого участник*','другой клиник*','другого врач*','другого участник*'];
const clinicalWords=['results','report*','արդյունք*','հաշվետվությ*','результат*','отчёт*','отчет*','blood pressure','bp','lab*','ldl','plan*','adherence','why','statin*','record','about','ճնշում*','անալիզ*','լաբ*','ցխլ','պլան*','ինչու','давлен*','анализ*','лпнп','план*','привержен*','почему','статин*'];
// A phone request is navigation only when nothing else is asked ("what did Anna send to phone 0104?" is a record question).
const phoneWords=['open','show','find','search','patient','member','with','a','the','whose','phone','telephone','number','ending','ends','end','in','last','digits','of','is','on','открой','открыть','покажи','найди','пациента','участника','с','телефоном','телефон','номером','номер','на','заканчивающегося','заканчивается','оканчивается','которого','у','последними','цифрами','բացիր','բացել','գտիր','գտնել','անդամին','անդամ','հեռախոսահամարով','հեռախոսով','հեռախոս','համարով','համար','վերջին','թվերով','որի','հեռախոսը','վերջանում','է'];
// Work-queue vocabulary ("alerts, lab reviews and plans separately") is not a clinical topic when it appears next to a queue ask.
const queueTopics=['bp','blood pressure','ճնշում*','давлен*','lab*','plan*','анализ*','план*','լաբ*','պլան*','անալիզ*'];
const topicWords=clinicalWords.filter(word=>!queueTopics.includes(word));
const listCommands=['show','open','list','see','my','all','please','покажи','показать','открой','открыть','все','мои','список','ցույց','տուր','բացիր','բացել','բոլոր','իմ','գործ*','задач*','tasks'];
function matches(tokens:string[],phrase:string):boolean{
 const parts=phrase.split(' ');
 return tokens.some((_,i)=>parts.every((part,j)=>part.endsWith('*')?tokens[i+j]?.startsWith(part.slice(0,-1)):tokens[i+j]===part));
}
function has(tokens:string[],phrases:readonly string[]):boolean{return phrases.some(phrase=>matches(tokens,phrase));}
function only(tokens:string[],allowed:readonly string[]):boolean{return tokens.every(token=>has([token],allowed));}
function tokensOf(text:string):string[]{return text.toLowerCase().replace(/['’]/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/u);}
function plainWorkspaceIntent(raw:string):WorkspaceIntent{
 // Armenian question marks sit inside words. Apostrophes may be omitted in hasnt.
 let text=raw.replace(/[՞՜՛]/gu,'').trim();
 let again=true;
 while(again){
  again=false;
  for(const greeting of greetings){
   if(text.toLowerCase().startsWith(greeting)&&(!text[greeting.length]||/[\s\p{P}]/u.test(text[greeting.length]))){
    text=text.slice(greeting.length).replace(/^[\s\p{P}]+/u,'');again=true;break;
   }
  }
 }
 const all=tokensOf(text);
 if(has(all,memberReferences))return {kind:'unsupported'};
 // A clause that is only a capitalised name ("Anna. What is urgent?", "Աննա, ով է շտապ") makes the whole request about that member.
 const namedClause=(clause:string)=>/^\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,2}$/u.test(clause.trim())&&!has(tokensOf(clause),[...words.en.queue,...words.ru.queue,...words.hy.queue,'today','alerts','overdue','this','my','all','today','այսօր','сегодня']);
 const namesAMember=text.split(/[.!?։;,]+/u).some(namedClause);
 // "Open the member, his phone ends in 0104": commas inside one sentence do not split a phone request.
 const phoneSentence=text.replace(/[,;:]+/gu,' ').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu,'');
 if(!/[.!?։]/u.test(phoneSentence)){
  const tokens=tokensOf(phoneSentence),digits=phoneSentence.replace(/[\[\]]/gu,'').match(/(?:^|[^\p{L}])(?:phone|telephone|number|ending|last digits|телефон\p{L}*|номер|на|заканчивается|оканчивается|հեռախոս\p{L}*|համար|վերջին)\s*(?:(?:ending|ends|end|in|on|is|на|վերջանում|է|заканчивается|оканчивается)\s+)*[+()\s]*[\d][\d\s()-]*$/iu);
  if(digits&&!has(tokens,clinicalWords)&&tokens.every(token=>/^\d+$/u.test(token)||phoneWords.includes(token))){
   const query=digits[0].replace(/\D/gu,'');
   if(query.length>=4&&query.length<=15)return {kind:'members',query};
  }
 }
 // Examine asks in order. A later sentence cannot change the first matching ask.
 for(const clause of text.split(/[.!?։;,]+/u)){
  const clean=clause.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu,'');
  if(!clean)continue;
  const tokens=tokensOf(clean);
  const phoneText=clean.replace(/[\[\]]/gu,'');
  const phone=has(tokens,['phone','telephone','number','ending','last digits','телефон*','номер','на','заканчива*','հեռախոս*','համար','վերջին']);
  if(phone||/^[\d\s()\-+]+$/u.test(phoneText)){
   const digits=phoneText.match(/^(?:[+()\s\d-]+)$|(?:^|[^\p{L}])(?:phone|telephone|number|ending|last digits|телефон\p{L}*|номер|на|заканчивается|հեռախոս\p{L}*|համար|վերջին)\s*(?:(?:ending|ends|end|in|on|is|на|վերջանում|է|заканчивается|оканчивается)\s+)*[+()\s]*[\d][\d\s()-]*$/iu);
   if(digits&&!has(tokens,clinicalWords)&&tokens.every(token=>/^\d+$/u.test(token)||phoneWords.includes(token))){
    const query=digits[0].replace(/\D/gu,'');
    if(query.length>=4&&query.length<=15)return {kind:'members',query};
   }
   // A malformed phone request must not fall through to name search.
   if(/\d/u.test(clean))return {kind:'unsupported'};
  }
  if(has(tokens,['my members','my patients','իմ անդամները','мои участники'])&&only(tokens,[...listCommands,'members','patients','անդամները','участники']))return {kind:'members',query:''};
  if(tokens.length===1&&['today','այսօր','сегодня'].includes(tokens[0]))return {kind:'today'};
  for(const language of Object.values(words)){
   if(has(tokens,language.question)&&has(tokens,language.bp)&&has(tokens,language.missing)&&
    has(tokens,['week','շաբաթ*','недел*'])&&only(tokens,[...language.question,...language.bp,...language.missing,
     'blood','pressure','who','anyone','hasnt','has','not','did','logged','log','record','recorded','readings','this','week','missing','no','ով','այս','շաբաթ*','չի','չեն','գրանցել','չափել','кто','у','кого','не','нет','записал','записывал','замеров','на','этой','за','неделе','неделю']))return {kind:'missing_bp'};
   if(has(tokens,clinicalWords)||has(all,topicWords)||namesAMember)continue;
   if(has(tokens,language.history)&&has(tokens,language.question)&&has(tokens,language.selfHistory)&&only(tokens,language.historyAllowed))return {kind:'approvals_history',day:has(tokens,['yesterday','երեկ','вчера'])?'yesterday':'today'};
   if(has(tokens,language.overdue)&&only(tokens,[...language.overdue,...language.question,...listCommands,'is','are','է','են','ով']))return {kind:'overdue'};
   if(has(tokens,language.alerts)&&only(tokens,[...language.alerts,...listCommands]))return {kind:'alerts'};
   if(has(tokens,language.question)&&has(tokens,language.queue)&&only(tokens,language.allowed))return {kind:'today'};
  }
  // Name searches stay bounded navigation, never a clinical question or a cohort predicate.
  if(has(tokens,clinicalWords))return {kind:'unsupported'};
  const search=/^(?:find|search|open|show|գտնել|բացել|բացիր|ցույց տուր|найти|открыть|открой|покажи)\s+(?:(?:member|patient|участника|пациента|անդամին)\s+)?(.+)$/iu.exec(clean);
  if(search&&search[1].split(/\s+/u).length<=4&&/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(search[1])&&
   !has(tokens,['who','what','which','кто','что','ով','ինչ','urgent','срочн*','շտապ']))return {kind:'members',query:search[1]};
 }
 return {kind:'unsupported'};
}
