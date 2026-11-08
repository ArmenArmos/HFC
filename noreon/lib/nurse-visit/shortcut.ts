import {collectionStatus} from './collection';
import {isVisitTestName,parseVisitMeasurement,type VisitShortcutDraft} from './chat-parser';
import type {Locale} from '@/lib/locale';
import {nurseVisitVersion,type NurseVisitReady,type NurseVisitStepCommand,type NurseVisitMarkCommand,type NurseVisitCollectCommand} from './schema';
export type VisitWrite={kind:'step';command:NurseVisitStepCommand}|{kind:'mark';command:NurseVisitMarkCommand}|{kind:'collect';command:NurseVisitCollectCommand};
export type ShortcutAction={kind:'confirmation'}|{kind:'arrival'}|{kind:'measurement';item:string;words:string;note:string;replace:boolean;expectedMark:string}|{kind:'mark';item:string;done:boolean;note:string}|{kind:'sample';testId:string;status:'collected'|'not-collected'|'issue';reason:string};
/** Validate the entire preview before the first write. A pending/unparsed field is never a zero. */
export function shortcutActions(data:NurseVisitReady,draft:VisitShortcutDraft,l:Locale):ShortcutAction[]|null{
 if(data.completion||data.visit.bookingStatus==='cancelled')return null;
 const actions:ShortcutAction[]=[];
 if(draft.confirmed&&!data.steps.some(s=>s.step==='confirmed'))actions.push({kind:'confirmation'});
 if(draft.arrived&&!data.steps.some(s=>s.step==='started'))actions.push({kind:'arrival'});
 for(const [key,words] of Object.entries(draft.measurements)){
  const item=data.items.find(i=>i.key===key&&i.kind==='measurement');
  if(!item||item.mark&&!draft.replace?.includes(key)||(draft.notes?.[key]?.trim().length??0)>1000||parseVisitMeasurement(item,words,l).error)return null;
  actions.push({kind:'measurement',item:key,words,note:draft.notes?.[key]??'',replace:Boolean(draft.replace?.includes(key)),expectedMark:JSON.stringify(item.mark)});
 }
 for(const mark of draft.marks){
  if(mark.done===null)continue;
  const item=data.items.find(i=>i.key===mark.item&&['check','device'].includes(i.kind));
  if(!item||item.mark||mark.note.trim().length>1000)return null;
  actions.push({kind:'mark',item:mark.item,done:mark.done,note:mark.note});
 }
 const seen=new Set<string>();
 if(draft.collectionIssue&&draft.samples.some(sample=>sample.status!=='pending'))return null;
 for(const sample of draft.samples){
  // No collection is submitted while any sample choice is unset.
  if(sample.needsReason||sample.status==='pending')return null;
  const item=data.items.find(i=>i.kind==='sample'&&i.testId===sample.testId);
  if(!item||collectionStatus(item)!=='pending'||seen.has(sample.testId)||sample.status!=='collected'&&(!sample.reason.trim()||sample.reason.trim().length>300||isVisitTestName(data.items,sample.reason)))return null;
  seen.add(sample.testId);
  actions.push({kind:'sample',testId:sample.testId,status:sample.status,reason:sample.status==='collected'?'':sample.reason.trim()});
 }
 if(actions.some(a=>a.kind==='sample')&&!draft.confirmed&&!data.steps.some(s=>s.step==='confirmed'))return null;
 return actions.length?actions:null;
}
/** Build each next command after the previous readback, so collection uses its real new revision. */
export function shortcutCommand(data:NurseVisitReady,action:ShortcutAction,l:Locale,id:string):VisitWrite|null{
 const base={version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,submissionId:id};
 if(action.kind==='arrival'||action.kind==='confirmation')return {kind:'step',command:{...base,step:action.kind==='arrival'?'started':'confirmed'}};
 if(action.kind==='sample'){
  if(!data.items.some(i=>i.kind==='sample'&&i.testId===action.testId&&collectionStatus(i)==='pending'))return null;
  return {kind:'collect',command:{...base,expectedRevision:data.caseRevision,arrangementToken:data.visit.arrangementToken,testId:action.testId,status:action.status,reason:action.reason||null}};
 }
 const item=data.items.find(i=>i.key===action.item&&(!i.mark||action.kind==='measurement'&&action.replace));if(!item)return null;
 if(action.kind==='measurement'&&action.replace&&JSON.stringify(item.mark)!==action.expectedMark)return null;
 const values=action.kind==='measurement'?parseVisitMeasurement(item,action.words,l):{values:null,error:null};
 if(values.error)return null;
 return {kind:'mark',command:{...base,item:item.key,startsAt:data.visit.startsAt,expectUnmarked:action.kind!=='measurement'||!action.replace,...(item.kind==='check'?{checklistVersion:item.version}:{}),done:action.kind==='measurement'||action.done,note:action.note.trim()||null,values:values.values}};
}
