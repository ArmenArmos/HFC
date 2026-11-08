import{notFound,unstable_rethrow}from'next/navigation';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import{pilotCatalogEnabled}from'@/lib/pilot-commerce/config';
import{readAdminCatalog,type PilotRpc}from'@/lib/pilot-commerce/runtime';
import{recordPilotCommand}from'@/lib/pilot-commerce/actions';
import{CatalogAdmin}from'@/components/pilot-commerce/catalog-admin';
export const dynamic='force-dynamic';

export default async function CatalogPage(){
 if(!pilotCatalogEnabled())notFound();
 const{client}=await requireRealAdmin();
 let data:Awaited<ReturnType<typeof readAdminCatalog>>|null=null;
 try{data=await readAdminCatalog(client as unknown as PilotRpc);}catch(error){unstable_rethrow(error);}
 return <div className="mx-auto max-w-4xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Test catalogue</h1>
   <p className="text-body2 text-muted-foreground">Tests members can book, their partner codes and prices in AMD. A new price is added with its start time, so earlier prices stay in the history and recorded payments keep the price they were created with.</p></header>
  {data?<CatalogAdmin tests={data.tests} asOf={data.asOf} command={recordPilotCommand}/>:<p role="status" className="text-body2">The test catalogue is unavailable. Reload to check it.</p>}
 </div>;
}
