import assert from 'node:assert/strict';
import {done,notDone,outcomeCopy,refreshFailed} from '@/lib/staff-zoe/outcome-copy';

const prefixes={en:{done:'Done: ',notDone:'Not done, because '},hy:{done:'Արված է․ ',notDone:'Չի արվել, քանի որ '},ru:{done:'Готово: ',notDone:'Не выполнено, потому что '}};
for(const group of ['done','notDone'] as const){
 for(const [key,line] of Object.entries(outcomeCopy[group])){
  for(const locale of ['en','hy','ru'] as const){
   assert.ok(line[locale].startsWith(prefixes[locale][group]),`${group}.${key}.${locale} must begin with the outcome`);
   assert.ok(line[locale].slice(prefixes[locale][group].length).trim(),`${key} must explain the outcome`);
   assert.doesNotMatch(line[locale],/because[^.]*because|քանի որ[^։]*քանի որ|потому что[^.]*потому что/u,`${key} uses a natural reason clause`);
   assert.doesNotMatch(line[locale],/[!！—]|\b(?:patient|user)\b/iu,`${key} follows the staff voice`);
   const rendered=group==='done'?done(key as keyof typeof outcomeCopy.done,locale,'Saved version 7'):notDone(key as keyof typeof outcomeCopy.notDone,locale,'Refresh the current version');
   assert.doesNotMatch(rendered,/\{detail\}/u,`${key} interpolates the explicit detail`);
  }
 }
}
assert.equal(done('report-approved','en','7'),'Done: Report version 7 approved. Nothing was sent.');
assert.equal(done('reply-saved','en'),'Done: Saved, not sent yet.');
assert.match(notDone('boundary-dose','en'),/^Not done, because I do not change[\s\S]*Nothing was changed[\s\S]*You decide medicines and doses in the member's plan[\s\S]*This chat never changes them/);
assert.match(notDone('boundary-dose','hy'),/Ոչինչ չի փոխվել[\s\S]*դուք եք որոշում անդամի պլանում[\s\S]*երբեք դրանք չի փոխում/);
assert.match(notDone('boundary-dose','ru'),/Ничего не изменено[\s\S]*вы определяете в плане участника[\s\S]*никогда их не меняет/);
for(const locale of ['en','hy','ru'] as const){
 assert.doesNotMatch(refreshFailed(locale),/^(?:Done:|Not done|Արված է|Չի արվել|Готово:|Не выполнено)/u,'A failed reread is not a write outcome');
 assert.doesNotMatch(refreshFailed(locale),/[!！—]|\b(?:patient|user)\b/iu);
 assert.ok(done('action',locale,'$& {literal}').endsWith('$& {literal}'),'Details are inserted literally');
 assert.match(done('draft',locale,'Saved'),/Not sent|Չի ուղարկվել|Не отправлено/);
}
console.log(`Clinician outcome copy: ${Object.keys(outcomeCopy.done).length+Object.keys(outcomeCopy.notDone).length} outcomes in three locales, explicit medication refusal, unsent drafts and literal details passed.`);
