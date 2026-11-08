
// Khikar, 4 Nov: Zoe never answers in Armenian written in Latin letters. These are members who write that way ("barev, inch karogh em utel"); the check
// (scripts/check-zoe-latin-armenian-replies.ts) and the replay (conversation-families-lang.ts) hold every reply to them to Armenian script.
export const LATIN_ARMENIAN_MESSAGES=[
 'barev, inch karogh em utel',
 'barev dzez, inch karogh em utel aysor?',
 'gluxs cavum a',
 'chnshumy 140/90 e, vonc anem?',
 'dexs chem khmel, shat em ches',
 'inch karogh em xmel arajin ev erkrord anqam?',
 'ayo, shnorhakalutyun',
 'aysor sirts chem zgum, vat em',
 'aysor shat lav em, voch inch chem zgum, karogh em gnal sharzvelu?',
 'inch pahin chnshum chapem?',
 'ays, Yerevanum kayne inch kaxm e aystor?',
 'barev, em unem hartsum dexeri masin',
 'hima inch anem, chem haskanum',
 'shnorhakalutyun, ujegh em',
 'inch uteq aysor ankam chnshumy lav lini',
 'barev Zoe, gluxs cavum e ev hivand em',
 'dexs hima khmem te voch',
 'xndrum em, inch tesutyun unem analizi mej',
 'merci, hajox',
 'ari, tes inch asum es',
] as const;

// Known limit: a Latin-letter message with a single everyday Armenian word and nothing else the detector knows ("ari, tesnenq") reads as English for a member whose
// app language is not Armenian, so it is answered in English; with an Armenian app language the "no English word" rule reads it as Armenian.
// Urgent wording in Latin letters: the 103 text is Armenian script too.
export const LATIN_ARMENIAN_URGENT=[
 'sirts shat cavum e, shnchel chem karogh',
 'krtsqis cav unem, dzerqs xucum e',
 'kanchel em 103, inch karogh em utel',
 'ches karogh xosel, ajs dem@ ptuyt e',
] as const;

// Latin tokens an Armenian-script reply may carry: brand names, guideline acronyms (ESC), readings and units.
const ALLOWED=new Set(['telegram','noreon','zoe','bmi','ldl','hdl','mmhg','app','sms','pdf','qr','mg','kg','cm','mmol','whatsapp','viber','ecg','ekg','hba','hbac','bp','ok','gp','iu','esc','aha','acc','who','nice','ada','kdigo']);
/** The Latin-letter words of a reply that are not brand names or units: what a Latin-letter Armenian reply would leave behind. */
export const leftoverLatinArmenian=(text:string):string[]=>
 (text.toLowerCase().match(/[a-z]{3,}/gu)??[]).filter(w=>!ALLOWED.has(w)).filter((w,i,a)=>a.indexOf(w)===i);
