import 'server-only';
import{unstable_rethrow}from'next/navigation';
import{createClient}from'@/lib/supabase/server';
import{pilotCatalogEnabled,pilotPaymentsEnabled}from'./config';
import{readMemberCatalog,readMemberPayments,type PilotRpc}from'./runtime';
import type{MemberPricing}from'@/components/pilot-commerce/member-pricing';

/** Prices and own payment records for the signed-in member, or undefined when switched
 * off or unreadable. A failed read hides prices; it never shows a wrong one. */
export async function getMemberPricing():Promise<MemberPricing|undefined>{
 if(!pilotCatalogEnabled())return undefined;
 try{
  const client=await createClient()as unknown as PilotRpc;
  const [catalog,payments]=await Promise.all([readMemberCatalog(client),pilotPaymentsEnabled()?readMemberPayments(client):Promise.resolve(null)]);
  return{catalog:catalog.tests,payments:payments?.payments??null};
 }catch(error){unstable_rethrow(error);return undefined;}
}
