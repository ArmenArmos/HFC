export const readNurseToday=()=>fetch('/fixture/today',{method:'POST'}).then(r=>r.json());
export const searchNurseChatMembers=(query:string)=>fetch('/fixture/search',{method:'POST',body:JSON.stringify({query})}).then(r=>r.json());
export async function setStaffLocale(form:FormData){if(!form.get('locale'))throw Error('Missing locale');}
// Sign-out is the one permitted navigation in this isolated browser harness.
// eslint-disable-next-line @next/next/no-location-assign-relative-destination
export async function realStaffSignOut(){window.location.assign('/staff/real/login');}

export const readNurseConversation=(memberId:string)=>fetch('/fixture/conversation',{method:'POST',body:JSON.stringify({memberId})}).then(r=>r.json());
export const sendNurseReply=(request:unknown)=>fetch('/fixture/reply',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());

export const readNurseHandoffFacts=(memberId:string)=>fetch('/fixture/handoff-facts',{method:'POST',body:JSON.stringify({memberId})}).then(r=>r.json());
export const readNurseAdherence=()=>fetch('/fixture/adherence',{method:'POST'}).then(r=>r.json());
export const readNurseMissingBp=()=>fetch('/fixture/missing-bp',{method:'POST'}).then(r=>r.json());
export const readNurseHandoffs=(memberId:string)=>fetch('/fixture/handoffs',{method:'POST',body:JSON.stringify({memberId})}).then(r=>r.json());
export const escalateNurseMessage=(request:unknown)=>fetch('/fixture/handoff',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());

export const coordinationCommand=(request:unknown)=>fetch('/fixture/task-command',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());
export const refreshCoordinationTask=(taskId:unknown)=>fetch('/fixture/task-refresh',{method:'POST',body:JSON.stringify({taskId})}).then(r=>r.json());
export const readCoordinationPage=(request:unknown)=>fetch('/fixture/task-page',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());
export const readNurseChatVisits=()=>fetch('/fixture/visits',{method:'POST'}).then(r=>r.json());
export const readNurseChatNotes=(memberId:string)=>fetch('/fixture/notes',{method:'POST',body:JSON.stringify({memberId})}).then(r=>r.json());
export const realStaffCareCommand=(request:unknown)=>fetch('/fixture/care-note',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());

export const readNurseChatVisit=(memberId:string,source:string,visitId:string)=>fetch('/fixture/visit',{method:'POST',body:JSON.stringify({memberId,source,visitId})}).then(r=>r.json());
export const recordNurseVisitMark=(request:unknown)=>fetch('/fixture/visit-mark',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());
export const recordNurseVisitStep=(request:unknown)=>fetch('/fixture/visit-step',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());
export const recordNurseVisitComplete=(request:unknown)=>fetch('/fixture/visit-complete',{method:'POST',body:JSON.stringify(request)}).then(r=>r.json());

export const openNurseChatZoe=(memberId:string,expectedNurseId:string)=>fetch('/fixture/zoe-open',{method:'POST',body:JSON.stringify({memberId,expectedNurseId})}).then(r=>r.json());
export const readNurseChatZoeHistory=(expectedNurseId:string)=>fetch('/fixture/zoe-history',{method:'POST',body:JSON.stringify({expectedNurseId})}).then(r=>r.json());
export const findNurseChatQuestionMember=(question:string,expectedNurseId:string,current?:{memberId:string;memberName:string})=>fetch('/fixture/zoe-question',{method:'POST',body:JSON.stringify({question,expectedNurseId,current})}).then(r=>r.json());

/** No hosted identity reads in the standalone nurse fixture. */
export async function readStaffChatMemberIdentities(){return [];}

export async function changeCareAlert(){return {ok:false,error:"Synthetic alert action unavailable"};}
