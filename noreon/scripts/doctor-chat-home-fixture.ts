/** Fictional queue records for the offline chat-home checks. */
export const member='11111111-1111-4111-8111-111111111111';
export const other='22222222-2222-4222-8222-222222222222';
export const doctor='33333333-3333-4333-8333-333333333333';
export const at='2026-10-31T10:00:00Z';
export const baseItem={memberId:member,memberName:'Fictional member',at,rank:0,confidence:'rule',ai:'none',sources:[{type:'conversation',ref:member}]};
export const task={id:other,caseId:member,memberName:'Fictional member',kind:'contact-followup',title:'Contact follow-up',instructions:'Saved instruction',dueAt:'2026-10-30T10:00:00Z',creatorId:doctor,ownerId:doctor,ownerName:'Fictional doctor',status:'open',revision:1,createdAt:at,updatedAt:at,needsReassignment:false,eligibleOwners:[]};
export const sourceData:Record<string,unknown>={
 care_alert_inbox:{ok:true,role:'doctor',asOf:at,alerts:[]},
 doctor_urgent_windows:{ok:true,windows:[],total:0},
 doctor_ai_inbox:{version:'doctor-inbox-v1',ok:true,asOf:at,p0:[],p0Total:2,items:[{...baseItem,id:'reply:1',lane:'P1',kind:'reply_draft'},{...baseItem,id:'lab:1',lane:'P2',kind:'lab_sheet',fileId:other,toReview:1}],laneCap:50,unavailable:[],zoeAnswered:[],zoeAnsweredTotal:0},
 doctor_medicine_concerns:{ok:true,items:[{id:other,memberId:member,memberName:'Fictional member',kind:'side_effect',createdAt:at,ask:{id:other,source:'plan',medicineId:other,dueAt:at,trigger:'missed',state:'answered',reason:null,createdAt:at,answeredAt:at,medicine:{name:'Saved medicine',dose:null},careTeamAsked:true},ticks14:{taken:0,skipped:1}}]},
 doctor_ldl_responses:{version:'ldl-response-v1',enabled:true,items:[{id:other,memberId:member,memberName:'Fictional member',observedOn:'2026-10-30',status:'not_assessable',createdAt:at,facts:{version:'ldl-response-facts-v1',defaultsVersion:'fixture',value:{mmol:2,on:'2026-10-30',source:'clinic_reviewed'},goal:null,previous:null,changePct:null,reduction:{state:'not_assessable',percent:null,requiredPct:null},adherence:null,alt:null,nextStep:null,adherenceThresholdPct:80}}]},
 doctor_first_note_queue:{version:'first-note-queue-v1',enabled:true,items:[{memberId:member,memberName:'Fictional member',doctorName:'Fictional doctor',completedAt:at,dueAt:at}],closed:[]},
 patient_coordination_queue:{tasks:[task],nextCursor:null},
 patient_coordination_snapshot:{...task,events:[]},
};
export const memberRow={id:member,name:'Fictional member',revision:1,doctorId:doctor,nurseId:null,createdAt:at,bookingCounts:{requested:0,providerProposed:0,confirmed:1,changePending:0}};
