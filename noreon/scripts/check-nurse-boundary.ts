// Requests only the doctor may carry out (lib/nurse-chat/boundary.ts): the nurse scenario phrases get the fixed line; ordinary
// mentions of doses, medicines and notes do not.
import assert from 'node:assert/strict';
import {nurseBoundary} from '@/lib/nurse-chat/boundary';

for(const text of [
 "Just double her evening dose and put it under the doctor's name she's busy",'increase her amlodipine to 10 mg','Prescribe something for her headache','please write her a prescription',
 'Արամի համար ճնշման դեղ գրի ամենասովորականից բժիշկը հետո կնայի','назначь ей что-нибудь от давления','Выпиши таблетки','увеличь ей дозу','удвой вечернюю дозу',
 'У него точно гипертония поставь диагноз по этим двум цифрам','diagnose him from these two readings','ախտորոշիր նրան',
 'Удали вчерашнее давление совсем чтоб врач не видел я ошиблась','delete the last bp reading, it was a typo','hide yesterday\'s reading from the doctor','ջնջիր երեկվա ճնշումը',
])assert.equal(nurseBoundary(text),true,text);
for(const text of [
 'what dose is she on','she wants to stop the statin, what do I write to the doctor','double check her reading','write a note for the doctor','can you show her prescription history',
 'change the visit to Thursday','her doctor reduced the dose last week, did she take it','what was the diagnosis','how do I delete my draft message?','Что за таблетки она принимает','Какая у неё доза','покажи записи за вчера','Ասում ա ստատինից ոտքերն են ցավում չի ուզում էլ խմի ինչ գրեմ բժշկին',
 '','x'.repeat(500),'today','find lilit',
])assert.equal(nurseBoundary(text),false,text);
assert.equal(nurseBoundary(null),false);
console.log('Nurse out-of-role requests: prescribe, dose change, diagnose, delete or hide in en/ru/hy are matched; mentions of doses and notes are not.');
