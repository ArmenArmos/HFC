import {todayItems} from './today';
import type {readNurseToday} from './today-actions';

const base='/staff/real/nurse-chat';
/** Navigation only. Text never authorizes a clinical or messaging action. */
export function nurseLandingDestination(text:string){
 const query=text.trim().slice(0,100),command=query.toLocaleLowerCase();
 if(['today','այսօր','сегодня'].includes(command))return `${base}?view=today`;
 if(['visits','այցեր','визиты'].includes(command))return `${base}?view=visits`;
 if(['members','անդամներ','участники'].includes(command))return `${base}?view=members`;
 // Questions are not member names. Offer navigation without guessing clinical answers.
 if(query.length<2||/[?？]/u.test(query)||query.split(/\s+/u).length>4||/^(who|which|what|how|show me who|кто|у кого|какие|ինչ|ով|ո՞վ|ո՞ր)(?:\s|$)/iu.test(command))return null;
 return `${base}?${new URLSearchParams({view:'members',q:query})}`;
}
export function nurseLandingNext(data:Awaited<ReturnType<typeof readNurseToday>>){
 if(!data.ok)return null;
 const item=todayItems(data.page?.tasks??[],data.visits?.enabled?data.visits.visits:[],new Date(data.asOf)).find(row=>row.state!=='completed'&&row.state!=='cancelled');
 if(!item)return null;
 return item.kind==='visit'?{kind:'visit' as const,href:`${base}?${new URLSearchParams({member:item.visit.memberId,source:item.visit.source,visit:item.visit.id})}`}:{kind:'task' as const,href:`${base}?view=today`};
}
