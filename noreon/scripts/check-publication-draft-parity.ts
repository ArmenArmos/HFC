import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {validReviewDraft} from '@/lib/service-workflow/publication';
const base={explanation:'Reviewed',instructions:'Reviewed instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
const medicine={name:'Fictional medicine',dose:'Example',instructions:'',times:['08:00']};
const fixtures:[string,unknown,boolean][]=[
 ['valid',base,true],['null',null,false],['missing',{},false],['extra',{...base,extra:true},false],
 ['placeholder',{...base,instructions:'Add the approved care instructions.'},false],
 ['blank',{...base,instructions:'  '},false],['newline',{...base,instructions:'\n\t'},false],
 ['unicode whitespace',{...base,instructions:'\u00a0\ufeff'},false],
 ['trimmed',{...base,instructions:'\n Reviewed instructions \t'},true],
 ['long',{...base,instructions:'a'.repeat(1501)},false],['unicode within limit',{...base,instructions:'😀'.repeat(751)},true],['unicode long',{...base,instructions:'😀'.repeat(1501)},false],
 ['medicine without dose',{...base,medicationName:'Fictional',medicationTimes:['08:00']},false],
 ['medicine without times',{...base,medicationName:'Fictional',medicationDose:'Example'},false],
 ['valid medicine',{...base,medicationName:'Fictional',medicationDose:'Example',medicationTimes:['08:00']},true],
 ['invalid time',{...base,medicationTimes:['24:00']},false],['too many times',{...base,medicationTimes:Array(5).fill('08:00')},false],
 ['wrong type',{...base,medicationName:7},false],
 // A regimen (20261030210000): an optional list, and then the one-medicine fields stay blank.
 ['empty regimen',{...base,medicines:[]},true],
 ['regimen',{...base,medicines:[medicine,{...medicine,name:'Other',times:['08:00','20:00']}]},true],
 ['regimen beside a medicine',{...base,medicationName:'Fictional',medicationDose:'Example',medicationTimes:['08:00'],medicines:[medicine]},false],
 ['repeated name',{...base,medicines:[medicine,{...medicine,name:' fictional   MEDICINE '}]},false],
 ['regimen name blank',{...base,medicines:[{...medicine,name:'  '}]},false],
 ['regimen dose blank',{...base,medicines:[{...medicine,dose:'\u00a0'}]},false],
 ['regimen no times',{...base,medicines:[{...medicine,times:[]}]},false],
 ['regimen bad time',{...base,medicines:[{...medicine,times:['24:00']}]},false],
 ['regimen too many times',{...base,medicines:[{...medicine,times:Array(5).fill('08:00')}]},false],
 ['regimen extra key',{...base,medicines:[{...medicine,suggested:true}]},false],
 ['regimen not a list',{...base,medicines:{}},false],
 ['regimen wrong type',{...base,medicines:[{...medicine,name:7}]},false],
 ['eight medicines',{...base,medicines:Array.from({length:8},(_,i)=>({...medicine,name:`Fictional ${i}`}))},true],
 ['nine medicines',{...base,medicines:Array.from({length:9},(_,i)=>({...medicine,name:`Fictional ${i}`}))},false],
 ['regimen long name',{...base,medicines:[{...medicine,name:'a'.repeat(121)}]},false],
 ['regimen long instructions',{...base,medicines:[{...medicine,instructions:'a'.repeat(501)}]},false],
];
const quote=(v:unknown)=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const results=execFileSync('docker',['exec','-i',process.env.NOREON_TEST_DB_CONTAINER??'supabase_db_noreon-core','psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:fixtures.map(([,v])=>`select public.workspace_valid_review_draft(${quote(v)});`).join('\n'),encoding:'utf8'}).trim().split('\n');
fixtures.forEach(([name,value,expected],i)=>{assert.equal(validReviewDraft(value),expected,`TS ${name}`);assert.equal(results[i]==='t',expected,`SQL ${name}`);});
console.log(`${fixtures.length} shared fixtures agree between TypeScript and PostgreSQL draft validation.`);
