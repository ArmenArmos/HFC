import {pick,type Locale} from '@/lib/locale';

export function memberGreeting(locale:Locale,now:Date,name:string){
 const hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hourCycle:'h23',timeZone:'Asia/Yerevan'}).format(now));
 const line=hour<5?{en:'Hello',hy:'Բարև',ru:'Здравствуйте'}
  :hour<12?{en:'Good morning',hy:'Բարի առավոտ',ru:'Доброе утро'}
  :hour<18?{en:'Good afternoon',hy:'Բարի օր',ru:'Добрый день'}
  :{en:'Good evening',hy:'Բարի երեկո',ru:'Добрый вечер'};
 return `${pick(locale,line)}, ${name}`;
}
