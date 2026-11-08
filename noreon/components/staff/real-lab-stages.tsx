'use client';
import{useRouter}from'next/navigation';
import{LabStages}from'./lab-stages';
import type{Locale}from'@/lib/locale';
import type{LabStageCommandPort,StaffLabRead}from'@/lib/staff/lab-stage-schema';
type Props={data:StaffLabRead;locale:Locale;role:'nurse'|'doctor';submissionIds:Record<string,string>;commandAction:LabStageCommandPort};
/** The bound server action is the only command port; the database enforces
 * scope. A saved stage requests fresh server props, which carry new submission IDs. */
export function RealLabStages({commandAction,...props}:Props){
 const router=useRouter();
 const command:LabStageCommandPort=async input=>{const result=await commandAction(input);if(result.status==='saved')router.refresh();return result;};
 return <LabStages {...props} command={command}/>;
}
