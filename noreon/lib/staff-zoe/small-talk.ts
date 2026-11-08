import type {L} from './contracts';

/** Plain chat that is not a question about a record: a greeting, "can you talk", "what can you do", thanks, goodbye.
 * The whole message must be one of these phrases (a greeting may lead another one). Anything with a name, a value or a
 * request in it stays an ordinary question. The words of the reply are fixed copy, never the model's, so it costs nothing,
 * reads no record and sends nothing. */
export type SmallTalk='hello'|'talk'|'how'|'about'|'thanks'|'bye'|'ack';

const PHRASES:Record<SmallTalk,readonly string[]>={
 hello:[
  'hello','hi','hey','hi there','hello there','hey there','good morning','good afternoon','good evening','good day','greetings',
  'привет','здравствуйте','здравствуй','приветствую','добрый день','доброе утро','добрый вечер','доброго дня','хай',
  'բարև','բարև ձեզ','բարեւ','բարեւ ձեզ','բարի լույս','բարի օր','բարի երեկո','ողջույն','ողջույն ձեզ',
 ],
 talk:[
  'can you talk','can you speak','are you there','are you here','are you alive','are you awake','can you hear me','do you hear me','is anyone there','is anybody there','anyone there',
  'ты здесь','вы здесь','ты тут','вы тут','ты меня слышишь','вы меня слышите','ты можешь говорить','вы можете говорить','можешь говорить','можете говорить','ты можешь разговаривать','ты умеешь говорить','ты живая','ты на связи','вы на связи',
  'խոսում ես','խոսում եք','կարող ես խոսել','կարող եք խոսել','դու այստեղ ես','դուք այստեղ եք','այստեղ ես','այստեղ եք','լսում ես ինձ','լսում եք ինձ','լսում ես','կապի մեջ ես',
 ],
 how:[
  'how are you','how are you doing','how is it going',"how's it going",'hows it going','how are you today','how is it going today','how do you do','how are things',
  'как дела','как ты','как вы','как поживаешь','как поживаете','как жизнь',
  'ոնց ես','ոնց եք','ինչպես ես','ինչպես եք','ինչ կա','ինչ կա չկա','ինչպես են գործերդ','ինչպես են գործերը',
 ],
 about:[
  'what can you do','what do you do','who are you','what are you','what is this','what is zoe','how can you help','how can you help me','what can you help with','what can you help me with','what can i ask','what can i ask you','what can i do here','what can i say','how does this work','how do i use this','how do i use you','help','help me','what are you for','tell me about yourself','introduce yourself',
  'что ты умеешь','что вы умеете','что ты можешь','что вы можете','что ты можешь делать','кто ты','кто вы','что ты такое','чем ты можешь помочь','чем можешь помочь','чем вы можете помочь','чем можете помочь','чем ты занимаешься','что ты делаешь','помощь','помоги','помоги мне','что можно спросить','что можно у тебя спросить','что тут можно делать','как тобой пользоваться','как пользоваться','что это','представься','расскажи о себе',
  'ինչ կարող ես անել','ինչ կարող եք անել','ինչ ես անում','ինչ ես դու','ով ես դու','ով ես','ով եք դուք','ինչ է սա','ինչով կարող ես օգնել','ինչով կարող ես ինձ օգնել','ինչով կարող եք օգնել','ինչ կարող եմ հարցնել','ինչ կարելի է հարցնել','ինչ կարող եմ անել այստեղ','ինչպես օգտվել','ինչպես օգտվեմ','օգնիր','օգնիր ինձ','օգնություն','ներկայացիր քեզ','պատմիր քո մասին',
 ],
 thanks:[
  'thanks','thank you','thank you very much','thanks a lot','many thanks','thx','ok thanks','ok thank you','okay thanks','great thanks','great thank you','perfect thanks','perfect thank you','got it thanks','cheers','much appreciated',
  'спасибо','спасибо большое','большое спасибо','благодарю','спс','ок спасибо','хорошо спасибо','отлично спасибо','понял спасибо','понятно спасибо',
  'շնորհակալություն','շնորհակալ եմ','շատ շնորհակալ եմ','շատ շնորհակալություն','մերսի','լավ շնորհակալություն','լավ շնորհակալ եմ','հասկացա շնորհակալություն',
 ],
 bye:[
  'bye','goodbye','good bye','see you','see you later','see you tomorrow','good night','have a good day','have a nice day','that is all','thats all',"that's all",'that will be all','nothing else','talk later','talk to you later',
  'пока','до свидания','до встречи','до завтра','всего доброго','всего хорошего','доброй ночи','спокойной ночи','хорошего дня','на сегодня всё','на сегодня все','это всё','это все','больше ничего',
  'ցտեսություն','ցտես','առայժմ','հաջողություն','գիշերվա բարի','բարի գիշեր','մինչ նոր հանդիպում','բարի օր ձեզ','լավ օր','էսքանը','դա ամենը','այսքանը','ուրիշ բան պետք չէ',
 ],
 ack:[
  'ok','okay','great','perfect','got it','understood','alright','all right','fine','sounds good','good',
  'ок','окей','хорошо','понятно','понял','поняла','ясно','отлично','ладно','отлично понятно',
  'լավ','լավ է','օկ','հասկացա','պարզ է','հիանալի','ապրես','օքեյ',
 ],
};

const BY_PHRASE=new Map<string,SmallTalk>(Object.entries(PHRASES).flatMap(([kind,list])=>list.map(p=>[p,kind as SmallTalk] as const)));
const GREETINGS=[...PHRASES.hello].sort((a,b)=>b.length-a.length);
// Her name, and a word of address, may sit anywhere in the message without changing what it is.
const ADDRESS=new Set(['zoe','zoya','зоя','зоуи','զոյա','զոյան','զոյայ','dear','please','pls','пожалуйста','խնդրում','եմ','ջան']);
const ADDRESS_ONLY=new Set(['zoe','zoya','зоя','зоуи','զոյա','զոյայ','dear','please','pls','пожалуйста','ջան']);

const clean=(raw:string)=>raw.normalize('NFKC').toLocaleLowerCase().replace(/ё/gu,'е').replace(/[’‘`´]/gu,"'")
 .replace(/[՚-՟]/gu,'').replace(/[^\p{L}\p{M}\p{N}']+/gu,' ').trim();

export function smallTalk(raw:string):SmallTalk|null{
 if(raw.length>80)return null;
 const words=clean(raw).split(' ').filter(w=>w&&!ADDRESS_ONLY.has(w));
 if(!words.length||words.length>8)return null;
 const text=words.join(' ');
 const direct=BY_PHRASE.get(text);
 if(direct)return direct;
 // "Hello, what can you do": a greeting leads another phrase. Only a phrase of its own may follow it.
 for(const greeting of GREETINGS){
  if(!text.startsWith(`${greeting} `))continue;
  const rest=BY_PHRASE.get(text.slice(greeting.length+1));
  if(rest&&rest!=='ack')return rest;
 }
 return null;
}

type Copy=readonly [string,string,string];
const pick=(l:L,c:Copy)=>l==='hy'?c[1]:l==='ru'?c[2]:c[0];

const READY:Copy=['Hello. I am here and ready.','Բարև ձեզ։ Այստեղ եմ և պատրաստ եմ օգնել։','Здравствуйте. Я здесь и готова помочь.'];
const TALK:Copy=['Yes, I am here and I can talk.','Այո, այստեղ եմ և կարող եմ խոսել։','Да, я здесь и могу говорить.'];
const HOW:Copy=['I am ready to help.','Պատրաստ եմ օգնել։','Готова помогать.'];
const THANKS:Record<'doctor'|'nurse',Copy>={
 doctor:['You are welcome. Ask me when you need the next member.','Խնդրեմ։ Գրեք, երբ հաջորդ անդամին պետք լինի։','Пожалуйста. Пишите, когда понадобится следующий участник.'],
 nurse:['You are welcome. Ask me when you need the next member.','Խնդրեմ։ Գրեք, երբ հաջորդ անդամին պետք լինի։','Пожалуйста. Пишите, когда понадобится следующий участник.'],
};
const BYE:Copy=['Goodbye. Your queue and your members’ records are here whenever you need them.','Ցտեսություն։ Ձեր հերթը և անդամների գրառումները այստեղ են, երբ պետք լինեն։','До свидания. Ваша очередь и записи участников здесь, когда понадобятся.'];
const ACK:Copy=['Ok. I am here when you need anything else.','Լավ։ Այստեղ եմ, երբ ինչ-որ բան պետք լինի։','Хорошо. Я здесь, если что-то понадобится.'];

const ABOUT:Record<'doctor'|'nurse',Copy>={
 doctor:['I am Zoe, Noreon’s AI assistant for your members. I read their records and show what is there, with the date and the source. I never approve, send or change anything myself: you do.',
  'Ես Զոյան եմ՝ Noreon-ի արհեստական բանականությամբ օգնականը ձեր անդամների համար։ Կարդում եմ նրանց գրառումները և ցույց տալիս այն, ինչ կա՝ ամսաթվով և աղբյուրով։ Ես ինքս ոչինչ չեմ հաստատում, չեմ ուղարկում և չեմ փոխում. դա անում եք դուք։',
  'Я Zoe, ИИ-помощник Noreon для ваших участников. Я читаю их записи и показываю то, что в них есть, с датой и источником. Сама я ничего не одобряю, не отправляю и не меняю: это делаете вы.'],
 nurse:['I am Zoe, Noreon’s AI assistant for your members’ care. I read their records and show what is there, with the date and the source. I never send or change anything myself: you do.',
  'Ես Զոյան եմ՝ Noreon-ի արհեստական բանականությամբ օգնականը ձեր անդամների խնամքի համար։ Կարդում եմ նրանց գրառումները և ցույց տալիս այն, ինչ կա՝ ամսաթվով և աղբյուրով։ Ես ինքս ոչինչ չեմ ուղարկում և չեմ փոխում. դա անում եք դուք։',
  'Я Zoe, ИИ-помощник Noreon для ухода за вашими участниками. Я читаю их записи и показываю то, что в них есть, с датой и источником. Сама я ничего не отправляю и не меняю: это делаете вы.'],
};
const CAN:Record<'doctor'|'nurse',Copy>={
 doctor:['I can show who needs you today, urgent alerts, a member’s blood pressure, results, plan and messages, and what you approved recently. If you type “reply to him: …”, I put your exact words in the reply box for you to check and send.',
  'Կարող եմ ցույց տալ, թե ում է այսօր պետք ձեր օգնությունը, շտապ ահազանգերը, անդամի ճնշումը, արդյունքները, պլանը և հաղորդագրությունները, ինչպես նաև թե ինչ եք հաստատել վերջերս։ Եթե գրեք «պատասխանիր իրեն՝ …», ձեր ճշգրիտ խոսքերը կդնեմ պատասխանի դաշտում՝ ստուգելու և ուղարկելու համար։',
  'Я могу показать, кому сегодня нужна ваша помощь, срочные оповещения, давление, результаты, план и сообщения участника, а также что вы одобрили недавно. Если напишете «ответь ему: …», я помещу ваши слова в поле ответа точно как есть, чтобы вы проверили и отправили.'],
 nurse:['I can show who needs a visit or follow-up, a member’s readings, medicines and notes, and the work open for you. A reading you type becomes a card first and is saved only when you confirm. I do not prescribe, change a dose or diagnose: those stay with the doctor.',
  'Կարող եմ ցույց տալ, թե ում է պետք այց կամ հետևում, անդամի ցուցանիշները, դեղերը և գրառումները, ինչպես նաև ձեր բաց խնդիրները։ Ձեր գրած ցուցանիշը սկզբում դառնում է քարտ և պահվում է միայն ձեր հաստատումից հետո։ Ես դեղ չեմ նշանակում, դեղաչափ չեմ փոխում և ախտորոշում չեմ դնում. դրանք մնում են բժշկին։',
  'Я могу показать, кому нужен визит или контроль, показатели, лекарства и заметки участника, а также открытые у вас задачи. Показатель, который вы напишете, сначала становится карточкой и сохраняется только после вашего подтверждения. Я не назначаю лекарства, не меняю дозу и не ставлю диагноз: это остаётся за врачом.'],
};
const TRY:Record<'doctor'|'nurse',Copy>={
 doctor:['Try: “Who needs me”, “What did I approve yesterday” or “Show Anna”.','Փորձեք՝ «Ո՞ւմ է պետք իմ օգնությունը», «Երեկ ինչ եմ հաստատել» կամ «Ցույց տուր Աննա»։','Попробуйте: «Кому нужна моя помощь», «Что я одобрил вчера» или «Покажи Анну».'],
 nurse:['Try: “What do I have today”, “Who has not logged BP this week” or “Show Anna”.','Փորձեք՝ «Ինչ ունեմ այսօր», «Ով չի գրանցել ճնշումը այս շաբաթ» կամ «Ցույց տուր Աննա»։','Попробуйте: «Что у меня сегодня», «Кто не записывал давление на этой неделе» или «Покажи Анну».'],
};

/** The reply lines, one paragraph each. */
export function smallTalkLines(kind:SmallTalk,role:'doctor'|'nurse',l:L):string[]{
 const can=pick(l,CAN[role]),example=pick(l,TRY[role]);
 switch(kind){
  case 'hello':return [pick(l,READY),can,example];
  case 'talk':return [pick(l,TALK),can,example];
  case 'how':return [pick(l,HOW),can,example];
  case 'about':return [pick(l,ABOUT[role]),can,example];
  case 'thanks':return [pick(l,THANKS[role])];
  case 'bye':return [pick(l,BYE)];
  case 'ack':return [pick(l,ACK)];
 }
}
