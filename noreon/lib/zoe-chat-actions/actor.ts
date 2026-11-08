import 'server-only';
import {patientIdentityForSave} from '@/lib/patient/auth';

declare const verified:unique symbol;
/**
 * The member a card command acts for. It exists only after a channel verified them on its own terms: the app from the
 * session, Telegram from the bound chat in the database (channel_inbox_process). A command never takes a member id from
 * input, and nothing but the two adapters mints one (scripts/check-zoe-card-commands.ts holds that).
 */
export type MemberActor=Readonly<{memberId:string;channel:'app'|'telegram';[verified]:true}>;
export const mintActor=(memberId:string,channel:MemberActor['channel'])=>Object.freeze({memberId,channel}) as MemberActor;

/** The signed-in member, or null (signed out, or the auth service is failing). */
export async function sessionActor():Promise<MemberActor|null>{
 try{const who=await patientIdentityForSave();return who?mintActor(who.userId,'app'):null;}catch{return null;}
}
/** Why sessionActor found no one: the sign-in ended (BC-05), unless it was the auth service that failed. */
export async function noActor():Promise<{status:'disabled'|'signed_out'|'unavailable'}>{
 try{return {status:await patientIdentityForSave()?'disabled':'signed_out'};}catch{return {status:'unavailable'};}
}
