import{BACKOFFICE_HOSTS}from'@/lib/staff/hosts';
type Environment=Record<string,string|undefined>;
export function clinicPortalEnabled(env:Environment=process.env){return env.NOREON_CLINIC_PORTAL_ENABLED==='true'&&env.NOREON_DEPLOYMENT_TARGET!=='marketing';}
export function clinicHostAllowed(host:string,env:Environment=process.env){
 const normalized=host.toLowerCase();
 if(env.NODE_ENV!=='production'&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized))return true;
 // The one staff and clinic domain (Khikar, 17 Oct): clinic accounts sign in on the backoffice page too.
 if(BACKOFFICE_HOSTS.includes(normalized))return true;
 const configured=env.NOREON_CLINIC_PORTAL_HOST?.toLowerCase();
 return !!configured&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(configured)&&normalized===configured;
}
/** Next's route URL can contain an internal hostname behind its proxy. Match
 * the browser Origin to the explicit clinic Host allowlist, not that URL.
 * Host is still independently checked by the Auth guard; forwarded headers
 * never grant origin or membership authority. Missing/malformed Origin denies. */
export function clinicRequestOriginAllowed(request:Pick<Request,'headers'>,env:Environment=process.env){
 const origin=request.headers.get('origin'),host=request.headers.get('host');
 if(!origin||!host||!clinicHostAllowed(host,env))return false;
 try{const parsed=new URL(origin);return parsed.origin===origin&&parsed.host.toLowerCase()===host.toLowerCase()&&(env.NODE_ENV==='production'?parsed.protocol==='https:':['http:','https:'].includes(parsed.protocol));}catch{return false;}
}
