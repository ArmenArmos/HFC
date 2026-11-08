import{notFound,unstable_rethrow}from'next/navigation';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{bpDevicesEnabled}from'@/lib/bp-device/config';
import{readBpInventory,type BpRpc}from'@/lib/bp-device/runtime';
import{recordBpDeviceCommand}from'@/lib/bp-device/actions';
import{BpDeviceInventory}from'@/components/staff/bp-device-inventory';

export default async function BpDevicesPage(){
 if(!bpDevicesEnabled())notFound();
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='admin')notFound();
 let data:Awaited<ReturnType<typeof readBpInventory>>|null=null;
 try{data=await readBpInventory(client as unknown as BpRpc);}catch(error){unstable_rethrow(error);}
 const ids=(list:{id:string}[])=>Object.fromEntries(list.map(item=>[item.id,crypto.randomUUID()]));
 return <div className="mx-auto max-w-3xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">BP monitors</h1>
   <p className="text-body2 text-muted-foreground">Register monitors, see who holds each one, and review readings that could not be matched to the member holding the monitor. Automatic sync from monitors is not available yet, so readings are entered by hand.</p></header>
  {data?<BpDeviceInventory data={data} ids={{register:crypto.randomUUID(),status:ids(data.devices),recheck:ids(data.held),dismiss:ids(data.held)}} command={recordBpDeviceCommand.bind(null,'/staff/real/devices')}/>
   :<p role="status" className="text-body2">BP monitors are unavailable. Reload to check them.</p>}
 </div>;
}
