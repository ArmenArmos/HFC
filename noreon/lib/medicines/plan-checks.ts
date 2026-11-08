/**
 * The fixed medicine list and the automatic checks for the doctor's plan form (Task 20, Armen 2 Nov). Pure: no database, no model.
 * PROPOSED until Armen and Yesayi sign them, and the form says so. The checks warn; they never block, select or suggest a medicine,
 * and the doctor decides. A missing value is not a normal one: metformin with no eGFR says so instead of passing.
 * The eGFR cuts are the usual label values, stated by no task: they need the doctors' signature like the rest.
 */
export const METFORMIN_EGFR={review:45,stop:30};

export type MedicineClass='statin'|'cholesterol_other'|'acei'|'arb'|'beta_blocker'|'ccb'|'thiazide'|'loop'|'k_sparing'|'nsaid'|'antiplatelet'|'anticoagulant'|'metformin'|'sglt2'|'glp1'|'sulfonylurea'|'thyroid'|'st_johns_wort'|'licorice';
export type Medicine={name:string;cls:MedicineClass;aliases:readonly string[]};
const m=(name:string,cls:MedicineClass,...aliases:string[]):Medicine=>({name,cls,aliases:[name.toLowerCase(),...aliases]});
/** Generic names first, each with its common Latin, Cyrillic and Armenian spellings and brands in Armenia and Russia. */
export const MEDICINE_LIST:readonly Medicine[]=[
 m('Atorvastatin','statin','аторвастатин','ատորվաստատին','atoris','аторис','liprimar','липримар','torvacard','торвакард','tulip','тулип'),
 m('Rosuvastatin','statin','розувастатин','ռոզուվաստատին','crestor','крестор','rosucard','розукард','roxera','роксера','mertenil','мертенил'),
 m('Simvastatin','statin','симвастатин','սիմվաստատին','zocor','зокор','vasilip','вазилип'),
 m('Pravastatin','statin','правастатин'),m('Pitavastatin','statin','питавастатин'),m('Fluvastatin','statin','флувастатин'),
 m('Ezetimibe','cholesterol_other','эзетимиб','էզետիմիբ','ezetrol','эзетрол'),
 m('Lisinopril','acei','лизиноприл','լիզինոպրիլ','diroton','диротон'),m('Enalapril','acei','эналаприл','էնալապրիլ','enap','энап','renitec','ренитек'),
 m('Perindopril','acei','периндоприл','պերինդոպրիլ','prestarium','престариум'),m('Ramipril','acei','рамиприл','ռամիպրիլ','tritace','тритаце','amprilan','амприлан'),m('Captopril','acei','каптоприл','կապտոպրիլ'),
 m('Losartan','arb','лозартан','լոզարտան','lorista','лориста','cozaar','козаар'),m('Valsartan','arb','валсартан','վալսարտան','valz','вальз','diovan','диован'),
 m('Telmisartan','arb','телмисартан','տելմիսարտան','micardis','микардис'),m('Candesartan','arb','кандесартан','կանդեսարտան','atacand','атаканд'),m('Irbesartan','arb','ирбесартан','aprovel','апровель'),
 m('Bisoprolol','beta_blocker','бисопролол','բիսոպրոլոլ','concor','конкор'),m('Metoprolol','beta_blocker','метопролол','մետոպրոլոլ','betaloc','беталок','egilok','эгилок'),
 m('Nebivolol','beta_blocker','небиволол','նեբիվոլոլ','nebilet','небилет'),m('Carvedilol','beta_blocker','карведилол','կարվեդիլոլ'),
 m('Amlodipine','ccb','амлодипин','ամլոդիպին','norvasc','норваск'),m('Lercanidipine','ccb','лерканидипин'),m('Nifedipine','ccb','нифедипин','նիֆեդիպին'),
 m('Hydrochlorothiazide','thiazide','гидрохлоротиазид','հիդրոքլորոթիազիդ','hctz'),m('Indapamide','thiazide','индапамид','ինդապամիդ','arifon','арифон'),m('Chlorthalidone','thiazide','хлорталидон'),
 m('Furosemide','loop','фуросемид','ֆուրոսեմիդ','lasix','лазикс'),m('Torasemide','loop','торасемид','տորասեմիդ','diuver','диувер'),
 m('Spironolactone','k_sparing','спиронолактон','սպիրոնոլակտոն','veroshpiron','верошпирон'),m('Eplerenone','k_sparing','эплеренон','էպլերենոն','inspra','инспра'),m('Amiloride','k_sparing','амилорид'),m('Triamterene','k_sparing','триамтерен'),
 m('Ibuprofen','nsaid','ибупрофен','իբուպրոֆեն','nurofen','нурофен'),m('Diclofenac','nsaid','диклофенак','դիկլոֆենակ','voltaren','вольтарен'),m('Naproxen','nsaid','напроксен','նապրոքսեն'),
 m('Ketorolac','nsaid','кеторолак','կետորոլակ','ketanov','кетанов','ketorol','кеторол'),m('Meloxicam','nsaid','мелоксикам','մելօքսիկամ','movalis','мовалис'),m('Nimesulide','nsaid','нимесулид','նիմեսուլիդ','nise','найз'),m('Celecoxib','nsaid','целекоксиб'),
 m('Aspirin','antiplatelet','аспирин','ասպիրին','acetylsalicylic','ацетилсалицил','cardiomagnyl','кардиомагнил','thrombo ass','тромбо асс'),m('Clopidogrel','antiplatelet','клопидогрел','կլոպիդոգրել','plavix','плавикс'),m('Ticagrelor','antiplatelet','тикагрелор','brilinta','брилинта'),
 m('Warfarin','anticoagulant','варфарин','վարֆարին'),m('Apixaban','anticoagulant','апиксабан','eliquis','эликвис'),m('Rivaroxaban','anticoagulant','ривароксабан','xarelto','ксарелто'),m('Dabigatran','anticoagulant','дабигатран','pradaxa','прадакса'),
 m('Metformin','metformin','метформин','մետֆորմին','glucophage','глюкофаж','siofor','сиофор'),
 m('Empagliflozin','sglt2','эмпаглифлозин','jardiance','джардинс'),m('Dapagliflozin','sglt2','дапаглифлозин','forxiga','форсига'),
 m('Semaglutide','glp1','семаглутид','ozempic','оземпик'),m('Liraglutide','glp1','лираглутид'),m('Gliclazide','sulfonylurea','гликлазид','diabeton','диабетон'),m('Glimepiride','sulfonylurea','глимепирид','amaryl','амарил'),
 m('Levothyroxine','thyroid','левотироксин','լևոթիրօքսին','euthyrox','эутирокс','l-thyroxine','l-тироксин'),
 m("St John's wort",'st_johns_wort','st. john','st john','saint john','hypericum','зверобой','խոլորձ','արյունխոտ'),
 m('Licorice','licorice','liquorice','солодк','лакрица','մատուտակ','matutak'),
];
// Short forms match as a whole word only ("arb" is not "arbidol").
const CLASS_ABBREVIATIONS:Partial<Record<MedicineClass,readonly string[]>>={acei:['acei','aceis','ace-i','ace','иапф','ингибиторы апф'],arb:['arb','arbs','бра'],beta_blocker:['bb','бб'],ccb:['ccb','ccbs','бкк'],nsaid:['nsaid','nsaids','нпвс','нпвп'],anticoagulant:['doac','doacs','noac','noacs','поак'],sglt2:['sglt2','sglt-2'],glp1:['glp1','glp-1']};
const CLASS_WORDS:Partial<Record<MedicineClass,readonly string[]>>={statin:['statin','статин','ստատին'],acei:['ace inhibitor','ace-inhibitor','иапф','ингибитор апф'],arb:['sartan','сартан','սարտան'],ccb:['calcium channel','calcium blocker','блокатор кальциевых'],beta_blocker:['beta blocker','beta-blocker','бета-блокатор','бета блокатор'],nsaid:['nsaid','нпвс','нпвп','anti-inflammator'],antiplatelet:['antiplatelet'],anticoagulant:['anticoagulant','blood thinner','антикоагулянт']};

const norm=(t:string)=>t.normalize('NFKC').toLocaleLowerCase('en').replaceAll('’',"'").replace(/\s+/gu,' ').trim();
// From the start of a word, so "amlodipine" does not match inside another name; an alias may be a stem.
const hasAlias=(t:string,a:string)=>{for(let i=t.indexOf(a);i>=0;i=t.indexOf(a,i+1))if(i===0||!/\p{L}/u.test(t[i-1]!))return true;return false;};
/** Every listed medicine in what the doctor typed: more than one for a combination ("Lisinopril + amlodipine"). */
export const findMedicines=(typed:string):Medicine[]=>{const t=norm(typed);return MEDICINE_LIST.filter(x=>x.aliases.some(a=>hasAlias(t,a)));};

export type MedicineCheckRule='allergy'|'duplicate_class'|'acei_arb'|'k_sparing_acei'|'nsaid'|'egfr_metformin'|'egfr_missing'|'herbal'|'not_on_list'|'not_recognised';
export type MedicineWarning={rule:MedicineCheckRule;medicines:string[];detail?:string};
type Input={/** The plan as the form holds it. */plan:readonly string[];/** What the member says they take. */others?:readonly string[];allergies?:string;egfr?:number|null};

const classes=(xs:readonly Medicine[],...c:MedicineClass[])=>xs.filter(x=>c.includes(x.cls));
const uniq=(xs:readonly Medicine[])=>[...new Map(xs.map(x=>[x.name,x])).values()];
const names=(xs:readonly Medicine[])=>xs.map(x=>x.name);
const allergyHits=(allergies:string,meds:readonly Medicine[])=>{
 const terms=norm(allergies).split(/[,;\n/]+/u).map(t=>t.trim()).filter(t=>t.length>=3);
 const words=(t:string)=>t.split(/[^\p{L}\d-]+/u);
 return meds.filter(x=>terms.some(t=>x.aliases.some(a=>hasAlias(t,a)||hasAlias(a,t))||(CLASS_WORDS[x.cls]??[]).some(w=>hasAlias(t,w))||(CLASS_ABBREVIATIONS[x.cls]??[]).some(w=>words(t).includes(w))));
};

/** Every proposed check that fires for this plan, in a fixed order. Empty when nothing fires. */
export function planMedicineChecks({plan,others=[],allergies='',egfr=null}:Input):MedicineWarning[]{
 const typed=[...plan,...others].map(t=>t.trim()).filter(Boolean);
 const found=typed.flatMap(t=>findMedicines(t)),all=uniq(found),out:MedicineWarning[]=[];
 for(const x of allergyHits(allergies,all))out.push({rule:'allergy',medicines:[x.name]});
 // Two antiplatelets are usual after a stent, so that class is not a duplicate.
 for(const c of new Set(all.map(x=>x.cls)))if(c!=='st_johns_wort'&&c!=='licorice'&&c!=='antiplatelet'){const same=classes(all,c);if(same.length>1)out.push({rule:'duplicate_class',medicines:names(same),detail:c});}
 // The same medicine on two plan lines under two names (a brand and a generic). A member's own list naming a plan medicine is no duplicate.
 const planLines=plan.map(t=>t.trim()).filter(Boolean);
 for(const x of all){const lines=planLines.filter(t=>findMedicines(t).some(y=>y.name===x.name));if(new Set(lines.map(norm)).size>1)out.push({rule:'duplicate_class',medicines:lines,detail:x.cls});}
 const acei=classes(all,'acei'),arb=classes(all,'arb'),sparing=classes(all,'k_sparing'),nsaid=classes(all,'nsaid');
 if(acei.length&&arb.length)out.push({rule:'acei_arb',medicines:names([...acei,...arb])});
 if(acei.length&&sparing.length)out.push({rule:'k_sparing_acei',medicines:names([...sparing,...acei])});
 if(nsaid.length)out.push({rule:'nsaid',medicines:names([...nsaid,...classes(all,'acei','arb','thiazide','loop','k_sparing','anticoagulant','antiplatelet')])});
 if(all.some(x=>x.cls==='metformin')){
  if(egfr===null||!Number.isFinite(egfr))out.push({rule:'egfr_missing',medicines:['Metformin']});
  else if(egfr<METFORMIN_EGFR.review)out.push({rule:'egfr_metformin',medicines:['Metformin'],detail:String(egfr)});
 }
 for(const x of classes(all,'st_johns_wort','licorice'))out.push({rule:'herbal',medicines:[x.name],detail:x.cls});
 for(const t of planLines)if(!findMedicines(t).length)out.push({rule:'not_on_list',medicines:[t]});
 const unknown=others.map(t=>t.trim()).filter(t=>t&&!findMedicines(t).length);
 if(unknown.length)out.push({rule:'not_recognised',medicines:unknown});
 return out;
}

type Say=(en:string,hy:string,ru:string)=>string;
/** One line for the doctor. STAGING WORDING: the Armenian and Russian are not approved. */
export function medicineWarningText(w:MedicineWarning,t:Say):string{
 const list=w.medicines.join(', ');
 switch(w.rule){
  case 'allergy':return t(`${list} may match a recorded allergy or intolerance.`,`${list}՝ կարող է համընկնել նշված ալերգիայի կամ անտանելիության հետ։`,`${list}: возможно совпадение с указанной аллергией или непереносимостью.`);
  case 'duplicate_class':return t(`Same class or same medicine twice: ${list}.`,`Նույն խումբը կամ նույն դեղը երկու անգամ՝ ${list}։`,`Один класс или одно лекарство дважды: ${list}.`);
  case 'acei_arb':return t(`ACE inhibitor with an ARB: ${list}.`,`ԱՓՖ արգելակիչ և ARB միասին՝ ${list}։`,`ИАПФ вместе с сартаном: ${list}.`);
  case 'k_sparing_acei':return t(`Potassium-sparing medicine with an ACE inhibitor, check potassium: ${list}.`,`Կալիում խնայող դեղ և ԱՓՖ արգելակիչ, ստուգեք կալիումը՝ ${list}։`,`Калийсберегающий препарат вместе с ИАПФ, проверьте калий: ${list}.`);
  case 'nsaid':return t(`NSAID: can raise blood pressure, affect the kidneys with ACE inhibitors, ARBs or diuretics, and raise bleeding risk with blood thinners: ${list}.`,`ՈՍՀԴ՝ կարող է բարձրացնել ճնշումը, ազդել երիկամների վրա ԱՓՖ արգելակիչների, ARB-ների կամ միզամուղների հետ և մեծացնել արյունահոսության ռիսկը՝ ${list}։`,`НПВС: могут повышать давление, влиять на почки при ИАПФ, сартанах или диуретиках и повышать риск кровотечения: ${list}.`);
  case 'egfr_metformin':return Number(w.detail)<METFORMIN_EGFR.stop
   ?t(`Metformin with eGFR ${w.detail}: below ${METFORMIN_EGFR.stop}.`,`Մետֆորմին, eGFR ${w.detail}՝ ${METFORMIN_EGFR.stop}-ից ցածր։`,`Метформин при рСКФ ${w.detail}: ниже ${METFORMIN_EGFR.stop}.`)
   :t(`Metformin with eGFR ${w.detail}: below ${METFORMIN_EGFR.review}, review the dose.`,`Մետֆորմին, eGFR ${w.detail}՝ ${METFORMIN_EGFR.review}-ից ցածր, վերանայեք դեղաչափը։`,`Метформин при рСКФ ${w.detail}: ниже ${METFORMIN_EGFR.review}, пересмотрите дозу.`);
  case 'egfr_missing':return t('Metformin: no eGFR entered here, so the kidney check did not run.','Մետֆորմին. eGFR չի նշված, երիկամների ստուգումը չի կատարվել։','Метформин: рСКФ не указана, проверка почек не выполнена.');
  case 'herbal':return w.detail==='licorice'
   ?t('Licorice: can raise blood pressure and lower potassium.','Մատուտակ՝ կարող է բարձրացնել ճնշումը և իջեցնել կալիումը։','Солодка: может повышать давление и снижать калий.')
   :t("St John's wort: interacts with many medicines, including statins, blood thinners and BP medicines.",'Սուրբ Հովհաննեսի խոտ՝ փոխազդում է շատ դեղերի հետ, այդ թվում ստատինների, արյան նոսրացնողների և ճնշման դեղերի։','Зверобой: взаимодействует со многими лекарствами, включая статины, антикоагулянты и препараты от давления.');
  case 'not_recognised':return t(`Medicines not recognised: ${list}.`,`Չճանաչված դեղեր՝ ${list}։`,`Лекарства не распознаны: ${list}.`);
  case 'not_on_list':return t(`Not on the medicine list, so not checked: ${list}.`,`Դեղերի ցանկում չէ, ուստի չի ստուգվել՝ ${list}։`,`Нет в списке лекарств, поэтому не проверено: ${list}.`);
 }
}
