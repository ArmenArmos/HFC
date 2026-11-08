import assert from 'node:assert/strict';
import {PDE5_NITRATE_CATEGORICAL,guardPde5NitrateReply,pde5NitrateContext} from '../lib/zoe/pde5-nitrate';
import {healthReplyPrompt} from '../lib/zoe/health-answer';
import type {ReplyLanguage} from '../lib/zoe/provider';

let checks=0,positiveContexts=0,negativeContexts=0,rejectedReplies=0;
const context=(latest:string,earlier:string[]=[],medicines:string[]=[])=>pde5NitrateContext(latest,{earlier,medicines});
const yes=(latest:string,earlier:string[]=[],medicines:string[]=[])=>{assert.equal(context(latest,earlier,medicines),true,latest);checks++;positiveContexts++;};
const no=(latest:string,earlier:string[]=[],medicines:string[]=[])=>{assert.equal(context(latest,earlier,medicines),false,latest);checks++;negativeContexts++;};
// Drug classes, generics and brands in the four supported input scripts.
for(const drug of ['sildenafil','tadalafil','vardenafil','avanafil','Viagra','Cialis','Levitra','Spedra','PDE5 inhibitor','силденафил','тадалафил','варденафил','аванафил','Виагра','Сиалис','Левитра','սիլդենաֆիլ','տադալաֆիլ','վարդենաֆիլ','ավանաֆիլ','վիագրա','սիալիս','լևիտրա','լեվիտրա','sildenaphil','sildenafil@','SILDENAFIL'])yes(`Can I take ${drug} with nitroglycerin?`);
for(const nitrate of ['nitroglycerin','nitroglycerine','nitro spray','GTN','glyceryl trinitrate','isosorbide mononitrate','isosorbide dinitrate','Imdur','Isoket','nitrates','нитроглицерин','нитроспрей','изосорбид','нитраты','նիտրոգլիցերին','նիտրատ','nitroglicerin','nitroglicerin sprey','nitrater','իզոսորբիդ','izosorbid','nitroglitserin'])yes(`sildenafil ${nitrate}`);
for(const [latest,earlier,medicines] of [
 ['Can I take Cialis?',['I use nitroglycerin'],[]],
 ['Can I use nitro spray?',['I took sildenafil yesterday'],[]],
 ['Can I take tadalafil?',[],['Isosorbide mononitrate']],
 ['Можно Виагру?',[],['Нитроглицерин']],
 ['Կարո՞ղ եմ սիալիս ընդունել',[],['Նիտրոգլիցերին']],
 ['karox em viagra xmel',[],['nitroglicerin']],
 ['Can I take them together?',['I use Imdur','I bought sildenafil'],[]],
 ['What if I wait 48 hours?',['I take nitroglycerin','I want Cialis'],[]],
 ['А если через сутки?',['Принимаю нитроглицерин','Купил силденафил'],[]],
 ['Իսկ միասին կարելի՞ է',['Նիտրոգլիցերին եմ ընդունում','Սիալիս ունեմ'],[]],
 ['isk miasin kareli e',['nitroglicerin em xmum','viagra unem'],[]],
] as [string,string[],string[]][])yes(latest,earlier,medicines);
for(const latest of ['Thanks','What is LDL?','How should I measure blood pressure?','Спасибо','Ի՞նչ է խոլեստերինը','shnorhakalutyun','What if I drink coffee after lunch?'])no(latest,['I took sildenafil','I have nitroglycerin']);
for(const latest of ['Can I take sildenafil?','Can I use nitroglycerin?','I take amlodipine','My blood pressure is high','I ate nitrate-rich vegetables','This is a Viagra advertisement'])no(latest);
no('Can I take aspirin?',['I take sildenafil'],['nitroglycerin']);
no('Can I take them together?',['I take amlodipine'],['sildenafil']);
no('sildenafilnitroglycerin');

// R3: a correct first sentence cannot license a contradictory continuation, in any script.
const contradictions=[
 'Taking one tomorrow is safe.',
 'They can be combined safely under supervision.',
 'In most cases this combination should be avoided.',
 'You can take the second medicine later.',
 'It is safe on a different day.',
 'It is fine to use a small dose.',
 'With a doctor\'s supervision you may combine them.',
 'After 24 hours you can take it.',
 'Wait two days, then take the other medicine.',
 'There is a safe window between doses.',
 'Taking half a tablet makes it safe.',
 'Your doctor can give permission to take them together.',
 'Tomorrow morning the combination is safe.',
 'The combination is okay if you feel well.',
 'A low dose is acceptable.',
 'Taking them separately makes it safe.',
 'Combining them is allowed with monitoring.',
 'They are safe when used carefully.',
 'С разрешения врача принимать их вместе безопасно.',
 'Завтра можно принять второе лекарство.',
 'Позже принимать их безопасно.',
 'Через сутки можно.',
 'В другой день это безопасно.',
 'Небольшая доза допустима.',
 'Под наблюдением врача можно сочетать.',
 'Как правило, это нежелательно.',
 'Можно принимать с осторожностью.',
 'Через два дня сочетание безопасно.',
 'Вместе можно, если врач разрешил.',
 'Это нормально при маленькой дозе.',
 'Принимать их разрешается при контроле давления.',
 'Утром следующего дня уже безопасно.',
 'Խմել վաղը անվտանգ է։',
 'Բժշկի հսկողությամբ կարելի է համատեղել։',
 'Հիմնականում խորհուրդ չի տրվում։',
 'Ավելի ուշ կարող եք ընդունել։',
 'Մեկ այլ օր անվտանգ է։',
 'Փոքր դոզայով կարելի է։',
 '24 ժամ հետո կարող եք ընդունել։',
 'Բժշկի թույլտվությամբ անվտանգ է։',
 'Մի քանի օր անց կարելի է խմել։',
 'Կարելի է ընդունել զգուշությամբ։',
 'Ցածր դոզան թույլատրելի է։',
 'Եթե լավ եք զգում, անվտանգ է։',
 'Zavtra mozhno prinimat.',
 'Pozzhe eto bezopasno.',
 'Cherez dva chasa mozhno.',
 'Pod nablyudeniem vracha mozhno sochetat.',
 'Malenkaya doza dopustima.',
 'V drugoy den eto bezopasno.',
 'Vaghy kareli e xmel.',
 'Bzhshki hskoghutyamb anvtang e.',
 'Mi qani zham heto kareli e.',
 'Poqr dozayov kareli e.',
 'Aveli ush karox eq yndunel.',
 'Mek ayl or anvtang e.',
 // Unknown paraphrases also fail closed, rather than relying on an exhaustive permission dictionary.
 'Spacing the pills apart removes the concern.',
 'Разделение приёмов решает проблему.',
 'Ընդունումները բաժանելը լուծում է խնդիրը։',
];
let contradictoryReplies=0,legitimateReplies=0;
for(const language of ['en','ru','hy'] as const)for(const continuation of contradictions){
 const reply=`${PDE5_NITRATE_CATEGORICAL[language][0]}. ${continuation}`;
 assert.deepEqual(guardPde5NitrateReply(reply,language,true),['health.pde5_nitrate_missing_warning'],reply);
 checks++;rejectedReplies++;contradictoryReplies++;
}
const legitimate:Record<ReplyLanguage,readonly string[]>={
 en:[
  'Ask your doctor first.','Ask your pharmacist first.','Speak to your doctor.','Talk to your pharmacist.',
  'Contact your doctor.','Check with your pharmacist.','Consult your doctor before taking either medicine.',
  'Please ask your doctor about this combination.','Call 103 now.','Please call 103 immediately.',
  'If you feel dizzy, call 103.','If you feel faint, call 103 now.',
  'If you have chest pain, call 103 immediately.','If you have trouble breathing, call 103 now.',
  'If both were taken and you feel dizzy, call 103.','This combination can cause dangerously low blood pressure.',
  'Do not take either medicine until you have spoken to your doctor.','There is no safe window.',
 ],
 ru:[
  'Спросите своего врача.','Спросите фармацевта.','Обратитесь к врачу.','Обратитесь к своему фармацевту.',
  'Проконсультируйтесь с врачом.','Поговорите с фармацевтом.','Сначала спросите врача.',
  'Сначала обратитесь к фармацевту.','Звоните 103 сейчас.','Позвоните 103 немедленно.',
  'Если кружится голова, звоните 103.','Если теряете сознание, звоните 103 сейчас.',
  'Если болит грудь, позвоните 103 немедленно.','Если трудно дышать, звоните 103 сейчас.',
  'Если уже приняли оба лекарства и кружится голова, звоните 103.','Это сочетание может опасно снизить давление.',
  'Не принимайте ни одно из этих лекарств до разговора с врачом.','Безопасного интервала нет.',
 ],
 hy:[
  'Հարցրեք ձեր բժշկին։','Հարցրեք դեղագործին։','Դիմեք բժշկին։','Դիմեք ձեր դեղագործին։',
  'Խորհրդակցեք բժշկի հետ։','Խորհրդակցեք ձեր դեղագործի հետ։','Նախ հարցրեք բժշկին։',
  'Նախ դիմեք դեղագործին։','Զանգահարեք 103 հիմա։','Զանգահարեք 103 անմիջապես։',
  'Եթե գլխապտույտ ունեք, զանգահարեք 103։','Եթե ուշագնաց եք լինում, զանգահարեք 103 հիմա։',
  'Եթե կրծքավանդակի ցավ ունեք, զանգահարեք 103 անմիջապես։','Եթե դժվար եք շնչում, զանգահարեք 103 հիմա։',
  'Եթե արդեն ընդունել եք երկուսն էլ և գլխապտույտ ունեք, զանգահարեք 103։','Այս համակցությունը կարող է վտանգավոր իջեցնել ճնշումը։',
  'Մի ընդունեք այս դեղերից որևէ մեկը մինչև բժշկի հետ խոսելը։','Անվտանգ ընդմիջում չկա։',
 ],
};
for(const language of ['en','ru','hy'] as const)for(const continuation of legitimate[language]){
 const reply=`${PDE5_NITRATE_CATEGORICAL[language][0]}. ${continuation}`;
 assert.deepEqual(guardPde5NitrateReply(reply,language,true),[],reply);checks++;legitimateReplies++;
}

for(const language of ['en','hy','ru'] as ReplyLanguage[]){
 const phrases=PDE5_NITRATE_CATEGORICAL[language];
 assert.ok(phrases.length>0);checks++;
 for(const phrase of phrases){
  assert.deepEqual(guardPde5NitrateReply(phrase,language,true),[]);checks++;
  assert.deepEqual(guardPde5NitrateReply(phrase.toUpperCase(),language,true),[]);checks++;
  assert.deepEqual(guardPde5NitrateReply(`${phrase}։`,language,true),[]);checks++;
  for(const other of ['en','hy','ru'] as ReplyLanguage[])if(other!==language){assert.notDeepEqual(guardPde5NitrateReply(phrase,other,true),[]);checks++;rejectedReplies++;}
 }
 for(const phrase of phrases)for(const unsafe of [`Usually ${phrase.toLowerCase()}.`,`It is not true that ${phrase.toLowerCase()}.`,`"${phrase}."`,`«${phrase}.»`, `'Quoted policy. ${phrase}.'`, `"\n${phrase}.\n"`, `\`\`\`\n${phrase}.\n\`\`\``,`${phrase}. But after 24 hours you can take them.`,`${phrase}. Через сутки можно.`,`${phrase}. Через день можно.`,`${phrase}. Wait 24 hrs.`,`${phrase}. 24 ժամ հետո կարելի է։`]){
  assert.deepEqual(guardPde5NitrateReply(unsafe,language,true),['health.pde5_nitrate_missing_warning'],unsafe);checks++;rejectedReplies++;
 }
 const safeConditional={en:'If both were taken and you feel dizzy, call 103.',ru:'Если уже приняли оба лекарства и кружится голова, звоните 103.',hy:'Եթե արդեն ընդունել եք երկուսն էլ և գլխապտույտ ունեք, զանգահարեք 103։'}[language];
 assert.deepEqual(guardPde5NitrateReply(`${phrases[0]}. ${safeConditional}`,language,true),[]);checks++;
 for(const reply of ['Ask your doctor first.','It can lower blood pressure.','Wait 24 hours and ask your pharmacist.','Do not combine them unless your doctor says so.','Будьте осторожны.','Խորհրդակցեք բժշկի հետ։']){
  assert.deepEqual(guardPde5NitrateReply(reply,language,true),['health.pde5_nitrate_missing_warning']);checks++;rejectedReplies++;
  assert.deepEqual(guardPde5NitrateReply(reply,language,false),[]);checks++;
 }
}
for(const style of ['base','coach','coach-first'] as const)for(const split of [false,true]){
 const prompt=healthReplyPrompt(style,split);
 for(const term of ['PDE5','first lines','not to take either until the doctor has been asked','dangerous drop in blood pressure','whatever the time gap','before taking either','dizziness, fainting, shortness of breath or chest pain','103']){assert.ok(prompt.includes(term),term);checks++;}
 for(const phrases of Object.values(PDE5_NITRATE_CATEGORICAL))for(const phrase of phrases){assert.ok(prompt.includes(phrase),phrase);checks++;}
}
console.log(`Zoe PDE5 + nitrate: ${checks} checks passed; ${positiveContexts} contexts accepted, ${negativeContexts} unrelated contexts rejected, ${rejectedReplies} unsafe/wrong-language replies rejected (${contradictoryReplies} contradictory), ${legitimateReplies} legitimate continuations accepted.`);
