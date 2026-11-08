import type {GpReportSource} from '@/lib/gp-report/schema';

/** A fictional member shaped like the template's worked example (DEMO-001). Not a real person. */
export const FIXTURE_MEMBER='d3e00000-0000-4000-8000-000000000001';
export const FIXTURE_READ_AT='2026-10-16T06:00:00.000Z';
const at='2026-10-16T05:40:00.000Z';
const values:Record<string,unknown>={
 'q1.age':58,'q1.sex':'male','q2.weight_perception':'over','q2.height':176,'q2.weight':97,'q2.waist':106,'q2.activity':'sedentary','q2.diet':['meat','salt'],
 'q3.status':'former','q3.years':20,'q3.per_day':10,'q3.quit_years_ago':6,
 'q4.frequency':'monthly_or_less','q4.drinks_per_day':'one_two','q4.binge':'never','q4.drink_type':'wine','q4.volume_ml':150,
 'q5.diagnosed':'treated','q5.last_reading.systolic':158,'q5.last_reading.diastolic':96,
 'q6.conditions':['diabetes'],'q6.diabetes_years':8,'q6.hba1c':7.8,
 'q7.relatives':['cad'],'q7.relative_age':'male_under_55',
 'q8.sleep_quality':3,'q8.sleep_hours':7,'q8.breathing':'snoring','q8.daytime_sleepiness':'sometimes','q8.neck':41,'q8.stress':'often',
 'q9.present':'no','q10.symptoms':'no',
};
export const fixtureAnswers=Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:at}]));

const homeDay=(date:string,s:number,d:number,p:number,i:number,kind:'device'|'app')=>({id:`${kind}-${date}-${i}`,systolic:s,diastolic:d,pulse:p,measuredAt:`${date}T${i<2?'03':'15'}:${i%2?'05':'00'}:00.000Z`});
const series=(dates:string[],base:[number,number],kind:'device'|'app')=>dates.flatMap((date,di)=>[0,1,2,3].map(i=>homeDay(date,base[0]+((di+i)%3)-1,base[1]+((di*i)%3)-1,74+i,i,kind)));
const juneDates=['2026-06-17','2026-06-18','2026-06-19','2026-06-20','2026-06-21','2026-06-22','2026-06-23'];
const octDates=['2026-10-09','2026-10-10','2026-10-11','2026-10-12','2026-10-13','2026-10-14','2026-10-15'];

export function fixtureSource():GpReportSource{
 return {
  resultEntries:[],
  profile:{name:'Fictional Member DEMO',birthDate:'1968-06-08',biologicalSex:'male'},
  assessment:{answers:fixtureAnswers,assessmentDate:'2026-10-16',algorithmVersion:'NRN-CLIN-ALG-001-v1.1',completedAt:at,urgentRule:null,updatedAt:at},
  homeReadings:series(juneDates,[158,96],'app').map(r=>({...r,recordedAt:r.measuredAt})),
  deviceReadings:series(octDates,[152,92],'device').map(r=>({...r,receivedAt:r.measuredAt,transport:'synthetic'})),
  visitObservations:[
   ...[['2026-06-20T07:00:00.000Z',166,98,80],['2026-06-20T07:05:00.000Z',166,98,78],['2026-10-15T07:00:00.000Z',163,97,77],['2026-10-15T07:05:00.000Z',161,95,76]].flatMap(([t,s,d,p],i)=>{
    const visitId=i<2?'visit-june':'visit-oct';
    return (['systolic','diastolic','pulse'] as const).map((field,j)=>({id:`obs-${i}-${j}`,visitId,field,state:'known',value:[s,d,p][j],unit:field==='pulse'?'beats/min':'mmHg',observedAt:t as string,recordedAt:t as string,actorName:'Synthetic nurse',clinic:'Synthetic clinic'}));
   }),
   {id:'obs-weight',visitId:'visit-oct',field:'weight',state:'unknown',value:null,unit:null,observedAt:'2026-10-15T07:00:00.000Z',recordedAt:'2026-10-15T07:00:00.000Z',actorName:'Synthetic nurse',clinic:'Synthetic clinic'},
  ],
  labResults:[
   ...[['Creatinine',135,'µmol/L'],['eGFR',52,'mL/min/1.73 m²'],['Urine albumin/creatinine ratio',90,'mg/g'],['Potassium',4.7,'mmol/L'],['Sodium',139,'mmol/L'],['HbA1c',8.0,'%'],['LDL cholesterol',3.3,'mmol/L']].map(([marker,value,unit],i)=>({id:`lab-jun-${i}`,marker:marker as string,value:value as number,unit:unit as string,referenceLow:null,referenceHigh:null,referenceText:null,collectedAt:'2026-06-20T00:00:00+04:00',receivedAt:'2026-06-22T08:00:00.000Z',source:'laboratory' as const,sourceLabel:'Synthetic laboratory',reviewedAt:'2026-06-22T08:00:00.000Z',reviewedBy:'Synthetic doctor',sourceReportId:'report-june'})),
   ...[['Creatinine',139,'µmol/L'],['eGFR',51,'mL/min/1.73 m²'],['Urine albumin/creatinine ratio',96,'mg/g'],['Potassium',4.9,'mmol/L'],['Sodium',138,'mmol/L'],['HbA1c',7.8,'%'],['Glucose',8.8,'mmol/L'],['Total cholesterol',5.1,'mmol/L'],['LDL cholesterol',3.1,'mmol/L'],['HDL cholesterol',1.0,'mmol/L'],['Triglycerides',2.2,'mmol/L'],['Haemoglobin',141,'g/L']].map(([marker,value,unit],i)=>({id:`lab-oct-${i}`,marker:marker as string,value:value as number,unit:unit as string,referenceLow:null,referenceHigh:null,referenceText:null,collectedAt:'2026-10-15T00:00:00+04:00',receivedAt:'2026-10-15T12:00:00.000Z',source:'laboratory' as const,sourceLabel:'Synthetic laboratory',reviewedAt:'2026-10-15T12:00:00.000Z',reviewedBy:'Synthetic doctor',sourceReportId:'report-oct'})),
  ],
  sourceReports:[],
  clinicLabValues:[],
  clinicDocuments:[{id:'doc-1',attachedAt:'2026-10-15T12:00:00.000Z',clinic:'Synthetic clinic'}],
  tests:[{id:'test-1',title:'Lipid panel',status:'collected',orderedAt:'2026-10-01T08:00:00.000Z',dueAt:null,source:'laboratory'},{id:'test-2',title:'Urinalysis',status:'ordered',orderedAt:'2026-10-15T08:00:00.000Z',dueAt:'2026-10-30T08:00:00.000Z',source:'laboratory'}],
  plans:[{planId:'plan-1',version:1,clinician:'Synthetic doctor',publishedAt:'2026-06-25T08:00:00.000Z',instructions:'Measure blood pressure morning and evening for seven days before the next review. Take medicines as prescribed.',active:true,retiredAt:null,changeSummary:null}],
  medications:[{id:'med-1',planId:'plan-1',name:'Losartan',dose:'100 mg',instructions:'once daily',times:['08:00:00'],startDate:'2026-06-25',endDate:null,active:true,effectiveAt:'2026-06-25T08:00:00.000Z'}],
  alerts:[],
  consultation:{decision:null,completedAt:null,arrangement:null},
 };
}
/** No records at all: every section must say "Not available" with a reason. */
export function emptySource():GpReportSource{
 return {resultEntries:[],profile:{name:null,birthDate:null,biologicalSex:null},assessment:null,homeReadings:[],deviceReadings:[],visitObservations:[],labResults:[],sourceReports:[],clinicLabValues:[],clinicDocuments:[],tests:[],plans:[],medications:[],alerts:[],consultation:null};
}
