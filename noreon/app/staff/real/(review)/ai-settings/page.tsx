import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {readAiSettings,readEvalJob,zoeAiSettingsEnabled,type AiSettings,type EvalJob,type Rpc} from '@/lib/zoe/settings-core';
import {gatewayConfigured,zoeModelCallsEnabled} from '@/lib/zoe/gateway';
import {providerMode} from '@/lib/zoe/route-config';
import {tierRuleSummary} from '@/lib/zoe/routing';
import {applyZoeTierChange,rollbackZoeTierChange,runZoeModelEval} from '@/lib/zoe/settings-actions';
import {AiSettingsAdmin} from '@/components/zoe/ai-settings';
export const dynamic='force-dynamic';
// The model eval (real calls) runs after this page's server action responds, within this limit:
// the high tier takes about 9 minutes (Vercel fluid compute allows up to 800 s).
export const maxDuration=800;

export default async function AiSettingsPage(){
 if(!zoeAiSettingsEnabled())notFound();
 const {client}=await requireRealAdmin();
 const rpc:Rpc=async(name,args)=>{const r=await client.rpc(name as never,args as never);if(r.error)throw Error('AI settings unavailable');return r.data;};
 let data:AiSettings|null=null;
 try{data=await readAiSettings(rpc);}catch(error){unstable_rethrow(error);}
 // The latest background model eval; missing (older database or a read error) shows no job.
 let job:EvalJob|null=null;
 if(data)try{job=await readEvalJob(rpc);}catch(error){unstable_rethrow(error);}
 // Yes/no only: no key or token value ever reaches the page.
 const status={appFlag:zoeModelCallsEnabled(),gateway:gatewayConfigured(),mode:providerMode()};
 return <div className="mx-auto max-w-5xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">AI settings</h1>
   <p className="text-body2 text-muted-foreground">What Zoe is allowed to do, which AI models she uses and what she spends.</p></header>
  {data?<AiSettingsAdmin data={data} job={job} status={status} rules={tierRuleSummary} apply={applyZoeTierChange} rollback={rollbackZoeTierChange} modelEval={runZoeModelEval}/>:<p role="status" className="text-body2">AI settings are unavailable. Reload to check them.</p>}
 </div>;
}
