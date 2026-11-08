import type{ClinicCommandResult}from'./schema';
/** Why a reservation saved nothing, shown on the file's row. */
export type Refusal='stale'|'batch_full'|'unavailable'|'invalid'|'access';
/** WP-11 item 13: what a reservation answer means for the row. A refusal saved nothing, so it is never
 * "outcome unknown"; null means the answer could not be read and the saved-work check applies. */
export function reservationRefusal(r:ClinicCommandResult):Refusal|'duplicate'|null{
 if(r.status==='stale')return 'stale';
 if(r.status==='access')return 'access';
 if(r.status==='invalid')return 'invalid';
 if(r.status!=='rejected')return null;
 // A conflict saved nothing either: the row is sent again with new identities.
 return r.reason==='conflict'?'stale':r.reason;
}
