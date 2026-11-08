import {staffDisplayText,staffCodeLabel} from '@/lib/staff/display-text';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {zoeRunsSchema} from '@/lib/zoe/contracts';
import {readZoeWhy} from '@/lib/zoe/why-read';
import {classifyScope} from '@/lib/zoe/scope';
import {st} from '@/lib/staff/staff-locale-copy';
import {emptyResult} from './facts';
import type {Fact,L,Quote,ToolResult} from './contracts';

export type WhyContext={memberId:string;role:'doctor'|'nurse';locale:L;now:Date};
type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** Latest completed member run, explicitly identified. Both RPCs enforce assignment and audit with the staff JWT.
 * Never reconstruct an old decision from today's record; never fall back to an older rationale when the newest is missing.
 * Model-written signs, doubts and rationale remain untrusted quotes, excluded from the set of factual claims.
 */
export async function readZoeWhyTool(client:Rpc|null,c:WhyContext):Promise<ToolResult>{
 const empty=(state:'none'|'unavailable'|'not_permitted')=>emptyResult('zoe_why',state,c.memberId,c.role);
 const t=(en:string,hy:string,ru:string)=>st(c.locale,en,hy,ru);
 if(c.role!=='doctor')return empty('not_permitted');
 if(!client)return empty('none');
 try{
  const response=await client.rpc('zoe_runs_for_doctor',{p_member:c.memberId});
  if(response.error)return empty(response.error.code==='42501'?'not_permitted':'unavailable');
  const parsed=zoeRunsSchema.safeParse(response.data);
  if(!parsed.success)return empty('unavailable');
  const latest=[...parsed.data.runs].sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt))[0];
  if(!latest)return empty('none');
  const view=await readZoeWhy(client as unknown as SupabaseClient<Database>,latest.id);
  if(!view||view.run.memberId!==c.memberId||view.run.id!==latest.id)return empty('not_permitted');
  if(!view.why)return {...empty(view.status==='missing'?'none':'unavailable'),missing:[t('The latest Zoe run has no readable saved why. No explanation was reconstructed.','Զոյայի վերջին գործարկման պատճառի ընթեռնելի գրառում չկա։ Բացատրությունը չի վերակառուցվել։','Для последнего запуска Zoe нет читаемой записи причин. Объяснение не воссоздавалось.')]};
  const w=view.why,href=`/staff/real/conversations/${c.memberId}`;
  const date=/^\d{4}-\d{2}-\d{2}/.test(w.at)?w.at.slice(0,10):null;
  const facts:Fact[]=[],quotes:Quote[]=[];
  const add=(label:string,value:string,on=date)=>facts.push({id:`zoe_why.${facts.length+1}`,label:staffDisplayText(label,c.locale).slice(0,200),value:staffDisplayText(value,c.locale).slice(0,500),date:on,mark:null,href,analyte:null});
  const quote=(text:string)=>quotes.push({id:`zoe_why.${quotes.length+1}`,text:staffDisplayText(text,c.locale,true).slice(0,1200),date,flagged:classifyScope(text).injection});
  add(t('Latest saved Zoe run','Զոյայի վերջին պահպանված գործարկումը','Последний сохранённый запуск Zoe'),`${view.run.id}, ${t('message','հաղորդագրություն','сообщение')} ${view.run.messageSeq??'?'}`);
  add(t('Saved outcome and reason','Պահպանված արդյունք և պատճառ','Сохранённый исход и причина'),`${view.run.outcome??w.reply.outcome}: ${view.run.reason??w.reply.reason}`);
  add(t('Saved urgency, not a new assessment','Պահպանված հրատապություն, նոր գնահատում չէ','Сохранённая срочность, не новая оценка'),w.level.final??t('not recorded','գրանցված չէ','не записана'));
  add(t('Saved doctor suggestion','Բժշկին դիմելու պահպանված առաջարկ','Сохранённое предложение обратиться к врачу'),`${w.doctor.suggested?'yes':'no'}: ${w.doctor.how}, ${w.doctor.reason??'unknown'}`);
  add(t('Saved versions','Պահպանված տարբերակներ','Сохранённые версии'),`${w.version}, ${w.models.provider}, ${w.models.model}, ${w.models.prompt??'unknown'}`);
  add(t('Rationale status','Բացատրության վիճակ','Состояние обоснования'),`${w.rationale.status}${w.rationale.aboutHeldText?', held text':''}`);
  // Bounded to the tool contract; preserve gaps instead of silently making a complete-record claim.
  for(const d of w.data.slice(0,18))add(`${d.key} (${d.source}, reviewed=${d.reviewed??'unknown'}, relied=${d.relied??'unknown'})`,d.value??t('not recorded','գրանցված չէ','не записано'),d.date&&/^\d{4}-\d{2}-\d{2}/.test(d.date)?d.date.slice(0,10):null);
  for(const r of w.rules.slice(0,6))add(t('Saved rule','Պահպանված կանոն','Сохранённое правило'),`${staffCodeLabel(r.rule,c.locale)} (${r.version}): ${r.outcome}, ${r.reason}`);
  const statements=[...w.signs.map(s=>({...s,kind:t('Sign','Նշան','Признак')})),...w.doubts.map(s=>({...s,kind:t('Doubt','Անորոշություն','Сомнение')}))];
  for(const s of statements.filter(s=>s.from==='rule').slice(0,10))add(s.kind,s.text);
  const generated=[...(w.doctor.why?[w.doctor.why]:[]),...statements.filter(s=>s.from==='model').map(s=>`${s.kind}: ${s.text}`)];
  for(const s of generated.slice(0,12))quote(s);
  const truncated=w.data.length>18||w.rules.length>6||statements.filter(s=>s.from==='rule').length>10||generated.length>12;
  return {tool:'zoe_why',state:'ok',facts,quotes,href,missing:truncated?[t('Only part of this saved record is shown.','Ցուցադրվում է պահպանված գրառման միայն մի մասը։','Показана только часть сохранённой записи.')]:[]};
 }catch{return empty('unavailable');}
}
