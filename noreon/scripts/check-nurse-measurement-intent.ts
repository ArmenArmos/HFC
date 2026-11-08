// A reading typed to be recorded (lib/nurse-chat/measurement-intent.ts): the nurse scenario phrases in en/ru/hy, and the
// sentences that must stay questions, notes, reports of past readings or corrections.
import assert from 'node:assert/strict';
import {measurementIntent} from '@/lib/nurse-chat/measurement-intent';

const same=(input:string,entries:{field:string;text:string}[],name:string|null=null)=>assert.deepEqual(measurementIntent(input),{entries,name},input);
same('bp 150/95 pulse 78',[{field:'bp',text:'150/95 78'}]);
same('BP 148/93',[{field:'bp',text:'148/93'}]);
same('bp is 148/93',[{field:'bp',text:'148/93'}]);
same('blood pressure 148/93 pulse 72',[{field:'bp',text:'148/93 72'}]);
same('record bp 148/93 72',[{field:'bp',text:'148/93 72'}]);
same('ճնշումը 148/93 է, զարկերակը 72',[{field:'bp',text:'148/93 72'}]);
same('ей 148 на 92 пульс 78 правая сидя сейчас',[{field:'bp',text:'148/92 78'}]);
same('давление 135 85',[{field:'bp',text:'135/85'}]);
same('weight 82 waist 98 for hayk, height unknown',[{field:'weight',text:'82'},{field:'waist',text:'98'}],'hayk');
same('вес 72,5 кг',[{field:'weight',text:'72.5'}]);
same('waist 98 cm',[{field:'waist',text:'98'}]);
same('bp 150/95 for Nare Test',[{field:'bp',text:'150/95'}],'nare test');
same('bp 150/95 для Нары',[{field:'bp',text:'150/95'}],'нары');
// Questions, notes, past or reported readings, corrections and anything with other words stay with Zoe.
for(const text of [
 'is 138/88 ok for a 62 year old?','what was her pressure 148/93','she says bp 150/95 at home','Арман вчера дома было 135 85 утром сегодня я не мерила','bp was 148/93 yesterday',
 'oops 184/86 was 148/86 fix my last entry keep the correction','delete bp 148/93','bp 148/93 and call the doctor','Лаби թղթի վրա LDL 3,4 ա','LDL 3.4 mmol/L','remind her to take bp 148/93',
 'հարյուր քառասուն ութ ութսունվեց','today','the visit on 21.01.1959','148','bp','weight','bp 300/20000','call 103','increase amlodipine to 10 mg','bp 148/93 pulse 72 sitting after coffee',
 '','x'.repeat(300),
])assert.equal(measurementIntent(text),null,text);
assert.equal(measurementIntent(null),null);
console.log('Nurse reading intent: bp, weight and waist in en/ru/hy with an optional member after "for"; questions, past readings and corrections are not readings.');
