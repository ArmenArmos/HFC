import type {Locale} from '@/lib/locale';
// Armenia keeps UTC+04:00 all year, so staff times are entered and shown in that
// offset. Formatting is by hand: server and browser ICU disagree on Armenian
// punctuation, which caused hydration mismatches before (search finding S1).
const offsetMs=4*60*60*1000;
const months:Record<Locale,string[]>={en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],hy:['հնվ','փտվ','մրտ','ապր','մյս','հնս','հլս','օգս','սեպ','հոկ','նոյ','դեկ'],ru:['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']};
const pad=(n:number)=>String(n).padStart(2,'0');
export function yerevanStamp(iso:string,locale:Locale){
 const ms=Date.parse(iso);if(!Number.isFinite(ms))return iso;
 const d=new Date(ms+offsetMs);
 return `${d.getUTCDate()} ${months[locale][d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** The current Yerevan wall-clock time in datetime-local format. */
export function yerevanInputNow(now=Date.now()){
 const d=new Date(now+offsetMs);
 return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** datetime-local text (Yerevan wall clock) to an ISO instant with its offset. */
export function yerevanInputToInstant(value:string){
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);if(!match)return null;
 const iso=`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+04:00`;
 return Number.isFinite(Date.parse(iso))&&Number(match[4])<24&&Number(match[5])<60?iso:null;
}
/** A calendar date (YYYY-MM-DD, no time) as "14 Mar 1974"; anything else is shown unchanged. */
export function calendarDate(value:string,locale:Locale){
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return value;
 const month=Number(match[2]);if(month<1||month>12)return value;
 return `${Number(match[3])} ${months[locale][month-1]} ${match[1]}`;
}
