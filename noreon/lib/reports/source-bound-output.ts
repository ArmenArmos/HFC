import {clinicalLocale, type Locale} from '@/lib/locale';
import type {Explanation, ReportExtraction} from './schema';
import type {CaseEvidence, CaseSummaryDraft} from '@/lib/service-workflow/case-summary';

export const SOURCE_BOUND_OUTPUT_VERSION = 'source-bound-review-v1';

/** No generated prose, remembered reference ranges or clinical classification.
 * Source fields are quoted as recorded evidence, never executed as instructions.
 */
export function sourceBoundExplanation(report:ReportExtraction,locale:Locale='en'):Explanation {
  const t=(en:string,hy:string)=>clinicalLocale(locale)==='hy'?hy:en;
  const uncertain=report.rows.filter(row=>row.uncertain).length;
  return {
    summary:t(
      `${report.rows.length} recorded results${report.reportDate?` from ${report.reportDate}`:''}. ${uncertain?`${uncertain} need checking against the original. `:''}The values and printed references are shown below; no diagnosis or treatment is inferred.`,
      `${report.rows.length} գրանցված արդյունք${report.reportDate?`՝ ${report.reportDate}`:''}։ ${uncertain?`${uncertain}-ը պետք է ստուգել բնօրինակի հետ։ `:''}Ստորև ներկայացված են արժեքներն ու տպված միջակայքերը՝ առանց ախտորոշման կամ բուժման եզրակացության։`,
    ),
    attention:report.rows.flatMap((row,index)=>row.uncertain?[{row:index,reason:'unclear' as const,explanation:t('Check the value, unit and reference against the original before using this result.','Մինչև արդյունքն օգտագործելը արժեքը, միավորն ու միջակայքը ստուգեք բնօրինակի հետ։')}]:[]).slice(0,6),
    questions:[],
    items:report.rows.map((row,index)=>({row:index,kind:'result' as const,explanation:t(
      `Recorded value: “${row.literal}”${row.unit?` (${row.unit})`:'. Unit not supplied'}. ${row.reference?`Printed reference: “${row.reference}”.`:'No printed reference supplied.'} ${row.uncertain?'Transcription needs checking.':'No automatic clinical interpretation.'}`,
      `Գրանցված արժեք՝ «${row.literal}»${row.unit?` (${row.unit})`:'. Միավորը նշված չէ'}։ ${row.reference?`Տպված միջակայք՝ «${row.reference}»։`:'Տպված միջակայք չկա։'} ${row.uncertain?'Ընթերցումը պետք է ստուգել։':'Ավտոմատ բժշկական մեկնաբանություն չի կատարվում։'}`,
    ).slice(0,500)})),
  };
}

/** Bounded evidence inventory, not a second clinical engine or AI opinion. */
export function sourceBoundCaseSummary(evidence:CaseEvidence):CaseSummaryDraft {
  const entries=[
    ...evidence.findings.map(f=>({text:`Questionnaire finding: “${f.text}” (${f.source}${f.ruleIds.length?`; ${f.ruleIds.join(', ')}`:''}).`,evidenceIds:[f.id]})),
    ...evidence.bloodPressure.map(bp=>({text:`Recorded blood pressure: ${bp.systolic}/${bp.diastolic} mmHg${bp.pulse===null?'':`; pulse ${bp.pulse}/min`}; recorded at ${bp.measuredAt}.`,evidenceIds:[bp.id]})),
    ...evidence.reportRows.map(row=>({text:`Report row: “${row.name}”; recorded value “${row.literal}”${row.unit?` (${row.unit})`:''}; page ${row.page}; ${row.reportDate??'date unknown'}${row.uncertain?'; transcription uncertain':''}.`,evidenceIds:[row.id]})),
  ];
  return {
    summary:`Evidence for review: ${evidence.findings.length} questionnaire findings, ${evidence.bloodPressure.length} blood pressure readings and ${evidence.reportRows.length} checked report rows. Showing ${Math.min(entries.length,10)} of ${entries.length} items below. No final risk category or treatment is generated.`,
    considerations:entries.slice(0,10).map(entry=>({...entry,text:entry.text.slice(0,800)})),
    missingInformation:[
      ...(evidence.reportRows.some(r=>r.uncertain)?['Some report transcriptions remain uncertain.']:[]),
      ...(evidence.reportRows.some(r=>!r.reportDate)?['Some report collection dates are not supplied.']:[]),
      ...(evidence.reportRows.some(r=>!r.unit)?['Some printed units are not supplied.']:[]),
      'This evidence summary does not run the complete post-test decision tree or confirm a diagnosis.',
    ],
    suggestedNextSteps:['Review the source evidence and the approved clinical protocol before deciding the care plan.'],
  };
}

/** Model extraction narrative cannot become free-form clinical guidance. */
export function sourceBoundExtractionNarrative(report:ReportExtraction):ReportExtraction {
  return {...report,summary:`${report.rows.length} transcribed report rows. Check values, units and dates against the original.`,warnings:[
    ...(report.warnings.length?['The report reader noted uncertainty. Check the original before confirming.']:[]),
    ...(report.rows.some(row=>row.uncertain)?['Some rows are marked uncertain.']:[]),
    ...(!report.reportDate?['The collection date needs checking.']:[]),
    ...(!report.rows.length?['No readable result rows were found. Check the document.']:[]),
  ]};
}
