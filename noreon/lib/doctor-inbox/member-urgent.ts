import type {CareAlert} from '@/lib/care-alerts/contracts';
import type {UrgentWindow} from './urgent-windows';

/** What still needs the doctor for one member: unresolved alerts, newest first, and the open 103 window if there is one. */
export function memberUrgent(alerts:readonly CareAlert[],windows:readonly UrgentWindow[],memberId:string){
 return {
  alerts:alerts.filter(alert=>alert.memberId===memberId&&alert.state!=='resolved').sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id)),
  window:windows.find(window=>window.memberId===memberId)??null,
 };
}
export type MemberUrgent=ReturnType<typeof memberUrgent>&{incomplete:boolean};
