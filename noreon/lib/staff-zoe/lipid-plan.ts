import {LIPID_COPY as W,LIPID_GOAL_GAPS,LIPID_TESTS} from '@/lib/lipid-planner/copy';
import type {L3} from '@/lib/lipid-planner/engine';
import type {LipidPlan} from '@/lib/lipid-planner/plan';
import {formatMmol,formatPercent} from '@/lib/ldl/status';
import {st} from '@/lib/staff/staff-locale-copy';
import {calendarDate} from '@/lib/staff/yerevan-time';
import type {Fact,L,ToolResult} from './contracts';

/**
 * The lipid plan as a Doctor Zoe card. Pure, and written only by code from lib/lipid-planner: no model reads or writes it.
 * Every value here comes from a proposed rule, and the first line says so.
 */
export function lipidPlanResult(plan:LipidPlan,c:{memberId:string;locale:L}):ToolResult{
 const pick=(l:L3)=>st(c.locale,l[0],l[1],l[2]);
 const day=(d:string)=>calendarDate(d,c.locale);
 const range=(from:string,to:string)=>from===to?day(from):`${day(from)} – ${day(to)}`;
 const facts:Fact[]=[];
 const add=(label:string,value:string,date:string|null=null)=>{facts.push({id:`lipid_plan.${facts.length+1}`,label:label.slice(0,200),value:value.slice(0,500),date,mark:null,href:null,analyte:null});};
 add(pick(W.rules),pick(W.proposed));
 for(const i of plan.timeline)add(pick(LIPID_TESTS[i.test]),i.state==='undated'?pick(W.undated):i.state==='done'?`${pick(W.done)}: ${day(i.doneOn)}`:`${range(i.from,i.to)} · ${pick(W[i.status])}${i.confirmed?` · ${pick(W.confirmed)}`:''}`);
 const g=plan.goalCheck;
 if(g.run){
  add(pick(W.threshold),`${formatMmol(g.latest.mmol,g.threshold.mmol)} mmol/L · ${pick(W.below)} ${formatMmol(g.threshold.mmol)}: ${pick(W[g.threshold.result])}`,g.latest.on);
  add(pick(W.reduction),g.reduction.part?`${formatPercent(g.reduction.percent,g.reduction.requiredPct)}% · ${pick(W.required)} ${g.reduction.requiredPct}%: ${pick(W[g.reduction.result])}`:pick(W.noReduction),g.baseline.on);
  add(pick(W.both),pick(W[g.overall]));
 }else add(pick(W.goal),`${pick(W.notRun)} ${g.missing.map(m=>pick(LIPID_GOAL_GAPS[m])).join('; ')}`);
 for(const n of plan.notes)add(pick(W.gaps),pick(n.text));
 return {tool:'lipid_plan',state:'ok',facts:facts.slice(0,40),quotes:[],missing:[],href:`/staff/real/members/${c.memberId}`};
}
