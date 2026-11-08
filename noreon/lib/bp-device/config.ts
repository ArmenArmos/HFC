type Environment=Record<string,string|undefined>;
/** B7 BP monitor inventory ships dark. Off unless explicitly enabled, and never in the marketing build. */
export function bpDevicesEnabled(env:Environment=process.env){return env.NOREON_BP_DEVICES_ENABLED==='true'&&env.NOREON_DEPLOYMENT_TARGET!=='marketing';}
