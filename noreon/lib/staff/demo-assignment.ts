import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';

/** Resolve only the designated demo identity. Never choose an arbitrary available GP. */
export async function findDefaultDemoDoctor(
  db: SupabaseClient<Database>,
  enabled: boolean,
  email = 'demo.doctor@noreon.health',
): Promise<string | null> {
  if (!enabled || !email.trim()) return null;
  try {
    const { data: doctors, error } = await db.from('workspace_staff')
      .select('user_id,clinic_id').eq('role', 'doctor').eq('active', true);
    if (error) throw error;
    for (const doctor of doctors ?? []) {
      if (!doctor.clinic_id) continue;
      const { data: identity, error: identityError } = await db.auth.admin.getUserById(doctor.user_id);
      if (identityError) throw identityError;
      if (identity.user.email?.toLowerCase() !== email.trim().toLowerCase()) continue;
      const { data: clinic, error: clinicError } = await db.from('workspace_clinics')
        .select('active').eq('id', doctor.clinic_id).maybeSingle();
      if (clinicError) throw clinicError;
      return clinic?.active ? doctor.user_id : null;
    }
    return null;
  } catch {
    // Registration can continue unassigned; backoffice retains its assignment queue.
    console.warn('noreon.demo_default_gp_lookup_unavailable');
    return null;
  }
}
