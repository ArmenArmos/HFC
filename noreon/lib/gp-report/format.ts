/** Bilingual text. Every report string is written in both languages at build time,
 * so the two language versions carry the same values, dates and sources. */
export type L={en:string;hy:string};
export const l=(en:string,hy:string):L=>({en,hy});
export const join=(parts:L[],sep:L=l('; ','; ')):L=>({en:parts.map(p=>p.en).join(sep.en),hy:parts.map(p=>p.hy).join(sep.hy)});
export const cat=(...parts:(L|string)[]):L=>({en:parts.map(p=>typeof p==='string'?p:p.en).join(''),hy:parts.map(p=>typeof p==='string'?p:p.hy).join('')});

// Armenia keeps UTC+04:00 all year. Formatting is by hand so server and browser agree.
const offsetMs=4*60*60*1000;
const monthsEn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad=(n:number)=>String(n).padStart(2,'0');
function yerevan(iso:string){const ms=Date.parse(iso);return Number.isFinite(ms)?new Date(ms+offsetMs):null;}
/** "15 Oct 2026" / "15.10.2026" (the worked example's styles). */
export function day(iso:string):L{
 const plain=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
 if(plain)return l(`${Number(plain[3])} ${monthsEn[Number(plain[2])-1]} ${plain[1]}`,`${plain[3]}.${plain[2]}.${plain[1]}`);
 const d=yerevan(iso);if(!d)return l(iso,iso);
 return l(`${d.getUTCDate()} ${monthsEn[d.getUTCMonth()]} ${d.getUTCFullYear()}`,`${pad(d.getUTCDate())}.${pad(d.getUTCMonth()+1)}.${d.getUTCFullYear()}`);
}
export function dayTime(iso:string):L{
 const d=yerevan(iso);if(!d)return l(iso,iso);
 const t=`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
 const date=day(iso);return l(`${date.en}, ${t}`,`${date.hy}, ${t}`);
}
export function time(iso:string):string{const d=yerevan(iso);return d?`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`:iso;}
/** The Yerevan calendar date of an instant, as YYYY-MM-DD. */
export function yerevanDate(iso:string):string{
 const d=yerevan(iso);return d?`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`:iso.slice(0,10);
}
export function dayRange(fromIso:string,toIso:string):L{
 const a=day(fromIso),b=day(toIso);
 return a.en===b.en?a:l(`${a.en} to ${b.en}`,`${a.hy}–${b.hy}`);
}
