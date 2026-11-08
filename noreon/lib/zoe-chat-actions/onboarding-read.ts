import 'server-only';
import {createHash} from 'node:crypto';
import {patientIdentity} from '@/lib/patient/auth';
import {createClient} from '@/lib/supabase/server';
import {readZoeConsents} from '@/lib/zoe/member';
import type {ZoeCards} from './registry';

const asUuid=(hex:string)=>hex.replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
/**
 * The request id of the member's one profile card, when it is still to be offered. It is derived from the member, so two
 * tabs or a second device post the same card, and an answered card can never come back as a new form. Unreadable means no
 * offer: nothing appears unless the facts say so. Consent still comes first: it is due on screen, or already granted.
 */
export async function readProfileOffer(cards:ZoeCards,consentDue:boolean):Promise<string|null>{
 if(!cards.enabled||cards.cards.some(card=>card.kind==='profile'))return null;
 try{
  const who=await patientIdentity();
  if(!who)return null;
  const {data,error}=await (await createClient()).from('member_preferences').select('preferred_channel').maybeSingle();
  if(error||data?.preferred_channel)return null;
  if(!consentDue&&!(await readZoeConsents())?.readsMessages)return null;
  return asUuid(createHash('sha256').update(`zoe-v3-profile:${who.userId}`).digest('hex'));
 }catch{return null;}
}
