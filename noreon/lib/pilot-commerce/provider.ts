import{z}from'zod';

/**
 * Payment provider adapter. AWAITING Davidyants' payment method (link, callback or
 * manual check): there is no real provider, only FakePaymentProvider for tests and
 * local runs. No adapter ever receives or returns card data. A real provider maps
 * its own messages into ProviderStatusEvent; the state machine, idempotency and the
 * audit trail are the database's job in pilot_payment_provider_event.
 */
export type PaymentOrder={paymentId:string;amountAmd:number;currency:'AMD'};
export type PaymentLink={reference:string;url:string|null};
export type ProviderStatus='pending'|'paid'|'failed'|'refunded';
export type ProviderStatusEvent={eventId:string;reference:string;status:Exclude<ProviderStatus,'pending'>};
export interface PaymentProvider{
 /** Short stable name stored with the payment, so references from two providers never collide. */
 readonly name:string;
 /** Issues a payment link for an order. The order carries no member or medical detail. */
 createLink(order:PaymentOrder):Promise<PaymentLink>;
 /** The provider's current view of a reference. A link being opened is never 'paid'. */
 lookup(reference:string):Promise<{status:ProviderStatus;eventId:string|null}>;
}

/** In-memory provider for tests and local runs only. Never moves money. */
export class FakePaymentProvider implements PaymentProvider{
 readonly name='fake';
 private states=new Map<string,{status:ProviderStatus;eventId:string|null}>();
 async createLink(order:PaymentOrder){
  const reference=`FAKE-${order.paymentId.slice(0,8).toUpperCase()}-${this.states.size+1}`;
  this.states.set(reference,{status:'pending',eventId:null});
  return{reference,url:null};
 }
 async lookup(reference:string){return this.states.get(reference)??{status:'pending' as const,eventId:null};}
 /** Test hook: what the provider would report after the member pays, fails or is refunded. */
 settle(reference:string,status:Exclude<ProviderStatus,'pending'>,eventId=`${reference}:${status}`){this.states.set(reference,{status,eventId});}
}

/** The only provider a deployment may select today. */
export function configuredProvider(env:Record<string,string|undefined>=process.env):PaymentProvider|null{
 return(env.NOREON_PILOT_PAYMENTS_PROVIDER??'fake')==='fake'?new FakePaymentProvider():null;
}

const eventOutcomeSchema=z.object({status:z.enum(['saved','replayed','unchanged','transition-refused','not-found','invalid','unavailable']),current:z.string().optional()});
export type ProviderEventOutcome=z.infer<typeof eventOutcomeSchema>|{status:'failed'};
type Rpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
/** The provider event function is granted to the service role only; pass a service-role client. */
export async function applyProviderEvent(client:Rpc,provider:string,event:ProviderStatusEvent):Promise<ProviderEventOutcome>{
 try{
  const response=await client.rpc('pilot_payment_provider_event',{p_event:{provider,providerReference:event.reference,eventId:event.eventId,status:event.status}});
  if(response.error)return{status:'failed'};
  const parsed=eventOutcomeSchema.safeParse(response.data);return parsed.success?parsed.data:{status:'failed'};
 }catch{return{status:'failed'};}
}
/** Asks the provider about one reference and records a settled answer. */
export async function reconcileWithProvider(client:Rpc,provider:PaymentProvider,reference:string):Promise<ProviderEventOutcome|{status:'pending'}>{
 const seen=await provider.lookup(reference);
 if(seen.status==='pending'||!seen.eventId)return{status:'pending'};
 return applyProviderEvent(client,provider.name,{eventId:seen.eventId,reference,status:seen.status});
}
