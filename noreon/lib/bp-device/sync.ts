import{z}from'zod';

/**
 * BP monitor sync adapter. AWAITING Q11 (device model and vendor API): there is
 * no real transport yet, only FakeBpTransport for tests and local runs. A real
 * transport implements BpReadingTransport and maps the vendor payload into
 * BpDeviceReading; everything after that (idempotency, the wrong-member guard,
 * holding for staff review) is the database's job in bp_device_ingest_reading.
 */
export type BpDeviceReading={externalId:string;serial:string;systolic:number;diastolic:number;pulse:number|null;measuredAt:string;memberId:string|null};
export interface BpReadingTransport{
 /** Short stable name stored with each reading, so the same vendor id from two transports never collides. */
 readonly name:string;
 /** Readings measured after the cursor, oldest first, and the cursor to resume from. */
 pull(cursor:string|null):Promise<{readings:BpDeviceReading[];cursor:string|null}>;
}
export type BpIngestOutcome={status:'attached'|'held'|'dismissed'|'invalid'|'conflict'|'unavailable'|'failed';readingId?:string;reason?:string|null;replayed?:boolean};
export type BpIngestPort=(payload:Record<string,unknown>)=>Promise<BpIngestOutcome>;

const outcomeSchema=z.union([
 // A resent reading an admin already dismissed is a known outcome, so the cursor moves on.
 z.strictObject({status:z.enum(['attached','held','dismissed']),readingId:z.uuid(),reason:z.string().nullable(),replayed:z.boolean()}),
 z.strictObject({status:z.enum(['invalid','conflict','unavailable'])}),
]);
type Rpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
/** The ingest function is granted to the service role only; pass a service-role client. */
export function rpcIngestPort(client:Rpc):BpIngestPort{
 return async payload=>{
  try{const response=await client.rpc('bp_device_ingest_reading',{p_reading:payload});if(response.error)return{status:'failed'};
   const parsed=outcomeSchema.safeParse(response.data);return parsed.success?parsed.data:{status:'failed'};}catch{return{status:'failed'};}
 };
}

/** Pulls once and ingests each reading. The cursor only advances past a
 * reading whose outcome is known, so a failed run resumes from the same place. */
export async function syncBpReadings(transport:BpReadingTransport,ingest:BpIngestPort,cursor:string|null){
 const page=await transport.pull(cursor);
 const outcomes:BpIngestOutcome[]=[];
 for(const reading of page.readings){
  const outcome=await ingest({version:'bp-reading-v1',transport:transport.name,externalId:reading.externalId,serial:reading.serial,systolic:reading.systolic,diastolic:reading.diastolic,pulse:reading.pulse,measuredAt:reading.measuredAt,memberId:reading.memberId});
  outcomes.push(outcome);
  if(outcome.status==='unavailable'||outcome.status==='failed')return{outcomes,cursor,complete:false};
 }
 return{outcomes,cursor:page.cursor,complete:true};
}

/** In-memory transport for tests and local runs. Never used in production. */
export class FakeBpTransport implements BpReadingTransport{
 readonly name='fake';
 private readonly readings:BpDeviceReading[];
 constructor(readings:BpDeviceReading[]){this.readings=readings;}
 async pull(cursor:string|null){
  const start=cursor===null?0:Number(cursor);
  const readings=this.readings.slice(start);
  return{readings,cursor:String(start+readings.length)};
 }
}
