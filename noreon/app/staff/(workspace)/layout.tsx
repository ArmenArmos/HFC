import { requireStaff } from '@/lib/staff/auth';
import { StaffShell } from '@/components/staff/shell';
export default async function WorkspaceLayout({children}:{children:React.ReactNode}) {
  const identity=await requireStaff();
  return <StaffShell identity={identity}>{children}</StaffShell>;
}
