import {staffNameCases} from './fixtures/staff-name-cases';
import assert from 'node:assert/strict';
import {workspaceIntent,memberRecordIntent} from '@/lib/staff-zoe/home-intent';
// Selected-member commands are exact navigation, never a model question or a write.
for(const [text,kind] of [
 ['show him the plan','plan'],['show results for this member','results'],['show the report','gp'],['show labs','results'],
 ['покажи его результаты','results'],['покажи результаты','results'],['покажи план','plan'],['покажи его план','plan'],['покажи его отчёт','gp'],['покажи анализы','results'],
 ['ցույց տուր արդյունքները','results'],['ցույց տուր պլանը','plan'],['ցույց տուր նրա արդյունքները','results'],['ցույց տուր նրա պլանը','plan'],['ցույց տուր հաշվետվությունը','gp'],
] as const)assert.equal(memberRecordIntent(text),kind,text);
for(const text of ['show his results and explain the change','покажи его результаты и объясни','ցույց տուր արդյունքները և բացատրիր','show Anna the plan','show results for another member','why is his plan missing','approve the plan']){
 assert.equal(memberRecordIntent(text),null,text);
 assert.deepEqual(workspaceIntent(text),{kind:'unsupported'},text);
}
for(const text of ['покажи его результаты','покажи результаты','ցույց տուր արդյունքները','ցույց տուր նրա արդյունքները','show labs'])assert.deepEqual(workspaceIntent(text),{kind:'card',card:'results',query:''},text);

for(const text of ["show Anna's results",'show Anna’s results'])assert.deepEqual(workspaceIntent(text),{kind:'card',card:'results',query:'Anna'});
for(const text of ['show results','բացել արդյունքները','открыть результаты'])assert.deepEqual(workspaceIntent(text),{kind:'card',card:'results',query:''});
for(const text of ['open alerts','բացել ահազանգերը','открыть оповещения'])assert.deepEqual(workspaceIntent(text),{kind:'alerts'});
for(const [text,card] of [['review uploads','uploads'],['show safety holds','safety'],['open tasks','tasks'],['open consultation','consultation'],['open GP report','gp'],['show LDL goal','ldl']] as const)assert.deepEqual(workspaceIntent(text),{kind:'card',card,query:''});
for(const text of ['approve results','approve the draft','recommend a statin','clear safety holds'])assert.equal(workspaceIntent(text).kind,'unsupported','Typed requests never authorize a mutation');
assert.deepEqual(workspaceIntent('find Anna'),{kind:'members',query:'Anna'});
console.log('Doctor card commands: bounded navigation, three locales, named results, no typed approval passed');

for (const question of ['Who needs me first this morning?', 'Ով է այսօր իմ ուշադրության կարիքն ունենում', 'Кому я нужен в первую очередь сегодня?']) {
 assert.deepEqual(workspaceIntent(question), {kind:'today'}, 'Day questions open the saved waiting queue');
}
assert.deepEqual(workspaceIntent('How is her blood pressure changing?'), {kind:'unsupported'}, 'Member questions reach existing Doctor Zoe rather than name search');


// These catch lost plain-word navigation, wrong precedence and accidental record interception.
const plainWords = [
 ['Բարի լույս, Zoe։ Այսօր ումի՞ց սկսեմ, գիշերվանից շտապ բան կա՞','today'],
 ['кто срочный? что было ночью','today'],
 ['Кому нужна моя помощь первым?','today'], ['Кто мне нужен первым?','today'], ['Кому я нужна в первую очередь?','today'], ['Кому нужна моя помощь в первую очередь','today'],
 ['Ո՞ւմ է պետք իմ օգնությունը առաջինը','today'], ['Ում է պետք առաջինը','today'], ['Ո՞վ է առաջինը իմ ցուցակում','today'],
 ['how many need me now? alerts, lab reviews and plans separately','today'],
 ['anyone hasnt logged bp this week, and who is overdue','missing_bp'],
 ['Օրս փակենք։ Ի՞նչ մնաց իմ վրա, ո՞ր հաստատվածը դեռ չի հասել','today'],
 ['Good morning Zoe, who needs me first???','today'], ['Today!!!','today'], ['Այսօր։','today'], ['сегодня?','today'],
 ['please who is urgent today','today'], ['who is waiting overnight','today'],
 ['what needs attention now','today'], ['who do i start with today','today'],
 ['who urgently needs me','today'], ['who needs me frist','today'],
 ['доброе утро, кто ждёт меня','today'], ['слушай, с кого начать сегодня','today'],
 ['кому нужен я сегодня','today'], ['что было ночью','today'],
 ['кто срочно ждёт','today'], ['Բարի լույս, ով է շտապ','today'],
 ['ումից սկսեմ այսօր','today'], ['ով է սպասում ինձ','today'],
 ['ինչ կա գիշերվանից','today'], ['Ի՞նչ մնաց իմ վրա','today'],
 ['Please show alerts. What is waiting?','alerts'], ['show my alerts?','alerts'],
 ['слушай покажи оповещения','alerts'], ['открой все уведомления','alerts'],
 ['ցույց տուր ահազանգերը։','alerts'], ['բացիր բոլոր ահազանգերը','alerts'],
 ['who is overdue? and who hasnt logged bp this week','overdue'],
 ['please show overdue tasks','overdue'], ['кто просрочил','overdue'],
 ['покажи просроченные задачи','overdue'], ['ով է ուշացրել','overdue'],
 ['ցույց տուր ժամկետանց գործերը','overdue'],
 ['who hasnt logged bp this week?','missing_bp'], ['who did not record bp this week','missing_bp'], ['who has not logged blood pressure this week?','missing_bp'],
 ['anyone missing bp readings this week','missing_bp'], ['кто не записывал давление на этой неделе','missing_bp'],
 ['у кого нет замеров давления за неделю','missing_bp'], ['ով չի գրանցել ճնշումը այս շաբաթ','missing_bp'],
 ['ով այս շաբաթ ճնշում չի չափել','missing_bp'],

] as const;
for (const [text,kind] of plainWords) assert.deepEqual(workspaceIntent(text),{kind},text);
for (const [text,day] of [
 ['what did i approve yesterday?','yesterday'], ['what did I approve yesterday and what actually went out?','yesterday'],
 ['what have i sent today','today'], ['what did i approve','today'],
 ['Вчера что я одобрил и что реально ушло?','yesterday'], ['что я отправил сегодня','today'], ['что я одобрил','today'],
 ['երեկ ինչ եմ հաստատել','yesterday'], ['այսօր ինչ եմ ուղարկել','today'], ['ինչ եմ հաստատել','today'],
] as const) assert.deepEqual(workspaceIntent(text),{kind:'approvals_history',day},text);
const searches = [
 ['открой пациента с телефоном на 0104','0104'], ['phone (0104)','0104'], ['phone [01]-[04]','0104'], ['phone 0104. Who needs me?','0104'],
 ['please find phone +374 (99) 000-104','37499000104'], ['telephone 1234-5678','12345678'],
 ['number 123456789012345','123456789012345'], ['ending 01 04','0104'],
 ['last digits 0104','0104'], ['номер 0104','0104'], ['заканчивается на 0104','0104'],
 ['հեռախոս 0104','0104'], ['համար 0104','0104'], ['վերջին 0104','0104'],
 ['open the member whose phone ends in 0104','0104'], ['phone ends in 0104','0104'], ['open the member, whose phone ends in 0104','0104'], ['открой участника, телефон заканчивается на 0104','0104'], ['открой участника, у которого телефон оканчивается на 0104','0104'], ['բացիր անդամին, որի հեռախոսը վերջանում է 0104','0104'],
 ['0104','0104'], ["find O'Neil","O'Neil"], ['open O’Connor','O’Connor'], ['show my members?',''], ['իմ անդամները։',''], ['мои участники?',''], ['please show Anna?','Anna'], ['Good morning Zoe, open Lilit. Then show the queue','Lilit'],
 ['покажи Анну','Анну'], ['բացիր Աննա','Աննա'], ['ցույց տուր Աննա','Աննա'],
] as const;
for (const [text,query] of searches) assert.deepEqual(workspaceIntent(text),{kind:'members',query},text);
const recordQuestions = [
 'what did Anna send yesterday?', 'what did the member approve today?', 'what should I approve today?', 'what did I send Anna yesterday?', 'что Анна отправила вчера?', 'այսօր ինչ է ուղարկել Աննան', 'what is urgent for him?', 'urgent for him', 'who needs his labs first', 'who is waiting for her',
 'show this member', 'open this patient', 'what does he need now', 'what does she need now',
 'what is urgent for նա', 'ով է շտապ նրան', 'նրա ահազանգերը', 'այս անդամ շտապ', 'իրեն ինչ է պետք',
 'Кому нужна моя таблетка', 'кому нужна эта помощь первым делом ей', 'Ում է պետք Աննայի պլանը', 'Ում է պետք նրա ճնշումը առաջինը', 'что срочно ему', 'кто нужен ей', 'покажи его оповещения', 'что нужно он', 'что нужно она',
 'покажи её оповещения', 'этот пациент срочный', 'этого участника открой',
 'How is her blood pressure changing?', 'blood pressure', 'LDL', 'plan', 'adherence', 'why',
 'approve the draft', 'recommend a statin', 'Anna', 'Mariam Example',
 'Who needs my attention about Mariam Example?', 'Who needs a statin?',
 'What needs me to know about the record?', 'who needs urgent care for chest pain',
 'what is the urgent LDL plan for Anna', 'show blood pressure for Anna',
 'open another member', 'show another doctor member', 'покажи участника другой клиники',
 'Ցույց տուր մյուս կլինիկայի Արամ Սարգսյանին էլ, իմ ծանոթն է',
 'phone 104', 'открой пациента с телефоном на 104', 'համար 12', '123',
 'phone 1234567890123456', 'number of urgent members 1234', 'phone 0104 urgent', 'phone 0104 and LDL 180',
 'I wonder who needs attention because blood pressure is high',
 'No urgent alerts for Anna today', 'почему кто срочный после анализов',
 'find out why he is overdue', 'show who urgently needs a statin',
];
// Astra B-01 and B-02: a named member or a record question about a phone is never the queue or phone navigation.
for (const text of ['Anna. What is urgent?','Աննա, ով է շտապ','Анна, что срочно?','who is urgent? LDL for Anna','what did Anna send to phone 0104?','Աննան ինչ գրեց 0104 համարին','что Анна написала на телефон 0104?']) assert.deepEqual(workspaceIntent(text),{kind:'unsupported'},text);
for (const text of recordQuestions) assert.deepEqual(workspaceIntent(text),{kind:'unsupported'},text);
console.log(`Plain words: ${plainWords.length + searches.length} positive and ${recordQuestions.length} conservative negative phrases passed`);

for(const variants of staffNameCases)for(const name of variants)for(const query of [name,name.toLowerCase(),name.slice(0,-1)+'x']){
 for(const command of ['find','բացիր','открой'])assert.deepEqual(workspaceIntent(`${command} ${query}`),{kind:'members',query});
}
for(const query of ['Hayk-ի','Анне','Нареi','Hayk Թեստ'])assert.deepEqual(workspaceIntent(`find ${query}`),{kind:'members',query});
