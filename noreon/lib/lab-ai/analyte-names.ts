import type {Locale} from '@/lib/locale';
import {matchAnalyte} from './catalogue';

/**
 * Armenian display names for the lab reader's analytes, shown to staff working in Armenian
 * (QA N-10). AWAITING WORDING CHECK by Tatevik: the list is repeated in
 * output/qa-night-ui-fixes-2026-10-18/STATUS.md. Where the member-history measures already use
 * an Armenian name (lib/member-history/measures.ts), the same name is used here.
 * Display only: matching and storage keep the catalogue keys and the printed test name.
 */
export const ANALYTE_NAME_HY:Readonly<Record<string,string>>=Object.freeze({
 total_cholesterol:'Ընդհանուր խոլեստերին',
 hdl_c:'ԲԽԼ խոլեստերին (HDL)',
 ldl_c:'ՑԽԼ խոլեստերին (LDL)',
 non_hdl_c:'Ոչ-HDL խոլեստերին',
 triglycerides:'Տրիգլիցերիդներ',
 apob:'Ապոլիպոպրոտեին B (ApoB)',
 lpa:'Լիպոպրոտեին(a) (Lp(a))',
 hba1c:'Գլիկացված հեմոգլոբին (HbA1c)',
 fasting_glucose:'Գլյուկոզ քաղցած վիճակում',
 insulin:'Ինսուլին քաղցած վիճակում',
 homa_ir:'HOMA-IR ինդեքս',
 c_peptide:'C-պեպտիդ',
 creatinine:'Կրեատինին',
 egfr:'Կծիկային ֆիլտրացիայի արագություն (eGFR)',
 uacr:'Միզում ալբումին/կրեատինին հարաբերություն (ACR)',
 urea:'Միզանյութ',
 alt:'ԱԼՏ',
 ast:'ԱՍՏ',
 ggt:'ԳԳՏ',
 alp:'Հիմնային ֆոսֆատազ (ԱԼՖ)',
 bilirubin_total:'Ընդհանուր բիլիռուբին',
 hemoglobin:'Հեմոգլոբին',
 wbc:'Լեյկոցիտներ',
 platelets:'Թրոմբոցիտներ',
 ferritin:'Ֆերիտին',
 esr:'ԷՆԱ (ESR)',
 crp:'C-ռեակտիվ սպիտակուց (CRP)',
 fibrinogen:'Ֆիբրինոգեն',
 tsh:'Թիրեոտրոպ հորմոն (TSH)',
 free_t4:'Ազատ T4',
 anti_tpo:'Anti-TPO հակամարմիններ',
 uric_acid:'Միզաթթու',
 homocysteine:'Հոմոցիստեին',
 vitamin_d:'Վիտամին D (25-OH)',
 vitamin_b12:'Վիտամին B12',
 folate:'Ֆոլատ',
});

/** Russian display names, unapproved v1, awaiting native terminology review. */
export const ANALYTE_NAME_RU:Readonly<Record<string,string>>=Object.freeze({
 total_cholesterol:'Общий холестерин',
 hdl_c:'Холестерин ЛПВП (HDL)',
 ldl_c:'Холестерин ЛПНП (LDL)',
 non_hdl_c:'Холестерин не-ЛПВП',
 triglycerides:'Триглицериды',
 apob:'Аполипопротеин B (ApoB)',
 lpa:'Липопротеин(a) (Lp(a))',
 hba1c:'Гликированный гемоглобин (HbA1c)',
 fasting_glucose:'Глюкоза натощак',
 insulin:'Инсулин натощак',
 homa_ir:'Индекс HOMA-IR',
 c_peptide:'C-пептид',
 creatinine:'Креатинин',
 egfr:'Скорость клубочковой фильтрации (eGFR)',
 uacr:'Соотношение альбумина и креатинина в моче (ACR)',
 urea:'Мочевина',
 alt:'АЛТ',
 ast:'АСТ',
 ggt:'ГГТ',
 alp:'Щелочная фосфатаза (ЩФ)',
 bilirubin_total:'Общий билирубин',
 hemoglobin:'Гемоглобин',
 wbc:'Лейкоциты',
 platelets:'Тромбоциты',
 ferritin:'Ферритин',
 esr:'СОЭ (ESR)',
 crp:'C-реактивный белок (CRP)',
 fibrinogen:'Фибриноген',
 tsh:'Тиреотропный гормон (TSH)',
 free_t4:'Свободный T4',
 anti_tpo:'Антитела к ТПО',
 uric_acid:'Мочевая кислота',
 homocysteine:'Гомоцистеин',
 vitamin_d:'Витамин D (25-OH)',
 vitamin_b12:'Витамин B12',
 folate:'Фолат',
});

/**
 * Armenian names for common tests a sheet may print that the reader does not map (they are not rows of the
 * lab catalogue, so they stay 'other'): display only, matched on the printed name. AWAITING WORDING CHECK
 * by Tatevik, with the list above. Sodium and potassium: Khikar's live test, 18 Oct.
 */
const PRINTED_NAME_HY:readonly [string[],string][]=[
 [['sodium','natrium','na+','натрий','նատրիում'],'Նատրիում'],
 [['potassium','kalium','k+','калий','կալիում'],'Կալիում'],
 [['chloride','chlorides','cl-','хлор','хлориды','քլոր','քլորիդներ'],'Քլորիդներ'],
 [['calcium','кальций','կալցիում'],'Կալցիում'],
 [['magnesium','магний','մագնեզիում'],'Մագնեզիում'],
 [['zinc','цинк','ցինկ'],'Ցինկ'],
 [['iron','serum iron','железо','երկաթ'],'Երկաթ'],
 [['albumin','альбумин','ալբումին'],'Ալբումին'],
 [['total protein','общий белок','ընդհանուր սպիտակուց'],'Ընդհանուր սպիտակուց'],
 [['red blood cells','erythrocytes','rbc','эритроциты','էրիթրոցիտներ'],'Էրիթրոցիտներ'],
 [['hematocrit','haematocrit','hct','гематокрит','հեմատոկրիտ'],'Հեմատոկրիտ'],
];
const foldName=(s:string)=>` ${s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+\-]+/gu,' ').replace(/\s+/g,' ').trim()} `;
export function printedNameHy(printed:string):string|null{
 const n=foldName(printed);
 for(const [aliases,hy] of PRINTED_NAME_HY)if(aliases.some(a=>n.includes(` ${a} `)))return hy;
 return null;
}

const PRINTED_NAMES_RU=['Натрий','Калий','Хлориды','Кальций','Магний','Цинк','Железо','Альбумин','Общий белок','Эритроциты','Гематокрит'];
export function printedNameRu(printed:string):string|null{
 const n=foldName(printed);
 const index=PRINTED_NAME_HY.findIndex(([aliases])=>aliases.some(a=>n.includes(` ${a} `)));
 return PRINTED_NAMES_RU[index]??null;
}

/** The name to show for a value: in Armenian, the catalogue name when the analyte is known, else a known printed name; else as printed. */
export function analyteDisplayName(printed:string,locale:Locale,key?:string|null):string{
 if(locale==='en')return printed;
 const k=key??matchAnalyte(printed);
 if(locale==='ru')return (k&&ANALYTE_NAME_RU[k])||printedNameRu(printed)||printed;
 return (k&&ANALYTE_NAME_HY[k])||printedNameHy(printed)||printed;
}
