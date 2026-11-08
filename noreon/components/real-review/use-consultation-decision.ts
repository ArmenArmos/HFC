'use client';
import {useState} from 'react';
import type {ConsultationProposal} from '@/lib/patient-care/consultation-proposal';

/** New evidence or a withdrawn proposal must not retain an earlier default or attribution. */
export function useConsultationDecision(context:string,proposal:ConsultationProposal|null){
 const key=JSON.stringify([context,proposal]);
 const initial={key,context,decision:proposal?.decision??'',reason:proposal?.note??'',proposed:!!proposal,decisionEdited:false,reasonEdited:false};
 const [state,setState]=useState(initial);
 const current=state.key===key?state:state.context===context&&(state.decisionEdited||state.reasonEdited)
  ?{...state,key,decision:state.decisionEdited?state.decision:initial.decision,reason:state.reasonEdited?state.reason:'',proposed:false}:initial;
 if(state.key!==key)setState(current);
 return {...current,
  changeDecision:(decision:string)=>setState(previous=>({...previous,decision,reason:!previous.reasonEdited&&decision!==previous.decision?'':previous.reason,decisionEdited:true,proposed:false})),
  changeReason:(reason:string)=>setState(previous=>({...previous,reason,reasonEdited:true,proposed:false})),
 };
}
