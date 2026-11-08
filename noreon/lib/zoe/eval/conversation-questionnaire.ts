import {assessmentProgress,mergeAnswers} from '@/lib/patient/questionnaire';
import type {Answers,FieldValue} from '@/lib/clinical/types';
import {memberRecordFrom,memberRecordRowSchema} from '../member-record';

// In-memory assessment persistence for the suite. Anamnesis writes assessments, never ordinary chat messages or Zoe answers.
export type ReplayAssessment={answers:Answers;completed:boolean};
export type AnamnesisTurn={fieldId:string;value:FieldValue}|{complete:true};
export function saveAnamnesisTurn(state:ReplayAssessment,turn:AnamnesisTurn){
 if('complete'in turn){
  if(!assessmentProgress(state.answers).complete)throw Error('Replay questionnaire is unfinished');
  state.completed=true;
 }else state.answers=mergeAnswers(state.answers,[turn]);
}
export function replayMemberRecord(state:ReplayAssessment){
 return memberRecordFrom(memberRecordRowSchema.parse({runId:'00000000-0000-4000-8000-000000000001',enabled:true,
  today:'2026-11-02',ageYears:42,medicines:null,ldl:null,questionnaire:state,nextVisit:null}));
}
export const questionnaireProfile=():ReplayAssessment=>({completed:false,answers:Object.fromEntries(Object.entries({'q1.age':42,'q1.sex':'female'}).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-11-02T10:00:00Z'}]))});
/** A fictional, complete, non-urgent questionnaire. Height is the actual bare input from the failing journey. */
export const ANAMNESIS_VALUES:ReadonlyArray<readonly [string,FieldValue]>=[
 ['q2.weight_perception','ok'],['q2.height',165],['q2.weight',70],['q2.waist',82],
 ['q2.activity','occasional'],['q2.activity_minutes',150],['q2.activity_intensity','moderate'],['q2.diet',['ssb']],
 ['q3.status','never'],['q4.frequency','never'],['q5.diagnosed','no'],
 ['q5.last_reading.systolic',126],['q5.last_reading.diastolic',80],['q6.conditions',['none']],['q7.relatives',['none']],
 ['q8.sleep_quality',7],['q8.sleep_hours',8],['q8.stress','no'],['q9.present','no'],['q10.symptoms','no'],
];
