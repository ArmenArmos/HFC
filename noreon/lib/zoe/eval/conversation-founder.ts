/* eslint-disable @typescript-eslint/no-explicit-any -- eval data and transcripts, not product code */
// The replay of Khikar's chat of 30 Oct on a fictional member: questionnaire diabetes, kidney disease, stroke or TIA; one reading 155/87 today. Fixed member words, Zoe free running.
import {readFileSync} from 'node:fs';
export const FOUNDER_PATH='docs/reference/zoe-eval/conversation-founder-v1.json';
const blocks=JSON.parse(readFileSync(FOUNDER_PATH,'utf8')) as {min:number;who:string;seq:string|null;body:string}[];
const FLAGS:Record<number,any>={37:{notMention:'headache|գլխացավ|103|doctor|բժիշկ|բժշկ',lang:'hy'},36:{lang:'hy'},38:{lang:'en'},39:{lang:'en',deescalates:true},40:{lang:'en',complaint:true},41:{lang:'en',complaint:true},
 44:{},45:{correction:'stroke|ինսուլտ|insult',deescalates:true},46:{deescalates:true},47:{logAsk:true,deescalates:true,complaint:true},48:{complaint:true}};
const turns:any[]=[];
for(const b of blocks){if(b.who!=='member'||b.seq==='35')continue;const s=Number(b.seq);turns.push({seq:s,at:b.min,text:b.body,...(FLAGS[s]??{}),...(s===43?{divider:true}:{})});}
const m=blocks.find(b=>b.seq==='35')!;
export const FOUNDER=[{id:'founder-replay',lang:'hy',cat:'real case replay',rules:{no103once:true,maxDoctor:3,noReintro:true},locale:'hy',displayName:'Fictional Member',doctorName:'Test Doctor',seed:[{seq:35,text:m.body,at:m.min}],seq0:35,readingMinutesAgo:8,
 health:{bpWeek:{count:1,avgSystolic:155,avgDiastolic:87,latest:{systolic:155,diastolic:87,daysAgo:0}},labs:[],plan:null},profile:{conditions:['diabetes','kidney','stroke'],bpDiagnosed:null,medicines:[],openAlerts:[],nextVisitInDays:null},turns}];
