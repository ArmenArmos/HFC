/** One destination for every member detail route; preserves existing deep links. */
export type PatientDestination = 'home' | 'progress' | 'zoe' | 'team' | 'plan' | 'me';
export function patientDestination(path: string): PatientDestination {
  if (/^\/patient\/zoe(\/|$)/.test(path)) return 'zoe';
  if (/^\/patient\/team(\/|$)/.test(path)) return 'team';
  if (/^\/patient\/(account|profile|questions|health\/profile|telegram-link)(\/|$)/.test(path)) return 'me';
  if (/^\/patient\/(care|service|learn|medicines|review)(\/|$)/.test(path)) return 'plan';
  if (/^\/patient\/(progress|health|measurements|results|reports|documents|bp-week)(\/|$)/.test(path)) return 'progress';
  return 'home';
}
