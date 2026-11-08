import {bpUnit} from '@/lib/bp-unit';
import {st} from '@/lib/staff/staff-locale-copy';
import type {BpPoint,L} from '@/lib/staff-zoe/contracts';
import {TrendChart} from '@/components/charts/trend-chart';
/** Compatibility adapter for saved Zoe cards. The shared module owns all chart rendering. */
export function BpChart({series,locale}:{series:readonly BpPoint[];locale:L}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const empty=t('Needs 2 home readings in the last 2 weeks','Գծապատկերի համար պետք է 2 տնային չափում վերջին 2 շաբաթվա ընթացքում','Нужно 2 домашних измерения за последние 2 недели');
 if(series.length<2)return <p role="status" data-testid="zoe-bp-chart-empty" className="text-body2 text-muted-foreground">{empty}</p>;
 return <div data-testid="zoe-bp-chart"><TrendChart points={series.map((p,i)=>({id:`${p.measuredAt}:${i}`,at:p.measuredAt,values:[p.systolic,p.diastolic],source:'home',slot:p.slot}))} title={t('Home blood pressure readings','Տնային ճնշման չափումներ','Домашние измерения давления')} labels={[t('Systolic','Սիստոլիկ','Систолическое'),t('Diastolic','Դիաստոլիկ','Диастолическое')]} unit={bpUnit(locale)} locale={locale} entity="bp" emptyText={empty} defaultExpanded/></div>;
}
