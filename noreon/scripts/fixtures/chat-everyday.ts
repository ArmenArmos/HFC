/** Synthetic, local-only fixtures. Lesson content is the real fixed staging catalogue. */
import {LESSONS} from '@/lib/lessons/content';
import {yerevanDate} from '@/lib/bp-week/model';
import type {EverydayRead} from '@/lib/zoe-chat-actions/everyday-read';
import type {RegimenChange} from '@/lib/patient-care/regimen';
import type {CarePlan} from '@/lib/patient-care/types';
export const fixtureId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token='a'.repeat(64),today=yerevanDate(new Date());
export const fixturePlan:CarePlan={id:fixtureId(20),clinician:'Synthetic doctor',publishedAt:'2026-10-30T09:00:00Z',instructions:'Synthetic published plan instructions.',acknowledgedAt:null,medications:[{id:fixtureId(30),planId:fixtureId(20),name:"Synthetic medicine",dose:"Synthetic dose",instructions:"Synthetic prescription instructions.",times:["08:00","20:00"],startDate:"2026-10-30",endDate:null,active:true}],publishedReview:{instructions:'Synthetic complete published instructions.',explanation:'Synthetic explanation.',followUp:'Synthetic follow-up.'}};
const publication=(n:number)=>({planId:fixtureId(n),publishedAt:`2026-10-${n===20?'30':'20'}T09:00:00Z`,draft:{explanation:'Synthetic explanation.',instructions:`Synthetic instructions for ${n}.`,followUp:'Synthetic follow-up.',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]},receipts:{},reports:[]});
export const everydayFixtures:Record<string,EverydayRead>={
 bp_week:{view:'bp_week',token,showDevice:false,read:{version:'bp-week-v1',enabled:true,memberCanStart:true,today,currentDevice:null,weeks:[{id:fixtureId(10),startsOn:today,days:7,readingsPerSlot:2,morningTime:'08:00',eveningTime:'20:00',reminders:true,startedByRole:'nurse',createdAt:new Date().toISOString(),stoppedAt:null,stopReason:null,device:null,readings:[]}]}},
 earlier:{view:'earlier',token,reading:false,history:{documents:[],values:[{id:fixtureId(31),measure:"ldl_c",value:4.2,value2:null,unit:"mmol/L",measuredOn:"2020-01-01",source:"member-reported"},{id:fixtureId(32),measure:"total_cholesterol",value:4.2,value2:null,unit:"mmol/L",measuredOn:"2020-01-01",source:"member-reported"}],clinic:{bp:[],observations:[]}}},
 result_history:{view:'result_history',token,reportedValues:[],tests:[],results:[{id:fixtureId(12),testId:null,marker:'Synthetic lab marker',value:4.2,unit:'mmol/L',referenceText:'Synthetic laboratory reference',referenceLow:null,referenceHigh:null,collectedAt:'2026-10-29T09:00:00Z',receivedAt:'2026-10-30T09:00:00Z',source:'laboratory',sourceLabel:'Synthetic lab',reviewedAt:'2026-10-31T09:00:00Z',reviewedBy:'Synthetic doctor',explanation:null}]},
 previous_plans:{view:'previous_plans',token,enabled:true,status:null,publications:[publication(20),publication(21)],versions:null,regimens:null},
 lessons:{view:'lessons',token,lessons:LESSONS.slice(0,2),progress:{version:'member-lessons-v1',today,done:[],offers:[]}},
 answers:{view:'answers',token,assessment:{id:fixtureId(14),revision:1,assessmentDate:today,answers:{'q1.age':{fieldId:'q1.age',source:'manual',value:40,answeredAt:'2026-10-30T09:00:00Z'}},completedAt:'2026-10-30T09:00:00Z',urgentRule:null},exercise:'withheld'},
 team:{view:'team',token,clinician:'Synthetic doctor',contact:{mode:'chat',href:'/patient/zoe'},reviewEnabled:true},
 help:{view:'help',token,contact:{mode:'chat',href:'/patient/zoe'}},
};

export const fixturePlanVersion={planId:fixturePlan.id,version:2,publishedAt:fixturePlan.publishedAt,current:true,changeSummary:'Synthetic revised plan instructions.'};
export const fixtureMedicineChanges:RegimenChange[]=[
 {kind:'stopped',name:'Synthetic stopped medicine',dose:'Old dose',times:['07:00']},
 {kind:'dose_changed',name:'Synthetic medicine',fromDose:'Previous dose',toDose:'Synthetic dose'},
 {kind:'schedule_changed',name:'Synthetic medicine',fromTimes:['07:00'],toTimes:['08:00','20:00']},
];
