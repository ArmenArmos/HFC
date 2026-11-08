import {pick, type Locale} from "@/lib/locale";

/** AMD amounts are whole drams. Grouped by hand so server and browser render the same text. */
export function amd(value:number,locale:Locale='en'){
 const grouped=String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g,locale==='en'?',':' ');
 return pick(locale,{en:`AMD ${grouped}`,hy:`${grouped} դրամ`,ru:`${grouped} драм`});
}

/** A Yerevan calendar day (UTC+4 all year) as YYYY-MM-DD. */
export const yerevanDay=(ms:number)=>new Date(ms+4*3600000).toISOString().slice(0,10);
export const yerevanToday=()=>yerevanDay(Date.now());
