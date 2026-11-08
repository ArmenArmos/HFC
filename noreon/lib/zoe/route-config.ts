import {z} from 'zod';
import {createFakeProvider,type ZoeProvider} from './provider';
import {createGatewayProvider,realCallsBasis,zoeModelCallsEnabled,type GatewayGenerate} from './gateway';
import type {RouteConfig,RouteModel,ZoeRouting} from './pipeline';

type Env=Record<string,string|undefined>;
const model=z.object({id:z.string().regex(/^[a-z0-9-]{1,32}\/[a-z0-9_.:-]{1,64}$/),inputUsdPerMTok:z.coerce.number().positive(),outputUsdPerMTok:z.coerce.number().positive()});
const tier=z.object({version:z.number().int().positive(),dailyCapUsd:z.coerce.number().min(0).max(10),model,fallback:model.nullable()});
export const routeConfigSchema=z.object({ok:z.literal(true),tiers:z.object({low:tier.optional(),medium:tier.optional(),high:tier.optional()})});
export const parseRouteConfig=(raw:unknown):RouteConfig=>({tiers:routeConfigSchema.parse(raw).tiers});

/**
 * How a tier model becomes a provider. NOREON_ZOE_PROVIDER:
 *  - "fake" (default): every tier uses the deterministic stand-in; the trace still names the tier
 *    model it stands in for. Nothing leaves the server.
 *  - "gateway": the Vercel AI Gateway adapter, but ONLY when NOREON_ZOE_MODEL_CALLS_ENABLED is "true"
 *    and the deployment has a basis for real calls (realCallsBasis: prod-as-staging, a confirmed
 *    signed data agreement, or the owner's on-by-default setting); otherwise no provider at all (the run records provider_unavailable).
 *    Even then the database refuses the spend reservation unless zoe_settings.model_calls_allowed.
 * Anything else: no provider.
 */
export function providerMode(env:Env=process.env):'fake'|'gateway'|'off'{
 const name=env.NOREON_ZOE_PROVIDER??'fake';
 if(name==='fake')return 'fake';
 if(name==='gateway')return zoeModelCallsEnabled(env)&&realCallsBasis(env)!==null?'gateway':'off';
 return 'off';
}
export function configuredZoeRouting(config:RouteConfig,env:Env=process.env,generate?:GatewayGenerate):ZoeRouting{
 const mode=providerMode(env);
 const providerFor=(m:RouteModel):ZoeProvider|null=>mode==='fake'?createFakeProvider():mode==='gateway'?createGatewayProvider(m,{env,...(generate?{generate}:{})}):null;
 return {config,providerFor};
}
