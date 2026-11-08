import {clinicalLocale} from '@/lib/locale';
import {zoeStatement} from '@/lib/zoe/consent-copy';
import {tx,type PatientLocale} from '@/lib/patient/copy';

/**
 * Every word of the chat consent under V3, in the order shown. The screen renders these lines and the server hashes
 * them, so the stored hash is of the exact text the member saw. DRAFT wording, pending legal, Tatevik and the clinicians.
 */
export function consentLines(l:PatientLocale,directAnswers:boolean){
 return {
  title:tx(l,'Zoe-ն անջատված է ձեզ համար','Zoe is off for you','Zoe для вас выключена'),
  lead:tx(l,'Միացրեք նրան, որպեսզի նա կարողանա զրուցել ձեզ հետ և օգնել ձեր խնամքի թիմին։','Turn her on so she can chat with you and help your care team.','Включите её, чтобы она могла общаться с вами и помогать вашей медицинской команде.'),
  statement:zoeStatement(clinicalLocale(l),directAnswers),
  either:tx(l,'Ձեր հաղորդագրությունները ամեն դեպքում հասնում են ձեր խնամքի թիմին։','Your messages reach your care team either way.','Ваши сообщения в любом случае поступают вашей медицинской команде.'),
  moreTitle:tx(l,'Ինչ ենք հավաքում, ով է տեսնում','What we collect, who sees it','Что мы собираем и кто это видит'),
  more:[
   tx(l,'Ինչ ենք հավաքում՝ ձեր հաղորդագրությունները, պատասխանները, չափումները և դեղերը, որոնք նշում եք։','What we collect: your messages, your answers, your readings and the medicines you tell us about.','Что мы собираем: ваши сообщения, ответы, измерения и лекарства, которые вы указываете.'),
   tx(l,'Ով է տեսնում՝ Zoe-ն և ձեր խնամքի թիմը՝ ձեր բժիշկը և բուժքույրը։','Who sees it: Zoe and your care team, meaning your doctor and nurse.','Кто это видит: Zoe и ваша медицинская команда, то есть ваш врач и медсестра.'),
   tx(l,'Zoe-ն բժիշկ չէ և ախտորոշում չի դնում։','Zoe is not a doctor and does not diagnose.','Zoe не врач и не ставит диагнозы.'),
  ],
 };
}
export const consentText=(l:PatientLocale,directAnswers:boolean)=>{
 const c=consentLines(l,directAnswers);
 return [c.title,c.lead,c.statement,c.either,c.moreTitle,...c.more].join('\n');
};
