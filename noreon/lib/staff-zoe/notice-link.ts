import type {Route} from 'next';
import {z} from 'zod';
import {doctorChatHomeEnabled,doctorChatV2Enabled,doctorHomePath} from './workspace-config';
const origin='https://backoffice.noreon.health';
const noticePath=/^\/staff\/real\/(?:today|alerts|unassigned|(?:members|conversations)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Only opaque notice paths may survive sign-in. Never accept an arbitrary redirect URL. */
export function staffNoticeReturnPath(value:unknown):string|null{
 return typeof value==='string'&&/^\/staff\/real\/n\/[0-9a-f]{48}$/.test(value)?value:null;
}
export function staffNoticeSignInPath(page:'/staff/real/login'|'/staff/real/verify',next:unknown):Route{
 const path=staffNoticeReturnPath(next);
 return (path?`${page}?${new URLSearchParams({next:path})}`:page) as Route;
}
/** Only an opaque alert ID may be carried into the doctor chat. */
export function staffTokenNoticeDestination(memberId:string,role:string,env:Record<string,string|undefined>=process.env,alertId?:unknown){
 const alert=z.uuid().safeParse(alertId);
 return role==='doctor'&&doctorChatV2Enabled(env)?`/staff/real/doctor-chat-v2/patient/${memberId}${alert.success?`?alert=${alert.data.toLowerCase()}`:''}`:`/staff/real/members/${memberId}`;
}

/** Only neutral staff notice destinations. No text changes, no member links, no invitation/recovery links. */
export function doctorNoticeUrl(url:string,env:Record<string,string|undefined>=process.env){
 if(!doctorChatHomeEnabled(env)||!url.startsWith(origin))return url;
 const path=url.slice(origin.length);
 return noticePath.test(path)?`${origin}/staff/real/notice/${path.slice('/staff/real/'.length)}`:url;
}
/** The authenticated landing rechecks the role: admin/nurse notices retain their exact existing destination. */
export function staffNoticeDestination(path:string,role:string,env:Record<string,string|undefined>=process.env){
 if(!noticePath.test(path))return null;
 return role==='doctor'&&doctorChatHomeEnabled(env)?doctorHomePath(role,env):path;
}
