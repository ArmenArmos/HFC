"use client";
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import { useState } from "react";
import type { ReportRecord } from "@/lib/reports/demo";
import { extractionSchema } from "@/lib/reports/schema";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import { useDemoReports } from "./reports-provider";

/** Source attribution only; receipt attestation remains a separate clinical action. */
export function ReportAssociations({record,workflow,doctorName,disabled}:{record:ReportRecord;workflow:ServiceWorkflow;doctorName:string;disabled:boolean}) {
  const memory=useDemoReports();
  const requirements=(workflow.requirements??[]).filter(r=>r.retiredAtRevision===null);
  const currentAssociations=(record.associations??[]).filter(a=>requirements.some(r=>r.requirementId===a.requirementId));
  const retiredAssociations=(record.associations??[]).filter(a=>!requirements.some(r=>r.requirementId===a.requirementId));
  const [requirementId,setRequirementId]=useState("");
  const [rows,setRows]=useState<number[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const parsed=extractionSchema.safeParse(record.reviewed);
  if(!parsed.success)return null;
  const unavailable=disabled||busy||workflow.recommendationsPending||!memory.loaded||!!memory.persistenceError;
  async function save(id:string,indices:number[]) {
    setBusy(true);setMessage("");
    try {
      await memory.associate(record.id,id,indices,doctorName,workflow.evidenceRevision??0);
      setMessage(indices.length?"Source association saved. Confirm receipt separately when appropriate.":"Source association removed.");
    } catch(error) {setMessage(error instanceof Error?error.message:"Could not save this association.");}
    finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-lg border p-4" aria-label="Report source associations">
    <h3 className="text-h3">Associate checked rows with an ordered test</h3>
    <p className="text-body2 text-muted-foreground">Confirm which current test these source rows support. This does not mark the test received or approve the report for publication. Changing an association clears the report approval and requires a new publication.</p>
    {currentAssociations.map(a=><div key={a.requirementId} className="rounded-md border p-3 text-body2">
      <p>{requirements.find(r=>r.requirementId===a.requirementId)?.test.title??"Previous test requirement"}: rows {a.rowIndices.map(i=>i+1).join(", ")}</p>
      <p className="text-muted-foreground">Confirmed by {a.actorLabel} · {yerevanStamp(a.confirmedAt,'en')}</p>
      <button type="button" className="min-h-11 underline" disabled={!!unavailable} onClick={()=>void save(a.requirementId,[])}>Remove association</button>
    </div>)}
    {!!retiredAssociations.length&&<details><summary className="min-h-11 cursor-pointer text-body2">No longer a current requirement ({retiredAssociations.length})</summary><ul className="space-y-2 text-body2">{retiredAssociations.map(a=><li key={a.requirementId}>{workflow.requirements?.find(r=>r.requirementId===a.requirementId)?.test.title??"Previous test requirement"}: rows {a.rowIndices.map(i=>i+1).join(", ")} · {a.actorLabel} · {yerevanStamp(a.confirmedAt,'en')}</li>)}</ul></details>}
    {requirements.length ? <>
      <label className="block text-body2">Current ordered test
        <select value={requirementId} disabled={!!unavailable} className="mt-1 min-h-11 w-full rounded-md border bg-background p-3" onChange={e=>{setRequirementId(e.target.value);setRows([]);setMessage("");}}>
          <option value="">Choose a test</option>
          {requirements.map(r=><option key={r.requirementId} value={r.requirementId}>{r.test.title}</option>)}
        </select>
      </label>
      <fieldset disabled={!!unavailable} className="space-y-2"><legend className="text-body2 font-medium">Checked source rows</legend>
        {parsed.data.rows.map((row,index)=><label key={index} className="flex min-h-11 items-center gap-3 text-body2"><input type="checkbox" checked={rows.includes(index)} onChange={e=>setRows(old=>e.target.checked?[...old,index].sort((a,b)=>a-b):old.filter(i=>i!==index))}/>{index+1}. {row.name}: {row.literal} {row.unit??""} · page {row.page}</label>)}
      </fieldset>
      <button type="button" className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={!!unavailable||!requirements.some(r=>r.requirementId===requirementId)||!rows.length} onClick={()=>void save(requirementId,rows)}>{busy?"Saving…":"Confirm source association"}</button>
    </>:<p className="text-body2">No current ordered tests are available for association.</p>}
    {disabled&&<p className="text-body2">Finish saving and checking the source fields before changing associations.</p>}
    {message&&<p role="status" className="text-body2">{message}</p>}
    {!!record.associationHistory?.length&&<details><summary className="min-h-11 cursor-pointer text-body2">Previous source associations ({record.associationHistory.length})</summary><ul className="space-y-2 text-body2">{record.associationHistory.map((a,i)=><li key={i}>Rows {a.rowIndices.map(n=>n+1).join(", ")} · {a.actorLabel} · {a.reason.replaceAll("-"," ")} · {yerevanStamp(a.retiredAt,'en')}</li>)}</ul></details>}
  </section>;
}
