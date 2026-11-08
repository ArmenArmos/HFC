import {withRouteLogging} from '@/lib/observability/with-logging';
import {patientIdentity} from '@/lib/patient/auth';
import {demoEnabled} from '@/lib/patient/demo';
import {readZoeCards} from '@/lib/zoe-chat-actions/server';
import {readMedicinesForReview} from '@/lib/zoe-chat-actions/onboarding-actions';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
export const runtime='nodejs';
export const dynamic='force-dynamic';

/**
 * The member's own Zoe chat cards, read with the thread's polling (a GET, like /api/patient/zoe/thread). The member's
 * session reads zoe_chat_cards_member (auth.uid()); switched off it answers { enabled: false }. Never cached.
 */
export const GET=withRouteLogging(async function GET(){
 const headers={'Cache-Control':'no-store'};
 if(demoEnabled())return Response.json({error:'unavailable'},{status:404,headers});
 try{
  if(!await patientIdentity())return Response.json({error:'unauthorized'},{status:401,headers});
 }catch{return Response.json({error:'unavailable'},{status:503,headers});}
 const cards=await readZoeCards();
 if(zoeAppV3Enabled()){
  // Resume only a list the member already submitted. A transient queue outage keeps
  // its claim open, so polling can supply the mandatory reply after worker recovery.
  for(let i=0;i<cards.cards.length;i++){
   const card=cards.cards[i];
   if(card.kind!=='medicines'||card.state!=='open'||card.claims.medicines?.payload.kind!=='review')continue;
   const r=await readMedicinesForReview(card.id).catch(()=>null);
   if(r&&'card'in r&&r.card)cards.cards[i]=r.card;
  }
 }
 return Response.json(cards,{headers});
});
