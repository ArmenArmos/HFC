import 'server-only';
import {configuredZoeProvider} from '../provider';
import {configuredZoeRouting,parseRouteConfig,providerMode} from '../route-config';
import {gatewayConfigured,type GatewayGenerate} from '../gateway';
import type {ZoeRpc} from '../server';

/** Same routing and reply-judge selection as the member sweep. No member reads or pipeline writes. */
export async function practiceProviders(rpc:ZoeRpc,env:Record<string,string|undefined>=process.env,generate?:GatewayGenerate){
 if(providerMode(env)!=='gateway'||!gatewayConfigured(env))return null;
 const config=parseRouteConfig(await rpc('zoe_route_config',{}));
 if(!config.tiers.low||!config.tiers.medium||!config.tiers.high)return null;
 return {provider:configuredZoeProvider(env),routing:configuredZoeRouting(config,env,generate),judge:'routing' as const,env};
}
