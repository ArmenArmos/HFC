'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {careAlertMemberStatus} from '@/lib/care-alerts/member';

/** The signed-in member's own alert status for one message, while the 103 screen waits for it. Null when it cannot be read. */
export const readZoeUrgentStatus=loggedAction("readZoeUrgentStatus",async function readZoeUrgentStatus(request:string){
 return (await careAlertMemberStatus(request))?.zoe??null;
});
