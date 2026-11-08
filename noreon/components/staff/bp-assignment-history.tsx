import type{Locale}from'@/lib/locale';
import type{BpAssignment}from'@/lib/bp-device/schema';
import{yerevanStamp}from'@/lib/staff/yerevan-time';

const copy={
 en:{from:'From',until:'until',now:'now',by:'by',why:'Reason',ended:'Ended by',admin:'admin',nurse:'nurse',label:'Holding periods, newest first'},
 hy:{from:'Սկսած',until:'մինչև',now:'հիմա',by:'գրանցել է',why:'Պատճառը',ended:'Ավարտել է',admin:'ադմինիստրատոր',nurse:'բուժքույր',label:'Ժամանակահատվածներ, նորերը վերևում'},
 ru:{from:'С',until:'до',now:'сейчас',by:'записал(а)',why:'Причина',ended:'Завершил(а)',admin:'администратор',nurse:'медсестра',label:'Периоды пользования, сначала новые'},
} satisfies Record<Locale,{from:string;until:string;now:string;by:string;why:string;ended:string;admin:string;nurse:string;label:string}>;
/** Who held which monitor, when, and why each period started and ended. */
export function BpAssignmentHistory({history,locale,showMember=false}:{history:BpAssignment[];locale:Locale;showMember?:boolean}){
 const t=copy[locale];
 return <ol aria-label={t.label} className="divide-y">{history.map(item=><li key={item.id} className="space-y-1 py-3 text-body2">
  <p className="break-words font-medium">{showMember?item.memberName:item.serial} · {t.from} <time dateTime={item.assignedAt}>{yerevanStamp(item.assignedAt,locale)}</time> {t.until} {item.endedAt?<time dateTime={item.endedAt}>{yerevanStamp(item.endedAt,locale)}</time>:t.now}</p>
  <p className="break-words text-muted-foreground">{t.by} {item.assignedBy.name}, {t[item.assignedBy.role]}{item.assignReason&&<> · {t.why}: {item.assignReason}</>}</p>
  {item.endedBy&&<p className="break-words text-muted-foreground">{t.ended} {item.endedBy.name}, {t[item.endedBy.role]} · {t.why}: {item.endReason}</p>}
 </li>)}</ol>;
}
