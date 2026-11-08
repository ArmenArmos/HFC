import 'server-only';
import {cache} from 'react';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {adminOnly} from './real-admin';

/** Server-component render only: one staff check per render instead of one per reader.
 * React cache lasts a single server request and is never shared between requests or
 * identities. Actions, route handlers and every write keep calling requireRealStaff or
 * requireRealAdmin, which check the session afresh. The database still enforces scope on
 * each read. */
export const requireRealStaffForRender = cache(requireRealStaff);
export const requireRealAdminForRender = cache(async () => adminOnly(await requireRealStaffForRender()));
