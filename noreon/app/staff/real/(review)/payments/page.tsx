import{notFound,unstable_rethrow}from'next/navigation';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import{pilotPaymentsEnabled}from'@/lib/pilot-commerce/config';
import{readAdminPayments,type PilotRpc}from'@/lib/pilot-commerce/runtime';
import{issuePaymentLink,recordPilotCommand}from'@/lib/pilot-commerce/actions';
import{PaymentsAdmin}from'@/components/pilot-commerce/payments-admin';
export const dynamic='force-dynamic';

export default async function PaymentsPage(){
 if(!pilotPaymentsEnabled())notFound();
 const{client}=await requireRealAdmin();
 let data:Awaited<ReturnType<typeof readAdminPayments>>|null=null;
 try{data=await readAdminPayments(client as unknown as PilotRpc);}catch(error){unstable_rethrow(error);}
 return <div className="mx-auto max-w-4xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Payments</h1>
   <p className="text-body2 text-muted-foreground">One payment record per booking. The record keeps the tests and prices at the time it was created. Every change is recorded with who made it and why.</p></header>
  {data?<PaymentsAdmin data={data} command={recordPilotCommand} issueLink={issuePaymentLink}/>:<p role="status" className="text-body2">Payments are unavailable. Reload to check them.</p>}
 </div>;
}
