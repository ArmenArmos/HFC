/**
 * Analytes the lab reader can map, each tied to its row in the laboratory catalogue
 * (docs/clinical/NRN-LAB-CAT-001-lab-catalogue.json, section A; `catalogueRef` in
 * lib/clinical/seed/tests.ts uses the same row names). A check walks this list against the document.
 *
 * Units and plausible ranges here are measurement sanity checks, not clinical thresholds: a value
 * outside its plausible range is a reading error to check (a misplaced decimal, a wrong unit), never
 * a finding. Clinical cuts live only in THRESHOLD (lib/clinical/rules/rules.ts).
 */
export type Unit={/** Multiply by this to get the canonical unit; a function for non-linear ones. */toCanonical:number|((v:number)=>number)};
export type Analyte={
 key:string;
 /** The catalogue row, exactly as NRN-LAB-CAT-001 names it. */
 row:string;
 label:string;
 /** Lower-case names as printed on lab sheets (EN, HY, RU). Matched on word boundaries. */
 aliases:string[];
 canonical:string;
 units:Record<string,Unit>;
 plausible:[number,number];
};

const same:Unit={toCanonical:1};
const f=(x:number):Unit=>({toCanonical:x});
const CHOL=f(0.02586),TG=f(0.01129);

export const LAB_ANALYTES:Analyte[]=[
 {key:'total_cholesterol',row:'Ընդհանուր խոլեստերին',label:'Total cholesterol',aliases:['total cholesterol','cholesterol total','cholesterol','chol','ընդհանուր խոլեստերին','խոլեստերին','общий холестерин','холестерин общий','холестерин'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':CHOL},plausible:[0.5,30]},
 {key:'hdl_c',row:'HDL-C',label:'HDL-C',aliases:['hdl-c','hdl cholesterol','hdl','բխլպ խոլեստերին','բխլպ','бхлп','хс-лпвп','лпвп','холестерин лпвп'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':CHOL},plausible:[0.1,10]},
 {key:'ldl_c',row:'LDL-C',label:'LDL-C',aliases:['ldl-c','ldl cholesterol','ldl','ցխլպ խոլեստերին','ցխլպ','хс-лпнп','лпнп','холестерин лпнп'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':CHOL},plausible:[0.1,25]},
 {key:'non_hdl_c',row:'non-HDL-C (հաշվարկ)',label:'non-HDL-C',aliases:['non-hdl-c','non-hdl cholesterol','non-hdl','ոչ-բխլպ խոլեստերին','ոչ-բխլպ','холестерин не-лпвп','не-лпвп'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':CHOL},plausible:[0.1,30]},
 {key:'triglycerides',row:'Տրիգլիցերիդներ',label:'Triglycerides',aliases:['triglycerides','triglyceride','tg','տրիգլիցերիդներ','տրիգլիցերիդ','триглицериды'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':TG},plausible:[0.1,100]},
 {key:'apob',row:'ApoB',label:'ApoB',aliases:['apolipoprotein b','apo b','apob','аполипопротеин b','ապոլիպոպրոտեին b'],canonical:'g/l',units:{'g/l':same,'mg/dl':f(0.01)},plausible:[0.1,5]},
 {key:'lpa',row:'Lp(a)',label:'Lp(a)',aliases:['lipoprotein(a)','lipoprotein (a)','lipoprotein a','lp(a)','lpa','липопротеин(а)','липопротеин (а)','липопротеин а','լիպոպրոտեին (a)','լիպոպրոտեին(a)'],canonical:'nmol/l',units:{'nmol/l':same},plausible:[0,1000]},
 {key:'hba1c',row:'HbA1c',label:'HbA1c',aliases:['hba1c','hb a1c','glycated haemoglobin','glycated hemoglobin','գլիկացված հեմոգլոբին','гликированный гемоглобин','гликозилированный гемоглобин'],canonical:'%',units:{'%':same,'mmol/mol':{toCanonical:v=>0.09148*v+2.152}},plausible:[2,20]},
 {key:'fasting_glucose',row:'Ծոմային գլյուկոզա',label:'Fasting glucose',aliases:['fasting glucose','glucose','fasting plasma glucose','ծոմային գլյուկոզա','գլյուկոզա','глюкоза натощак','глюкоза'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':f(0.0555)},plausible:[0.5,60]},
 {key:'insulin',row:'Ծոմային ինսուլին · HOMA-IR',label:'Fasting insulin',aliases:['fasting insulin','insulin','ինսուլին','инсулин'],canonical:'uiu/ml',units:{'uiu/ml':same,'mu/l':same,'pmol/l':f(1/6)},plausible:[0.1,1000]},
 {key:'homa_ir',row:'Ծոմային ինսուլին · HOMA-IR',label:'HOMA-IR',aliases:['homa-ir','homa ir','homa'],canonical:'',units:{'':same},plausible:[0,100]},
 {key:'c_peptide',row:'C-պեպտիդ',label:'C-peptide',aliases:['c-peptide','c peptide','c-պեպտիդ','с-пептид','c-пептид'],canonical:'ng/ml',units:{'ng/ml':same,'nmol/l':f(1/0.331)},plausible:[0,50]},
 {key:'creatinine',row:'Կրեատինին + eGFR',label:'Creatinine',aliases:['creatinine','կրեատինին','креатинин'],canonical:'umol/l',units:{'umol/l':same,'mg/dl':f(88.4)},plausible:[10,3000]},
 {key:'egfr',row:'Կրեատինին + eGFR',label:'eGFR',aliases:['egfr','gfr','կֆա','скф','estimated glomerular filtration rate'],canonical:'ml/min/1.73m2',units:{'ml/min/1.73m2':same,'ml/min':same},plausible:[1,200]},
 {key:'uacr',row:'Միզի ACR',label:'Urine albumin/creatinine ratio',aliases:['albumin/creatinine ratio','albumin creatinine ratio','uacr','acr','միզի acr','альбумин/креатинин'],canonical:'mg/mmol',units:{'mg/mmol':same,'mg/g':f(0.113)},plausible:[0,5000]},
 {key:'urea',row:'Միզանյութ (Urea)',label:'Urea',aliases:['urea','միզանյութ','мочевина'],canonical:'mmol/l',units:{'mmol/l':same,'mg/dl':f(0.1665)},plausible:[0.5,100]},
 {key:'alt',row:'ԱԼՏ · ԱՍՏ · ԳԳՏ · ԱԼՖ · բիլիռուբին',label:'ALT',aliases:['alanine aminotransferase','alt','alat','ալտ','алт','алат'],canonical:'u/l',units:{'u/l':same},plausible:[1,10000]},
 {key:'ast',row:'ԱԼՏ · ԱՍՏ · ԳԳՏ · ԱԼՖ · բիլիռուբին',label:'AST',aliases:['aspartate aminotransferase','ast','asat','աստ','аст','асат'],canonical:'u/l',units:{'u/l':same},plausible:[1,10000]},
 {key:'ggt',row:'ԱԼՏ · ԱՍՏ · ԳԳՏ · ԱԼՖ · բիլիռուբին',label:'GGT',aliases:['gamma-glutamyl transferase','ggt','gamma gt','գգտ','ггт'],canonical:'u/l',units:{'u/l':same},plausible:[1,10000]},
 {key:'alp',row:'ԱԼՏ · ԱՍՏ · ԳԳՏ · ԱԼՖ · բիլիռուբին',label:'ALP',aliases:['alkaline phosphatase','alp','ալֆ','щелочная фосфатаза','щф'],canonical:'u/l',units:{'u/l':same},plausible:[1,10000]},
 {key:'bilirubin_total',row:'ԱԼՏ · ԱՍՏ · ԳԳՏ · ԱԼՖ · բիլիռուբին',label:'Total bilirubin',aliases:['total bilirubin','bilirubin total','bilirubin','ընդհանուր բիլիռուբին','բիլիռուբին','билирубин общий','общий билирубин','билирубин'],canonical:'umol/l',units:{'umol/l':same,'mg/dl':f(17.1)},plausible:[0.5,1000]},
 {key:'hemoglobin',row:'Արյան ընդհանուր + լեյկոֆորմուլա',label:'Haemoglobin',aliases:['haemoglobin','hemoglobin','hgb','hb','հեմոգլոբին','гемоглобин'],canonical:'g/l',units:{'g/l':same,'g/dl':f(10)},plausible:[20,250]},
 {key:'wbc',row:'Արյան ընդհանուր + լեյկոֆորմուլա',label:'White blood cells',aliases:['white blood cells','leukocytes','wbc','լեյկոցիտներ','лейкоциты'],canonical:'10^9/l',units:{'10^9/l':same,'10^3/ul':same},plausible:[0.1,500]},
 {key:'platelets',row:'Արյան ընդհանուր + լեյկոֆորմուլա',label:'Platelets',aliases:['platelets','plt','թրոմբոցիտներ','тромбоциты'],canonical:'10^9/l',units:{'10^9/l':same,'10^3/ul':same},plausible:[1,3000]},
 {key:'ferritin',row:'Ֆերիտին',label:'Ferritin',aliases:['ferritin','ֆերիտին','ферритин'],canonical:'ng/ml',units:{'ng/ml':same,'ug/l':same},plausible:[1,100000]},
 {key:'esr',row:'ԷԳՆ (ESR) · hs-CRP',label:'ESR',aliases:['erythrocyte sedimentation rate','esr','էգն','соэ'],canonical:'mm/h',units:{'mm/h':same},plausible:[0,200]},
 {key:'crp',row:'ԷԳՆ (ESR) · hs-CRP',label:'CRP',aliases:['hs-crp','high sensitivity crp','c-reactive protein','crp','սռս','срб','с-реактивный белок'],canonical:'mg/l',units:{'mg/l':same,'mg/dl':f(10)},plausible:[0,500]},
 {key:'fibrinogen',row:'Ֆիբրինոգեն',label:'Fibrinogen',aliases:['fibrinogen','ֆիբրինոգեն','фибриноген'],canonical:'g/l',units:{'g/l':same,'mg/dl':f(0.01)},plausible:[0.1,15]},
 {key:'tsh',row:'TSH',label:'TSH',aliases:['thyroid stimulating hormone','tsh','թխհ','ттг'],canonical:'miu/l',units:{'miu/l':same,'uiu/ml':same},plausible:[0.001,500]},
 {key:'free_t4',row:'Ազատ T4',label:'Free T4',aliases:['free t4','ft4','ազատ t4','свободный т4','т4 свободный'],canonical:'pmol/l',units:{'pmol/l':same,'ng/dl':f(12.87)},plausible:[1,200]},
 {key:'anti_tpo',row:'Anti-TPO',label:'Anti-TPO',aliases:['anti-tpo','anti tpo','atpo','ат-тпо','антитела к тпо'],canonical:'iu/ml',units:{'iu/ml':same,'u/ml':same},plausible:[0,10000]},
 {key:'uric_acid',row:'Միզաթթու',label:'Uric acid',aliases:['uric acid','urate','միզաթթու','мочевая кислота'],canonical:'umol/l',units:{'umol/l':same,'mg/dl':f(59.48)},plausible:[30,2000]},
 {key:'homocysteine',row:'Հոմոցիստեին',label:'Homocysteine',aliases:['homocysteine','հոմոցիստեին','гомоцистеин'],canonical:'umol/l',units:{'umol/l':same},plausible:[1,500]},
 {key:'vitamin_d',row:'Վիտամին D (25-OH)',label:'Vitamin D (25-OH)',aliases:['25-oh vitamin d','25(oh)d','vitamin d','վիտամին d','витамин d'],canonical:'ng/ml',units:{'ng/ml':same,'nmol/l':f(0.4)},plausible:[1,300]},
 {key:'vitamin_b12',row:'Վիտամին B12 · ֆոլատ',label:'Vitamin B12',aliases:['vitamin b12','b12','cobalamin','վիտամին b12','витамин b12'],canonical:'pg/ml',units:{'pg/ml':same,'pmol/l':f(1.355)},plausible:[10,5000]},
 {key:'folate',row:'Վիտամին B12 · ֆոլատ',label:'Folate',aliases:['folate','folic acid','ֆոլատ','фолиевая кислота','фолаты'],canonical:'ng/ml',units:{'ng/ml':same,'nmol/l':f(0.441)},plausible:[0.5,100]},
];
export const ANALYTE_KEYS=LAB_ANALYTES.map(a=>a.key) as [string,...string[]];
export const analyteByKey=(key:string)=>LAB_ANALYTES.find(a=>a.key===key);

/** Unit spelling, folded: Cyrillic and Armenian unit words, micro signs, spaces, powers of ten. */
const UNIT_WORDS:[RegExp,string][]=[
 [/[µμ]/g,'u'],[/мкмоль|մկմոլ/g,'umol'],[/ммоль|մմոլ/g,'mmol'],[/нмоль|նմոլ/g,'nmol'],[/пмоль|պմոլ/g,'pmol'],[/моль|մոլ/g,'mol'],
 [/мкед/g,'uiu'],[/мед(?=\/)/g,'mu'],[/мкг|մկգ/g,'ug'],[/мг|մգ/g,'mg'],[/нг|նգ/g,'ng'],[/пг|պգ/g,'pg'],[/дл|դլ/g,'dl'],[/мл|մլ/g,'ml'],[/мме|մմմ/g,'miu'],[/мкме/g,'uiu'],[/ме|մմ(?=\/)/g,'iu'],[/ед|մ(?=\/)/g,'u'],
 [/мм|մմ/g,'mm'],[/мин|րոպե/g,'min'],[/г|գ/g,'g'],[/л|լ/g,'l'],[/ч|ժ/g,'h'],[/м(?=²|2$)/g,'m'],[/²/g,'2'],[/×/g,'*'],
];
export function normaliseUnit(raw:string|null|undefined):string{
 if(raw==null)return '';
 let u=raw.normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 for(const [re,to] of UNIT_WORDS)u=u.replace(re,to);
 u=u.replace(/^(x|\*)?10\^?9\/l$|^(x|\*)?10e9\/l$/,'10^9/l').replace(/^(x|\*)?10\^?3\/ul$|^k\/ul$/,'10^3/ul');
 u=u.replace(/^mcg\//,'ug/').replace(/^mmol\/molhb$/,'mmol/mol').replace(/^iu\/l$/,'u/l').replace(/^(mc|u)iu\/ml$/,'uiu/ml').replace(/^ml\/min(\/1[.,]73(m2|m\^2)?)?$/,u=>u.startsWith('ml/min/')?'ml/min/1.73m2':'ml/min');
 if(/^iu\/ml$/.test(u))return 'iu/ml';
 return u;
}

const fold=(s:string)=>` ${s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}()\-/+.]+/gu,' ').replace(/\s+/g,' ').trim()} `;
const ALIASES=LAB_ANALYTES.flatMap(a=>a.aliases.map(alias=>({alias,key:a.key}))).sort((x,y)=>y.alias.length-x.alias.length);
/** The analyte a printed test name names, by the longest alias found on word boundaries; null when none. */
export function matchAnalyte(testName:string):string|null{
 const name=fold(testName);
 for(const {alias,key} of ALIASES)if(name.includes(` ${alias} `)||name.startsWith(` ${alias}(`)||name.includes(` ${alias},`))return key;
 return null;
}

/** The value in the analyte's canonical unit, or null if the unit is not one it accepts. */
export function toCanonical(a:Analyte,value:number,unit:string):number|null{
 const u=a.units[normaliseUnit(unit)];
 if(!u)return null;
 return typeof u.toCanonical==='function'?u.toCanonical(value):value*u.toCanonical;
}
