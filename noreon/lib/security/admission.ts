import 'server-only';
import { headers } from 'next/headers';
import { workspaceAdmin } from '@/lib/staff/auth';
import { admissionIdentity } from './admission-source';

export class AdmissionLimit extends Error {
  readonly retryAfter: number;
  constructor(seconds: number) {
    super('rate_limited');
    this.retryAfter=seconds;
  }
}
export async function requestAdmissionIdentity(email?: string, requestHeaders?: Headers) {
  return admissionIdentity(requestHeaders ?? await headers(), {
    production: process.env.NODE_ENV === 'production',
    vercel: process.env.VERCEL === '1',
    secret: process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY ?? '',
  }, email);
}
export async function claimAdmission(operation: 'upload'|'login', identity: Awaited<ReturnType<typeof requestAdmissionIdentity>>) {
  const {data,error}=await workspaceAdmin().rpc('claim_workspace_admission',{
    p_operation:operation,p_source:identity.source,p_email:identity.email,
  });
  if(error || typeof data!=='number' || data<0) throw new Error('admission_unavailable');
  if(data>0) throw new AdmissionLimit(data);
}
