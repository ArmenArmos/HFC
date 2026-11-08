import {normaliseText} from './normalise';
import {isNumberWord} from './number-words';
import {chestPastOrStableNotNow,isChestRecoverySentence,mentionsChestDangerWord,hasSettledChestVocabulary} from './symptoms/red-flags';
import {mentionsSymptomWord} from './symptom-words';

/**
 * Only the existing recent-alert path uses this gate, after deterministic red flags.
 * Food questions use a closed vocabulary; unclassified content always keeps confirmation.
 * Settled chest reports retain a closed vocabulary and the red-flag module's full absence guards.
 */
const set=(s:string)=>new Set(normaliseText(s).split(/\s+/u).filter(Boolean));

/** Food and drink words, whole words only. */
const FOOD='eat eating food foods diet drink drinking salt sodium coffee tea water breakfast lunch dinner meal meals recipe recipes snack snacks fruit fruits vegetable vegetables bread rice meat fish egg eggs milk cheese potato potatoes nuts honey oil juice soup salad pasta beans butter sugar alcohol herbs spices spice lemon garlic onion pepper vinegar '
 +'ем есть еда еду пить пью соль соли солью кофе чай чаю вода воды воду завтрак обед ужин диета диеты диету сахар сахара фрукты овощи хлеб рис мясо рыба рыбу яйца молоко сыр картошка орехи мёд мед масло сок суп салат травы специи лимон чеснок лук перец уксус '
 +'ուտեմ ուտել խմեմ խմել սնունդ կերակուր ճաշ նախաճաշ ընթրիք դիետա աղ աղի աղը աղն շաքար շաքարի սուրճ սուրճը սուրճի թեյ թեյը թեյի ջուր ջուրը ջրի հաց հացի մսի ձկան ձվի կաթի մրգի համեմունքի բրինձ մրգեր միս ձուկ ձու կաթ պանիր կարտոֆիլ ընկույզ մեղր յուղ հյութ ապուր աղցան համեմունք համեմունքներ կանաչի լիմոն սխտոր սոխ պղպեղ քացախ '
 +'utem utel xmem xmel agh aghi aghy sukhr surj tey jur hac brinj mis dzuk dzu kat panir nakhachash chash yntrik';
const FOOD_WORDS=set(FOOD+' salty salted sweet sweets chocolate chips crisps pizza burger bacon sausage pickles wine beer vodka soda cola energy cook cooking cooked oatmeal have '
 +' съесть выпить кушать приготовить готовить пища солёное соленое жареную картошку шоколад чипсы пицца бургер бекон колбаса соленья вино пиво водка газировка кола '
 +' խորոված գինի գարեջուր օղի շոկոլադ չիփս պիցցա քաղցր քաղցրավենիք մրգեր հյութ '
 +' utum utelu xmelu khmel khmem kerakur snund xorovac khorovats gini garejur '
 +' spicy fried grilled fatty homemade aubergine aubergines eggplant eggplants casserole fermented soybean soybeans stew salty salted sweet savory savoury baked boiled steamed roasted raw fresh frozen dried low fat wholegrain wholemeal brown white red green black decaf caffeine smoothie smoothies yogurt yoghurt kefir cream curd cottage beef pork chicken turkey lamb lentils chickpeas peas oats wheat buckwheat porridge cereal cereals toast sandwich sandwiches soup soups salads desserts cake cakes biscuit biscuits cookie cookies icecream ice apple apples pear pears banana bananas orange oranges mandarin mandarins peach peaches apricot apricots plum plums grape grapes cherry cherries strawberry strawberries raspberry raspberries blueberry blueberries watermelon melon cucumber cucumbers tomato tomatoes carrot carrots cabbage broccoli cauliflower spinach beet beetroot pumpkin zucchini courgette squash mushrooms lettuce avocado avocados dates raisins walnut walnuts almond almonds peanut peanuts hazelnut hazelnuts pistachio pistachios cashew cashews sunflower sesame pumpkinseed olive olives ketchup mayonnaise mustard jam lentil boiled baking frying grilling steaming seasoning boiled unsalted unsweetened sparkling mineral sparkling '
 +' острое острую острый сладкое сладкую сладкий жареное жареный жирное жирную жирный вареное варёное вареную варёную запеченное запечённое запеченную запечённую свежие свежий свежую сырые печеное печёное гриль тушеное тушёное домашнюю домашнее баклажаны баклажан баклажанов рагу соя соевые бобы фасоль чечевица горох овсянка овсянку гречка гречку макароны макарон хлеба хлебом сыра сыром орехов яблоко яблоки яблок грушу груши банан бананы апельсин апельсины абрикос абрикосы персик персики виноград сливу сливы вишня клубника арбуз дыня огурец огурцы огурцов помидор помидоры помидоров морковь моркови морковью капуста капусты капусту брокколи шпинат свекла свёкла тыква кабачок кабачки грибы авокадо миндаль арахис фисташки йогурт кефир творог сливки курица курицу курицы индейка говядина свинина баранина рыбы рыбой яйцо яиц яйцами молока молоком вина вином пива пивом водки соком сока чая чаем супа супом салата салатом оливки горчица майонез варенье меда мёда сахару напиток напитки запечь сварить испечь готовка варить жарить запекать тушить '
 +' կծու տապակած եփած շոգեխաշած խորովել եփել պատրաստել պատրաստած յուղոտ աղած անալի անշաքար թարմ չոր քաղցրավենիքներ բուրգեր բեկոն երշիկ թթու մակարոն մակարոնեղեն բրինձ բրնձի հացը հացով պանիրը պանրի պանրով կարտոֆիլը կարտոֆիլի կարտոֆիլով մրգերը մրգերի բանջարեղեն բանջարեղենի խնձոր խնձորը խնձորի տանձ բանան նարինջ մանդարին ծիրան դեղձ սալոր խաղող բալ կեռաս ելակ ազնվամորի հապալաս ձմերուկ սեխ վարունգ լոլիկ գազար կաղամբ բրոկոլի ծաղկակաղամբ սպանախ ճակնդեղ դդում սմբուկ սունկ ավոկադո ընկույզի նուշ գետնանուշ պիստակ հավ հավի տավարի խոզի գառան ոսպ լոբի սիսեռ վարսակ հնդկաձավար մածուն յոգուրտ կեֆիր կաթնաշոռ թթվասեր ձիթապտուղ սոդա կոլա չիպս չիպսեր բրնձով ձկանով հյութը գինին գինու ջրով կաթով '
 +' kcu tapakac yepac epac yuxot axac aghac qaxcr qaghtsr shokolad chips pizza burger bekon ershik pasta makaron xndzor xnjor tandz banan narinj ciran tsiran deghdz salor xaxox varung lolik gazar kaxamb smbuk sunk yntuyz nsh nu shakar shakarov aghov huty ginin paniry panrov hacov brndzov hav havov matcun macun');
// Inflected food/meal words only; a danger check still runs before these stems.
const FOOD_STEM=/^(?:(?:сол[её]н|жарен|вар[её]н|печ[её]н|туш[её]н)(?:ое|ую|ый|ая|ые|ого|ой|ым|ых)|(?:картошк|пицц|колбас|каши)(?:а|у|и|е|ой|ою)?|(?:шоколад|завтрак|ужин|обед|рецепт)(?:а|у|ы|ов|ом|е)?|(?:ընթրիք|նախաճաշ|կերակուր|խորոված|գինի|շոկոլադ)(?:ը|ն|ի|ին|ով|ից|ներ|ները|ների)?|ուտ(?:եմ|ել|ում|ելու)|խմ(?:եմ|ել|ում|ելու))$/u;
const foodWord=(w:string)=>FOOD_WORDS.has(w)||FOOD_STEM.test(w);

/** Question and function words around a food word. No word that names a person's state, a body part or a symptom. */
const FRAME_FOOD=set('what which how much many can could should may do does is are it ok okay safe i eat instead of in for with without the a an to use replace substitute substitutes alternative alternatives good best healthy normal less more some any per day daily at tonight today or and have get '
 +'что какой какая какие как сколько можно ли мне вместо в на для с без и или лучше полезно нормально можно ли ли сегодня вечером утром я могу '
 +'իսկ ինչ ինչով ինչպես որքան կարելի է արդյոք փոխարեն փոխարինել փոխարինող փոխարինիչ փոխարինիչը լավ առողջ ավելի քիչ մեջ հետ առանց համար օրը օրվա այսօր երեկոյան առավոտյան և եւ ու կամ կարող եմ '
 +'inch inchov inchpes kareli e ardyoq pokharen pokharinel lav aveli qich het arandz hamar or aysor karox em '
 +'when where whether me my we our us please tomorrow this week every allowed fine bad healthy glass cup portion little bit one two three four five '
 +'а чем стоит нужно мой мы нам у по из завтра каждый день немного стакан порция это '
 +'բան իմ ինձ մենք մեր վաղը ամեն օր այս շաբաթ մի բաժակ քիչ երկու երեք '
 +'erb vortegh vorqan inchqan karogh karoghem ays shabat amen or mi bajak '
 +'after before during about at into from up out as than then breakfasttime lunchtime dinnertime weekly morning mornings evening evenings afternoon midday midnight twice thrice once six seven eight nine ten fifteen twenty thirty half quarter grams gram kilograms kilogram kg g ml milliliters millilitres liter litre liters litres cups glasses spoon spoons teaspoon teaspoons tablespoon tablespoons servings serving portions piece pieces slices slice handful bowl bowls bottle bottles amount amounts quantity quantities moderate moderation enough too very also only still '
 +'после до перед при около между через сколько которого каких такую такой такое так это ли заменить заменять утром ночь ночью утро вечер неделю недели месяц раз раза разу грамм граммов килограмм литр литра литров мл половину половина четверть кусок кусочка кусочки ложка ложки чашка чашки стакана стаканов порции порцию порций количество небольшую большую маленькую немного много умеренно ежедневно пожалуйста '
 +'հետո առաջ ընթացքում մոտ մինչև քանակ ինչքան որ քանի անգամ գրամ կիլոգրամ լիտր կես քառորդ բաժակներ բաժակով գդալ կտոր չափ չափով քանակով առավոտ երեկո գիշեր ամենօրյա շաբաթը չափավոր շատ փոքր մեծ միայն խնդրում '
 +'heto araj ynthacqum qanakerov qanakov qanak chapov shat qich kes qarrord gram litr kt or');
const QUESTION=set('can could may should is are do does what which how when where whether можно что какой какая какие как сколько чем стоит нужно ինչ ինչպես ինչով որքան կարելի կարող inch inchpes inchov vorqan inchqan kareli karox karogh karoghem');

// Broad by design: a false match costs a second check. Reuse the symptom typo/stem matcher and chest danger lists,
// then cover body parts, negations and personal-state verbs which those clinical lists do not need to enumerate.
const DANGER=/^(?:pain|hurt|ache|dizz|faint|numb|weak|sweat|vomit|nause|breath|arm|jaw|neck|throat|tongue|face|vision|eye|speech|head|stomach|belly|leg|hand|blood|bleed|pressure|fever|swallow|chok|paraly|collaps|unconscious|seizure|burn|tight|pressing|worse|again|still|severe|sudden|swell|clos|scared|strength|stroke|attack|infarct|suffocat|black|passed$|passing$|conscious|convuls|shak|trembl|unwell|sick|ill|trouble|mov|losing|loss|was$|were$|been$|being$|i'm$|i've$|i'd$|i'll$|broke$|broken$|break$|breaks$|breaking$|leak|ruptur|am$|feel|felt|got$|getting|start|began|not$|no$|never$|unable|can'?t$|cannot$|couldn'?t$|don'?t$|doesn'?t$|isn'?t$|бол|боль|круж|чувств|стало|стал$|нач|онем|слаб|груд|серд|давл|голов|рук|ног|челюст|горл|язык|лиц|глаз|зрен|реч|живот|кров|кровот|жар$|температ|глот|удуш|задых|парализ|плох|самочув|холод|закрыв|пот|не$|нет$|никогда|снова|всёещё|ցավ|զգ|սկս|գլխ|գլուխ|աչք|տեսող|ձեռ|թեւ|ոտք|ծնոտ|կուրծ|կրծ|վատ|կոկորդ|լեզվ|դեմք|արյ|ճնշ|ջերմ|կուլ$|խեղդ|թմր|թուլ|քրտ|սառը|ուռ|փակ|կաթված|կրկին|դեռ|չ|ոչ$|chem$|chka$|chi$|voch$|cav|tsav|zgum|zgal|sk(s|z)|glx|glukh|achq|tesox|tesogh|dzer|te[vw]|votq|dznot|kokord|lezv|demq|aryun|c(h)?nsh|jerm|kul$|kheghd|xexd|tmr|tul|qrtn|sary|urac|vat|pakv|katvac|krkin|der$)\p{L}*$/u;
// Exact food words disambiguate descriptors such as «острое» (spicy) and black tea.
// This does not admit a danger word via a stem or an unknown slot.
const dangerWord=(w:string)=>!FOOD_WORDS.has(w)&&(DANGER.test(w)||mentionsChestDangerWord(w)||mentionsSymptomWord(w));

/** A settled past chest episode, in a closed vocabulary: the whole message says only that. */


const tokens=(raw:string)=>normaliseText(raw).replaceAll('’',"'").replace(/[՞՜՛]/gu,'').toLowerCase().match(/[\p{L}\p{N}']+/gu)??[];

const AMBIGUOUS_FOOD=set('sodium sugar сахара сахар сахару շաքար շաքարի շաքարը glucose cholesterol salt соль соли солью աղ աղի աղը աղն shakar');
const POSSESSIVE=set('my our your his her their мой моя моё мое мои моего моей наш наша իմ մեր քո իր');
const INGREDIENT_FRAME=set('eat eating drink drinking have use replace substitute substitutes alternative alternatives recipe recipes cook cooking '
 +'есть съесть пить выпить приготовить готовить заменить заменять вместо чем '
 +'ուտեմ ուտել խմեմ խմել փոխարեն փոխարինել ինչով utem utel xmem xmel pokharen pokharinel inchov');
const ambiguousFoodIsIngredient=(t:string[])=>!t.some(w=>AMBIGUOUS_FOOD.has(w))||(
 !t.some((w,i)=>AMBIGUOUS_FOOD.has(w)&&POSSESSIVE.has(t[i-1]??''))&&(t.some(w=>INGREDIENT_FRAME.has(w))||t.some((w,i)=>['in','with','в','с','մեջ','հետ'].includes(w)&&t.slice(i+1).some(x=>foodWord(x)&&!AMBIGUOUS_FOOD.has(x))))&&
 !t.some(w=>['normal','high','low','нормально','высокий','низкий','նորմալ','բարձր','ցածր'].includes(w))
);

/** Each sentence must carry its own question frame; punctuation on a neighbouring question cannot qualify a statement. */
const plainFoodQuestion=(sentence:string)=>{
 const t=tokens(sentence);
 if(!(/[?՞]/u.test(sentence)||t.slice(0,3).some(w=>QUESTION.has(w)))||!t.length||t.length>14||/\p{N}/u.test(sentence)||t.some(w=>isNumberWord(w))||!ambiguousFoodIsIngredient(t)||!t.some(foodWord)||t.some(dangerWord))return false;
 return t.every(w=>foodWord(w)||FRAME_FOOD.has(w));
};

/** Closed vocabulary across a settled report, including an adjacent personal recovery sentence when the clinical guard allows it. */
export const plainSettledChest=(sentence:string)=>{
 // This fixed recovery idiom contains a grammatical negation; no general negation token is admitted.
 const t=tokens(normaliseText(sentence).replace(/сейчас ничего не беспокоит|հիմա ոչինչ չի ցավում/gu,'gone'));
 const sentences=normaliseText(sentence).split(/[.!?;։\n]+/u).map(sn=>sn.trim()).filter(Boolean);
 const accounted=sentences.every((sn,i)=>tokens(sn).length<=20&&(chestPastOrStableNotNow(sn)||isChestRecoverySentence(sn)||!!sentences[i+1]&&isChestRecoverySentence(sentences[i+1]!)&&chestPastOrStableNotNow(`${sn}. ${sentences[i+1]}`)));
 return t.length>0&&accounted&&chestPastOrStableNotNow(sentence)&&hasSettledChestVocabulary(sentence);
};

/** True only when the entire message is accounted for by the two permitted shapes. */
export function plainRequestAfterAlert(raw:string):boolean{
 const sentences=raw.match(/[^.!?;։\n]+[.!?;։\n]*/gu)?.filter(x=>x.trim())??[];
 return sentences.length>0&&(plainSettledChest(raw)||sentences.every(sn=>plainSettledChest(sn)||plainFoodQuestion(sn)));
}
