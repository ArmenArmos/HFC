'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {redirect} from 'next/navigation';
import {requirePatient} from '@/lib/patient/auth';
import {ZOE_TEXT_MAX,zoeTextRoute} from '@/lib/zoe/member-screen';

export type ZoeTextState={route:'idle'|'doctor'|'empty'|'too_long';at:number};

/**
 * Screens typed text and says where it goes. No model call, no storage and no logging of the
 * text: it is read once by the urgent-word step and dropped. Urgent words open the 103 screen
 * before anything else is considered (red always wins), even for over-long text.
 */
export const routeZoeText=loggedAction("routeZoeText",async function routeZoeText(_previous:ZoeTextState,form:FormData):Promise<ZoeTextState>{
 await requirePatient();
 const raw=form.get('message');
 const text=typeof raw==='string'?raw:'';
 const route=zoeTextRoute(text);
 if(route==='urgent')redirect('/patient/zoe/urgent');
 if(route==='empty')return {route:'empty',at:Date.now()};
 if(text.length>ZOE_TEXT_MAX)return {route:'too_long',at:Date.now()};
 return {route:'doctor',at:Date.now()};
});
