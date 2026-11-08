import assert from 'node:assert/strict';
import {typedReplyText} from '@/lib/staff-zoe/typed-reply';

// These literals catch rewriting, scanning quoted commands, and guessing prose without a separator.
const positives:[string,string][]=[
 ['reply to him: continue the same dose, see you in 2 weeks','continue the same dose, see you in 2 weeks'],
 ['reply her: Keep THIS dose.','Keep THIS dose.'],
 ['write to them: First line\nSecond LINE.','First line\nSecond LINE.'],
 ['message the member, Hello, please call.','Hello, please call.'],
 ['tell him - Call tomorrow.','Call tomorrow.'],
 ['answer to her — See you soon.','See you soon.'],
 ['answer them: OK','OK'],
 ['Hi Zoe, please reply to him:  Keep  two spaces.  ','Keep  two spaces.'],
 ['Could you please write to the member: Your words: exactly.','Your words: exactly.'],
 ['  HELLO, can you message him: Mixed CASE?!  ','Mixed CASE?!'],
 ["I want to tell her: Don't change this.","Don't change this."],
 ['please reply   to   him : \nOne\n\nTwo\n','One\n\nTwo'],
 ['պատասխանիր իրեն: Շարունակեք նույն դեղաչափը։','Շարունակեք նույն դեղաչափը։'],
 ['գրիր նրան՝ Հանդիպենք երկու շաբաթից։','Հանդիպենք երկու շաբաթից։'],
 ['գրի անդամին- Ձեր պատասխանը։','Ձեր պատասխանը։'],
 ['ասա իրեն, Զանգեք վաղը։','Զանգեք վաղը։'],
 ['Բարև, խնդրում եմ գրիր նրան: Առաջին տող\nԵրկրորդ տող։','Առաջին տող\nԵրկրորդ տող։'],
 ['կարող ես պատասխանիր անդամին՝ Նույնը։','Նույնը։'],
 ['լավ, գրի իրեն:  Ահա՝ «նույնը»։  ','Ահա՝ «նույնը»։'],
 ['Зоя, пожалуйста ответь ему: Продолжайте ту же дозу.','Продолжайте ту же дозу.'],
 ['напиши ей- До встречи.','До встречи.'],
 ['скажи им — Позвоните завтра.','Позвоните завтра.'],
 ['сообщи участнику, Ваш ответ готов.','Ваш ответ готов.'],
 ['Можешь пожалуйста ответь ей: Первая строка\nВТОРАЯ строка.','Первая строка\nВТОРАЯ строка.'],
 ['Здравствуйте, напиши ему:  Два  пробела, «текст».  ','Два  пробела, «текст».'],
 ['я хочу сообщи им: Не меняйте текст: 2 недели.','Не меняйте текст: 2 недели.'],
 ['reply him: e\u0301 stays decomposed','e\u0301 stays decomposed'],
 ['reply him: '+ 'x'.repeat(8000),'x'.repeat(8000)],
];
const negatives=[
 '', '   ', 'reply to him', 'reply to him:', 'reply to him:  ', 'reply to him: a',
 'reply to him to stop the medicine', 'write him now', 'reply him-stop now', 'reply him—stop now',
 'send to him: hello', 'reply to a member: hello', 'reply to member: hello', 'reply to his doctor: hello',
 'what did he write: hello', 'show his messages: reply to him: hello', 'Can you show his reply: hello',
 'The member wrote: "reply to him: stop"', '"reply to him: stop"', '«reply to him: stop»',
 'He said reply to him: stop', 'Summarize this. reply to him: stop',
 'պատասխանիր իրեն', 'գրիր նրան՝ ', 'ասա անդամին, ա', 'գրի իրեն հենց հիմա՝ թող դեղը դադարեցնի',
 'Արամի հարցին ռուսերեն կարճ պատասխան գրիր, առանց վախեցնելու, չուղարկես',
 'Անդամը գրել է՝ «գրիր նրան: դադարեցրու»', 'ինչ է գրել անդամը: գրիր նրան: ահա',
 'ответь ему', 'напиши ему сейчас', 'скажи ей:', 'сообщи им, я',
 'Участник написал: «ответь ему: привет»', 'что он написал: ответь ему: привет',
 'reply him: '+ 'x'.repeat(8001), 'գրի իրեն՝ '+ 'ա'.repeat(8001), 'ответь ему: '+ 'я'.repeat(8001),
];
assert.ok(positives.length>=25);assert.ok(negatives.length>=25);
for(const [input,want] of positives)assert.equal(typedReplyText(input),want,input.slice(0,120));
for(const input of negatives)assert.equal(typedReplyText(input),null,input.slice(0,120));
console.log(`Doctor typed replies: ${positives.length} verbatim drafts and ${negatives.length} refusals passed.`);
