'use client';
import{useRouter}from'next/navigation';
import{VisitEvidence}from'./visit-evidence';
import type{VisitEvidenceProps,VisitCommandPort,VisitRefreshPort}from'@/lib/staff/visit-evidence-schema';
type Props=Omit<VisitEvidenceProps,'command'|'refresh'>&{commandAction:VisitCommandPort;refreshAction:VisitRefreshPort};
/** Request actual RSC props/IDs after a guarded outcome. The widget still waits
 * for those props; router.refresh is never treated as commit/retirement proof. */
export function RealVisitEvidence({commandAction,refreshAction,...props}:Props){
 const router=useRouter();
 const command:VisitCommandPort=async input=>{const result=await commandAction(input);if(result.status==='saved')router.refresh();return result;};
 const refresh:VisitRefreshPort=async input=>{const result=await refreshAction(input);if(result.status==='loaded')router.refresh();return result;};
 return <VisitEvidence {...props} command={command} refresh={refresh}/>;
}
