"use client";
import {staffDisplayText} from '@/lib/staff/display-text';
import {sourceBoundCaseSummary} from "@/lib/reports/source-bound-output";
import { useId, useState } from "react";
import {selectCaseEvidence,type buildCaseLedger} from "@/lib/service-workflow/evidence-ledger";
import { demoReportCommand } from "@/components/reports/demo-upload";
import { useDemoReports } from "./reports-provider";
import {
  validateCaseEvidence,
  validateCaseSummary,
  type CaseEvidence,
  type CaseSummaryDraft,
} from "@/lib/service-workflow/case-summary";

function evidenceItems(context:CaseEvidence) {
  return [
    ...context.findings.map((item) => ({
      id: item.id,
      text: staffDisplayText(`${staffDisplayText(item.text,'en')} · ${item.source}`,'en'),
    })),
    ...context.bloodPressure.map((item) => ({
      id: item.id,
      text: `${item.measuredAt}: ${item.systolic}/${item.diastolic} mmHg${item.pulse === null ? "" : `, pulse ${item.pulse}/min`} · member-entered measurement`,
    })),
    ...context.reportRows.map((item) => ({
      id: item.id,
      text: `${item.name}: ${item.literal} ${item.unit ?? ""}; printed reference ${item.reference ?? "not supplied"}; page ${item.page}; ${item.reportDate ?? "date unknown"}${item.uncertain ? "; transcription uncertain" : ""} · ${item.id.startsWith("workflow-result-") ? "fictional current result" : "checked report row"}`,
    })),
  ];
}
export function CaseSummary({evidenceLedger,evidenceRevision}:{evidenceLedger:ReturnType<typeof buildCaseLedger>;evidenceRevision:number}) {
  const {shared,loaded,persistenceError,originalUrls,reports} = useDemoReports();
  const prefix = useId();
  const {evidence:context,omitted}=selectCaseEvidence(evidenceLedger.evidence);
  const fingerprint=JSON.stringify({context,omitted,evidenceRevision:shared?evidenceRevision:null});
  const [result, setResult] = useState<{
    context: string;
    draft: CaseSummaryDraft;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const draft = result?.context === fingerprint ? result.draft : null;
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const checked = validateCaseEvidence(context);
      const response = shared ? await demoReportCommand({
        op: "case-summary",
        consent: true,
        evidence: checked,
        ...(shared?{evidenceRevision,omitted}:{}),
      }) : {draft:sourceBoundCaseSummary(checked)};
      setResult({
        context: fingerprint,
        draft: validateCaseSummary(response.draft, checked),
      });
    } catch (error) {
      setError(error instanceof Error && error.message === "stale_evidence" ? "The evidence changed. Refresh the case and prepare a new summary." : "The review summary could not be prepared. Check the evidence and try again later.");
    } finally {
      setBusy(false);
    }
  }
  const ledger=evidenceItems(context);
  const fullLedger=evidenceItems(evidenceLedger.evidence);
  function sourceLink(id:string) {
    const source=evidenceLedger.sources[id];
    const url=source&&originalUrls[source.reportId];
    if(!url)return null;
    const name=reports.find(r=>r.id===source.reportId)?.file_name??'Source report';
    return <a className="ml-2 underline" target="_blank" rel="noreferrer" href={`${url}${shared?'&preview=1':''}#page=${source.page}`}>Open {name}, page {source.page}</a>;
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-h2">Evidence review summary</h2>
      <p className="text-body2 text-muted-foreground">
        Prepared from the checked evidence below. Review the source findings before deciding the care plan.
      </p>
      <details className="rounded-md border p-3">
        <summary>Review the source evidence</summary>
        <p className="my-3 text-caption text-muted-foreground">
          Included: {context.findings.length} findings, {context.bloodPressure.length} readings and {context.reportRows.length} result rows.
          Omitted from this bounded draft: {omitted.findings} findings, {omitted.bloodPressure} readings and {omitted.reportRows} rows.
          Unchecked report rows are excluded. Full source-checked evidence is available below.
        </p>
        <ul className="space-y-2 text-body2">
          {ledger.map((item,index) => (
            <li key={item.id} id={`${prefix}-${item.id}`}>
              <strong>Evidence {index+1}</strong>: {staffDisplayText(item.text,'en')}{sourceLink(item.id)}
            </li>
          ))}
        </ul>
      </details>
      <details className="rounded-md border p-3">
        <summary>Full source-checked evidence · {fullLedger.length} items</summary>
        <ul className="mt-3 space-y-2 text-body2">{fullLedger.map(item=><li key={item.id}>{staffDisplayText(item.text,'en')}{sourceLink(item.id)}</li>)}</ul>
      </details>
      <button
        type="button"
        className="min-h-11 rounded-md bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50"
        disabled={busy || !ledger.length || (shared&&(!loaded||!!persistenceError))}
        onClick={generate}
      >
        {busy ? "Preparing summary…" : "Prepare review summary"}
      </button>
      {error && (
        <p role="alert" className="text-body2 text-destructive">
          {error}
        </p>
      )}
      {result && !draft && (
        <p className="text-body2 text-muted-foreground">
          The evidence changed. Review the updated context and prepare a new summary.
        </p>
      )}
      {draft && (
        <div className="space-y-4" aria-live="polite">
          <h3 className="text-h3">Evidence summary</h3>
          <p className="whitespace-pre-wrap text-body2">{staffDisplayText(draft.summary,'en')}</p>
          <h3 className="text-h3">Source observations</h3>
          <ul className="space-y-3 text-body2">
            {draft.considerations.map((item, index) => (
              <li key={index}>
                {staffDisplayText(item.text,'en')}
                <span className="mt-1 block">
                  Evidence:{" "}
                  {item.evidenceIds.map((id) => (
                    <a
                      key={id}
                      className="mr-3 underline"
                      href={`#${prefix}-${id}`}
                      onClick={(event) => {
                        const target = document.getElementById(
                          `${prefix}-${id}`,
                        );
                        const details = target?.closest("details");
                        if (details) details.open = true;
                        if (!target) event.preventDefault();
                      }}
                    >
                      Evidence {ledger.findIndex(item=>item.id===id)+1}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="text-h3">Missing information and uncertainty</h3>
          <ul className="list-disc space-y-2 pl-5 text-body2">
            {draft.missingInformation.map((text, index) => (
              <li key={index}>{staffDisplayText(text,'en')}</li>
            ))}
          </ul>
          <h3 className="text-h3">Suggested clinician review steps</h3>
          <ul className="list-disc space-y-2 pl-5 text-body2">
            {draft.suggestedNextSteps.map((text, index) => (
              <li key={index}>{staffDisplayText(text,'en')}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
