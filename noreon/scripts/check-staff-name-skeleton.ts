import assert from 'node:assert/strict';
import {nameSkeleton,nameWordMatches,matchingNameRows} from '@/lib/staff-zoe/name-skeleton';
import {typedLanguage} from '@/lib/staff-zoe/typed-language';
import {staffNameCases} from './fixtures/staff-name-cases';

for(const variants of staffNameCases){
 for(const name of variants){
  assert.equal(nameSkeleton(name),nameSkeleton(variants[0]),name);
  assert.equal(nameSkeleton(name.toLowerCase()),nameSkeleton(variants[0]),name);
 }
}
for(const variants of [
 ['Հայկ','Hayk','Хайк'],['Նարե','Nare','Наре'],['Աննա','Anna','Анна'],
 ['Արամ','Aram','Арам'],['Լիլիթ','Lilit','Лилит'],['Գոռ','Gor','Гор'],
 ['ուր','ur'],['Եվա','Eva','Yeva'],['Էմմա','Emma'],['Մկրտիչ','Մկըրտիչ','Mkyrtich'],
 ['թփքղժշչջցծ','tpkghzhshchjtsts'],
])for(const name of variants)assert.equal(nameSkeleton(name),nameSkeleton(variants[0]),name);
assert.equal(nameSkeleton('Hayk Թեստ'),nameSkeleton('Հայկ Test'));
for(const query of ['Hayk-ի','Анне','Нареi','hayl','հայլ','хайл']){
 const name=/n|н/iu.test(query)?'Anna':/Նարե|Наре/iu.test(query)?'Nare':'Hayk';
 assert.ok(nameWordMatches(query,query==='Нареi'?'Nare':name),query);
}
assert.equal(nameWordMatches('Unknown','Hayk'),false);
assert.equal(nameWordMatches('Al','Anna'),false,'Short names do not get typo guesses');
for(const [query,name] of [['Ильи','Илья'],['Ани','Аня'],['Анны','Анна']])
 assert.equal(nameWordMatches(query,name),true,`${query}: a supported inflection replaces the name ending`);
for(const fallback of ['en','hy','ru'] as const){
 assert.equal(typedLanguage('Հայկ',fallback),'hy');
 assert.equal(typedLanguage('Хайк',fallback),'ru');
 assert.equal(typedLanguage('Hayk Թեստ Хайк',fallback),'hy');
 assert.equal(typedLanguage('Hayk',fallback),fallback);
 assert.equal(typedLanguage('',fallback),fallback);
}
for(const [query,name] of [['Ann','Anna'],['Gor','Gore'],['Teste','Tester'],['Հայ','Հայկ']]){
 assert.deepEqual(matchingNameRows([{name}],query,false),[],`${query}: a substring is not complete identity evidence`);
 assert.deepEqual(matchingNameRows([{name}],query),[{name}],`${query}: the suggestion is retained`);
}
for(const [query,name] of [['Anna','Anna'],['Աննա','Anna'],['Хайк','Հայկ'],['Test','Թեստ']])
 assert.deepEqual(matchingNameRows([{name}],query,false),[{name}],`${query}: a complete token can identify a search result`);
assert.equal(nameWordMatches('горлом','Gor'),false,'A longer word sharing a prefix is not a supported variant');
assert.deepEqual(matchingNameRows([{name:null},{name:'Hayk'}],'ըը'),[],'An empty skeleton never matches unnamed members');
console.log('Staff name skeleton: supplied names, scripts, spelling variants, inflections, typos and typed language passed');
