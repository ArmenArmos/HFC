import type {CareResult} from "@/lib/patient-care/types";
import type {PatientLocale} from "@/lib/patient/copy";
import {resultGroups} from "@/lib/patient-care/model";
import {labRange} from "@/lib/patient-care/journey-evidence";
import {copy} from "./common";
export function TestSummary({results,locale:l,compact=false}:{results:CareResult[];locale:PatientLocale;compact?:boolean}) {
  const latest=resultGroups(results).map(group=>group.at(-1)!);
  const known=latest.filter(result=>labRange(result).status!=="unknown");
  const outside=known.filter(result=>["above","below"].includes(labRange(result).status)).length;
  const unknown=latest.length-known.length;
  return <section aria-label={copy(l,"Your test results","Ձեր հետազոտությունների արդյունքները", "Ваши результаты анализов")} className={compact ? "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-3" : "journey-card"}>
    {!compact && <h2>{copy(l,"Your test results","Ձեր հետազոտությունների արդյունքները", "Ваши результаты анализов")}</h2>}
    <p className="text-body2">{latest.length?copy(l,`${latest.length} published ${latest.length===1?'result':'results'}`,`Հրապարակված է ${latest.length} արդյունք`, `Опубликовано результатов: ${latest.length}`):copy(l,"No approved results available yet.","Հաստատված արդյունքներ դեռ չկան։", "Утверждённых результатов пока нет.")}</p>
    {latest.length>0&&<div className="flex flex-wrap gap-2 text-caption">
      {known.length>0&&<span className="rounded-full bg-muted px-2 py-1">{copy(l,`${outside} of ${known.length} outside supplied ranges`,`${known.length}-ից ${outside}-ը՝ տրամադրված միջակայքից դուրս`, `${outside} из ${known.length} за пределами предоставленных диапазонов`)}</span>}
      {unknown>0&&<span className="rounded-full bg-muted px-2 py-1">{copy(l,`${unknown} ${unknown===1?'range':'ranges'} unknown`,`${unknown} միջակայք՝ անհայտ`, `Диапазон неизвестен: ${unknown}`)}</span>}
    </div>}
  </section>;
}
