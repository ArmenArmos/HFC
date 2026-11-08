import assert from 'node:assert/strict';
import {typedHandover} from '@/lib/staff-zoe/typed-handover';
import {typedBoundary} from '@/lib/staff-zoe/typed-boundary';
const positives:[string,string|null][]=[
 ['hand over to the nurse',null],['hand this to the nurse',null],['pass it to the nurse',null],['send to the nurse',null],
 ['Please hand over to the nurse.',null],['Zoe, could you please hand this to the nurse',null],['hand over to the nurse: Call tomorrow','Call tomorrow'],['hand this to the nurse - Check BP','Check BP'],['pass it to the nurse, Call me','Call me'],['send to the nurse: Keep THIS wording.','Keep THIS wording.'],['ask the nurse to call tomorrow','call tomorrow'],['please ask the nurse to check BP: morning and evening','check BP: morning and evening'],
 ['передай медсестре',null],['передай это медсестре: Позвонить завтра','Позвонить завтра'],['Пожалуйста, передай медсестре',null],['Зоя, можешь передай медсестре: Проверить давление','Проверить давление'],['пусть медсестра позвонит завтра','позвонит завтра'],['передай медсестре - Связаться утром','Связаться утром'],['передай это медсестре.',null],['пожалуйста, пусть медсестра проверит запись','проверит запись'],
 ['հանձնիր բուժքրոջը',null],['փոխանցիր բուժքրոջը',null],['բուժքույրին հանձնիր Զանգահարել վաղը','Զանգահարել վաղը'],['խնդրում եմ փոխանցիր բուժքրոջը: Զանգահարել վաղը','Զանգահարել վաղը'],['Զոյա, հանձնիր բուժքրոջը։',null],['փոխանցիր բուժքրոջը՝ Ստուգել ճնշումը','Ստուգել ճնշումը'],['հանձնիր բուժքրոջը - Զանգահարել','Զանգահարել'],['բուժքույրին հանձնիր: Ստուգել գրառումը','Ստուգել գրառումը'],
];
const negatives=[
 'what did the nurse write','show the nurse tasks','did you hand over to the nurse?','should I send to the nurse?','hand over to the nurse tomorrow','do not hand over to the nurse','please do not send to the nurse','I said hand over to the nurse','"hand over to the nurse"','hand over to the nurse?','ask the nurse','ask the nurse to','send to the nurse and approve the report','hand over to the nurses','hand over to the nursemaid','hello. What did the nurse write?',
 'что написала медсестра','покажи задачи медсестры','ты передал медсестре?','не передай медсестре','передай медсестре завтра','передай это врачу','пусть медсестра','нужно передать медсестре?','«передай медсестре»',
 'ինչ է գրել բուժքույրը','ցույց տուր բուժքրոջ առաջադրանքները','մի փոխանցիր բուժքրոջը','հանձնիր բժշկին','հանձնիր բուժքրոջը վաղը','բուժքույրին հանձնիր','«հանձնիր բուժքրոջը»','հանձնիր բուժքրոջը՞',
];
for(const [text,note]of positives){assert.deepEqual(typedHandover(text),{note},text);assert.equal(typedBoundary(text),null,`Handover owns ${text}`);}
for(const text of negatives)assert.equal(typedHandover(text),null,text);
console.log(`Typed handover: ${positives.length} positives and ${negatives.length} negatives passed in en, hy and ru.`);
