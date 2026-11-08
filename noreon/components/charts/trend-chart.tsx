'use client';
import {useId,useState} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {ChartSource,TrendPoint,TrendProps} from './types';
export function chartSource(source:ChartSource,l:StaffLocale){
 const names:Record<ChartSource,[string,string,string]>={verified:['Verified readings','Ստուգված չափումներ','Проверенные измерения'],home:['Home reading','Տնային չափում','Домашнее измерение'],clinic:['Clinic reading','Կլինիկայի չափում','Измерение в клинике'],reviewed:['Reviewed result','Վերանայված արդյունք','Проверенный результат'],unreviewed:['Not reviewed','Չվերանայված','Не проверено'],member:['Member-reported, not verified','Անդամի հաղորդածը, չստուգված','Со слов участника, не проверено']};
 return st(l,...names[source]);
}
const color={bp:'var(--trend-bp)',ldl:'var(--trend-ldl)',adherence:'var(--trend-adherence)',other:'var(--foreground)'};
function Mark({point,x,y,stroke}:{point:TrendPoint;x:number;y:number;stroke:string}){
 const props={stroke,strokeWidth:1.5};
 if(point.source==='clinic'||point.source==='reviewed')return <rect x={x-3} y={y-3} width={6} height={6} fill={point.source==='clinic'?stroke:'var(--card)'} {...props}/>;
 if(point.source==='member')return <path d={`M${x-3},${y-3}l6,6m0,-6l-6,6`} {...props}/>;
 if(point.source==='unreviewed')return <path d={`M${x},${y-4}l4,8h-8z`} fill="var(--card)" {...props}/>;
 return <circle cx={x} cy={y} r={3} fill={point.slot==='morning'?'var(--card)':stroke} {...props}/>;
}
/** A single numeric axis, factual source markers, and the same exact-value table at both sizes. */
export function TrendChart({points:raw,title,labels,unit,locale,entity='other',emptyText,target,sparkline=false,defaultExpanded=false}:TrendProps){
 const [expanded,setExpanded]=useState(defaultExpanded),id=useId();
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const points=raw.filter(p=>Number.isFinite(Date.parse(p.at))&&p.values.length===labels.length&&p.values.every(Number.isFinite)).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const date=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'});
 const time=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const source=(p:TrendPoint)=>[chartSource(p.source,locale),p.slot==='morning'?t('Morning','Առավոտ','Утро'):p.slot==='evening'?t('Evening','Երեկո','Вечер'):null].filter(Boolean).join(' · ');
 const stroke=color[entity],width=320,height=sparkline&&!expanded?64:205,left=44,right=304,top=12,bottom=height-38;
 const values=points.flatMap(p=>[...p.values]);if(target)values.push(target.below,0);
 const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.12,Math.abs(max)*.04,.1),low=min-pad,high=max+pad;
 const first=Date.parse(points[0]?.at??''),last=Date.parse(points.at(-1)?.at??'');
 const x=(p:TrendPoint)=>first===last?(left+right)/2:left+(Date.parse(p.at)-first)/(last-first)*(right-left);
 const y=(n:number)=>bottom-(n-low)/(high-low)*(bottom-top);
 const number=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:12}).format(n);
 return <section className="min-w-0 max-w-full space-y-2 rounded-md bg-card p-3 text-foreground" data-trend={entity}>
  <h3 className="text-body2 font-medium">{title} <span className="font-normal">({unit})</span></h3>
  {sparkline&&points.length>0&&<p className="text-caption tabular-nums">{t('Latest recorded','Վերջին գրանցվածը','Последняя запись')}: {points.at(-1)!.values.map(number).join('/')} {unit} · {source(points.at(-1)!)}</p>}
  {points.length<2&&<p role="status" className="text-body2 text-muted-foreground">{emptyText}</p>}
  {points.length>0&&<>
   <button type="button" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(!expanded)} className="block min-h-12 w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={`${title}: ${t('Show values and dates','Ցույց տալ արժեքներն ու ամսաթվերը','Показать значения и даты')}`}>
    <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{maxHeight:sparkline&&!expanded?64:240}}>
     {(!sparkline||expanded)&&[low,(low+high)/2,high].map((n,i)=><g key={i}><path d={`M${left},${y(n)}H${right}`} stroke="var(--border)"/><text x={left-5} y={y(n)+4} textAnchor="end" fill="var(--muted-foreground)" fontSize={12}>{new Intl.NumberFormat(locale,{maximumFractionDigits:entity==='bp'?0:2}).format(n)}</text></g>)}
     {target&&<g data-target-band><rect x={left} y={y(target.below)} width={right-left} height={y(0)-y(target.below)} fill={stroke} fillOpacity={.1}/><path d={`M${left},${y(target.below)}H${right}`} stroke={stroke} strokeDasharray="2 3"/></g>}
     {labels.map((label,k)=><g key={label}>
      {/* Unverified observations stay points only, never a segment in the verified trend. */}
      {(['home','clinic','reviewed','verified'] as const).map(s=>{const group=points.filter(p=>p.source===s);return group.length>1?<polyline key={s} points={group.map(p=>`${x(p)},${y(p.values[k]!)}`).join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} strokeDasharray={k?'5 3':undefined}/>:null;})}
     </g>)}
     {points.map(p=><g key={p.id} data-source={p.source} data-bp-slot={p.slot}>
      <title>{`${date.format(Date.parse(p.at))}${p.dateOnly?'':` ${time.format(Date.parse(p.at))}`}: ${p.values.map(number).join('/')} ${unit} · ${source(p)}`}</title>
      {labels.map((label,k)=><Mark key={label} point={p} x={x(p)} y={y(p.values[k]!)} stroke={stroke}/>)}
     </g>)}
     {(!sparkline||expanded)&&[points[0]!,...(first===last?[]:[points.at(-1)!])].map((p,i)=><text key={i} x={x(p)} y={height-8} textAnchor={first===last?'middle':i?'end':'start'} fill="var(--muted-foreground)" fontSize={12}>{date.format(Date.parse(p.at))}</text>)}
    </svg>
    <span className="text-caption underline underline-offset-2">{expanded?t('Hide values','Թաքցնել արժեքները','Скрыть значения'):t('Show values and dates','Ցույց տալ արժեքներն ու ամսաթվերը','Показать значения и даты')}</span>
   </button>
   {labels.length>1&&<ul aria-label={t('Legend','Պայմանական նշաններ','Условные обозначения')} className="flex flex-wrap gap-x-4 text-caption">{labels.map((label,i)=><li key={label} className="inline-flex items-center gap-2"><svg width={20} height={10} aria-hidden><path d="M0 5H20" stroke={stroke} strokeWidth={1.5} strokeDasharray={i?'5 3':undefined}/></svg>{label}</li>)}</ul>}
   <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption" aria-label={t('Sources','Աղբյուրներ','Источники')}>{[...new Set(points.map(p=>p.source))].map(s=><li key={s} className="inline-flex items-center gap-1"><svg width={14} height={14} aria-hidden><Mark point={{id:s,at:'',values:[],source:s}} x={7} y={7} stroke={stroke}/></svg>{chartSource(s,locale)}</li>)}</ul>
   {target&&<p className="text-caption">{t('Recorded threshold','Գրանցված շեմ','Записанный порог')}: &lt; {number(target.below)} {unit}. {t('The reduction part is assessed separately.','Նվազման մասը գնահատվում է առանձին։','Часть цели по снижению оценивается отдельно.')}</p>}
   {expanded&&<div id={id} className="max-w-full overflow-x-auto">
    <p className="text-caption text-muted-foreground">{t('Time in Yerevan (24-hour)','Երևանի ժամանակով (24 ժամ)','Время Еревана (24 часа)')}</p>
    <table role="table" aria-label={title} className="w-full table-fixed text-left text-caption"><thead><tr role="row">{[t('Date','Ամսաթիվ','Дата'),t('Time','Ժամ','Время'),`${labels.join(' / ')} (${unit})`,t('Source','Աղբյուր','Источник')].map(s=><th role="columnheader" key={s} className="break-words py-2 pr-2 font-medium">{s}</th>)}</tr></thead><tbody>{points.map(p=><tr role="row" key={p.id} className="border-t"><td role="cell" className="break-words py-2 pr-2">{date.format(Date.parse(p.at))}</td><td role="cell" className="py-2 pr-2">{p.dateOnly?t('Not recorded','Գրանցված չէ','Не указано'):time.format(Date.parse(p.at))}</td><td role="cell" className="break-words py-2 pr-2 tabular-nums">{p.values.map(number).join('/')}</td><td role="cell" className="break-words py-2">{source(p)}</td></tr>)}</tbody></table>
   </div>}
  </>}
 </section>;
}
export function Sparkline(props:Omit<TrendProps,'sparkline'>){return <TrendChart {...props} sparkline/>;}
