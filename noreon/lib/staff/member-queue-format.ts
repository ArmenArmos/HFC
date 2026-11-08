// Build a stable 24-hour display from numeric parts. Server/browser ICU may use
// different punctuation for hy-AM, causing hydration replacement during input.
export function memberRequestedAt(value:string):string{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=(kind:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===kind)!.value;
 return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}
