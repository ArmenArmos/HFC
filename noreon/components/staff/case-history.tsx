"use client";
import type { Database } from '@/lib/db/types';
import { eventLabels } from '@/lib/notifications/catalogue';
import { useDemoReports } from '@/components/service-workflow/reports-provider';
export type CaseHistoryItem = Pick<Database['public']['Tables']['workspace_activity']['Row'], 'id'|'kind'|'actor_label'|'created_at'|'case_revision'>;
const dateFormat=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',hourCycle:'h23',timeZone:'Asia/Yerevan'});
export function CaseHistory({initialHistory}:{initialHistory:CaseHistoryItem[]}) {
  const {snapshot,refresh,loaded}=useDemoReports();
  const history=snapshot?.history === undefined ? initialHistory : snapshot.history;
  return <section id="case-history" className="mt-8 rounded-xl border bg-background p-6">
    <h2 className="text-h3 font-semibold">Case history</h2>
    <p className="mt-2 text-body2 text-muted-foreground">Latest 100 recorded case changes since history was enabled. Older actions are not reconstructed. Times are shown in Yerevan time. This history lasts for the demo case lifetime.</p>
    {history === null ? <div role="alert" className="mt-4 space-y-2 text-body2"><p>Case history could not be loaded.</p><button type="button" className="min-h-11 rounded-md border px-4" disabled={!loaded} onClick={()=>void refresh().catch(()=>undefined)}>Retry loading history</button></div>
      : history.length ? <ol className="mt-4 divide-y">{history.map(e=><li key={e.id} className="py-3"><p className="text-body2 font-medium">{eventLabels[e.kind]??e.kind}</p><p className="text-caption text-muted-foreground">{e.actor_label} · {dateFormat.format(new Date(e.created_at))} · Case revision {e.case_revision}</p></li>)}</ol>
      : <p className="mt-4 text-body2">No case changes have been recorded yet.</p>}
  </section>;
}
