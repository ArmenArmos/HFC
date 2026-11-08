type Environment=Record<string,string|undefined>;
const live=(env:Environment)=>env.NOREON_DEPLOYMENT_TARGET!=='marketing';
/** Pilot test catalogue and prices. Ships dark; prices are STAGING placeholders until Davidyants supplies its list. */
export function pilotCatalogEnabled(env:Environment=process.env){return env.NOREON_PILOT_CATALOG_ENABLED==='true'&&live(env);}
/** Payment records per booking. Ships dark; fake provider only, never a real payment call. Needs the catalogue for prices. */
export function pilotPaymentsEnabled(env:Environment=process.env){return env.NOREON_PILOT_PAYMENTS_ENABLED==='true'&&pilotCatalogEnabled(env);}
/** Admin cohort overview. Ships dark. */
export function gmDashboardEnabled(env:Environment=process.env){return env.NOREON_GM_DASHBOARD_ENABLED==='true'&&live(env);}
