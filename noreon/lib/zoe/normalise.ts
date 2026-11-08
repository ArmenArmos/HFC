/**
 * Text normalisation for the Zoe guards (ZOE_DESIGN §6). Pure, no network. Matching runs on
 * the normalised text; the model never receives it (it gets the redacted original, §16.9).
 */
export const NORMALISER_VERSION='zoe-normalise-1';

const ZERO_WIDTH=/[​-‏‪-‮⁠-⁤﻿­]/g;
// Armenian in-word punctuation: question, emphasis, exclamation marks and the abbreviation mark.
const ARMENIAN_IN_WORD=/[՛՜՞՟]/g;
// Look-alike letters, mapped into the script that dominates the word.
const CYRILLIC_TO_LATIN:Record<string,string>={'а':'a','е':'e','о':'o','р':'p','с':'c','у':'y','х':'x','і':'i','ј':'j','ѕ':'s','к':'k','м':'m','т':'t','в':'b','н':'h'};
const LATIN_TO_CYRILLIC:Record<string,string>=Object.fromEntries(Object.entries(CYRILLIC_TO_LATIN).filter(([c])=>'аеорсух'.includes(c)).map(([c,l])=>[l,c]));
const TO_ARMENIAN:Record<string,string>={'o':'օ','о':'օ','u':'ս','h':'հ','n':'ո','q':'գ'};

const script=(ch:string)=>/\p{Script=Armenian}/u.test(ch)?'hy':/\p{Script=Cyrillic}/u.test(ch)?'ru':/\p{Script=Latin}/u.test(ch)?'en':null;

function unifyWord(word:string){
 const counts={hy:0,ru:0,en:0};
 for(const ch of word){const s=script(ch);if(s)counts[s]++;}
 const dominant=(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]);
 if(!dominant||dominant[1]===0)return word;
 const target=dominant[0];
 // Only mixed-script words are touched; a clean word is left exactly as written.
 if(Object.entries(counts).filter(([,n])=>n>0).length<2)return word;
 let out='';
 for(const ch of word){
  const s=script(ch);
  if(!s||s===target){out+=ch;continue;}
  if(target==='en')out+=CYRILLIC_TO_LATIN[ch]??ch;
  else if(target==='ru')out+=LATIN_TO_CYRILLIC[ch]??ch;
  else out+=TO_ARMENIAN[ch]??ch;
 }
 return out;
}

/**
 * NFC, the ligature և as եւ, Armenian in-word punctuation removed and ։ as a full stop,
 * case folding (Armenian capitals included), zero-width characters removed, look-alikes
 * mapped, runs of three or more of one letter collapsed, and spaced-out letters joined
 * ("t a k e 5 0 m g" becomes "take50mg").
 */
export function normaliseText(input:string){
 let t=input.normalize('NFC').replace(ZERO_WIDTH,'').replace(ARMENIAN_IN_WORD,'').replace(/։/g,'.');
 // T1 audit (21 Oct): full-width digits and slashes as typed on phones («１８０/１２０»), the fraction slash, and emoji inside a phrase
 // ("I can't 😰 breathe", "I called 103 ✅") are read as plain text. Emoji become a space; spaces are collapsed below.
 t=t.replace(/[０-９]/gu,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[⁄／]/gu,'/').replace(/\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*/gu,' ');
 // English typed without the apostrophe ("I cant breathe", "it wont stop").
 t=t.replace(/(?<![\p{L}'])(can|won|don|didn|isn|doesn)t(?![\p{L}'])/giu,"$1't");
 t=t.replace(/և/g,'եւ').toLocaleLowerCase('und');
 t=t.replace(/[\p{L}\p{M}]+/gu,unifyWord);
 t=t.replace(/(\p{L})\1{2,}/gu,'$1');
 // Joins only runs of at least four single characters separated by single spaces.
 t=t.replace(/(?<![\p{L}\p{N}])(?:[\p{L}\p{N}] ){3,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu,m=>m.replaceAll(' ',''));
 return t.replace(/[ \t]+/g,' ').trim();
}

/** True when the original carries characters a member would not normally type on purpose. */
export const hasHiddenCharacters=(input:string)=>{ZERO_WIDTH.lastIndex=0;return /[​-‏‪-‮⁠-⁤﻿]/.test(input);};
