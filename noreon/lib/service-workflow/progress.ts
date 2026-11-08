import type { ServiceWorkflow } from './types';
import {bookingApplies} from './reconciliation';
import { earliestAppointmentDay, reviewWindow } from '@/lib/service-workflow/model';
import { dateInArmenia } from '@/lib/patient/validation';

export function serviceProgress(w: ServiceWorkflow, now = new Date()) {
  const outstanding = w.tests.filter(t => !w.receivedTestIds.includes(t.id));
  const unbooked = outstanding.filter(t => !w.bookings.some(b => bookingApplies(w,b,t.id)));
  const window = reviewWindow(w);
  const overdue = !w.publication && !!window && dateInArmenia(now) > window.to;
  const appointmentNeeded = w.consultation === 'required' && (!w.appointment || w.appointment.status === 'needs-reschedule' || (w.appointment.status === 'completed' && w.clinicalContext !== undefined && w.appointment.completedForContext !== w.clinicalContext));
  return { outstanding, unbooked, window, overdue, appointmentNeeded,
    canBookAppointment: appointmentNeeded && earliestAppointmentDay(w, now) !== null };
}
