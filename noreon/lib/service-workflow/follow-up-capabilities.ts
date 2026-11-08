import {validMeasurement} from '@/lib/patient/validation';
import type {MeasurementInput} from '@/lib/patient/types';
/** No production adapter is configured. In-app history and manual readings remain available. */
export const integrationCapabilities={inApp:true,externalDelivery:false,deviceSync:false} as const;
export type DeliveryRequest={idempotencyKey:string;template:string;consent:boolean};
export type DeliveryAdapter={deliver:(request:DeliveryRequest)=>Promise<{receipt:string}>};
export type DeliveryResult={status:'unavailable';reason:'not-configured'|'consent-required'}|{status:'failed'}|{status:'accepted';receipt:string};
export async function deliverFollowup(adapter:DeliveryAdapter|null,request:DeliveryRequest):Promise<DeliveryResult> {
 if(!request.consent)return {status:'unavailable',reason:'consent-required'};
 if(!adapter)return {status:'unavailable',reason:'not-configured'};
 if(!request.idempotencyKey.trim()||!request.template.trim())return {status:'failed'};
 try {
  const result=await adapter.deliver(request);
  return typeof result.receipt==='string'&&result.receipt.trim()?{status:'accepted',receipt:result.receipt}:{status:'failed'};
 }catch{return {status:'failed'};}
}
export type DeviceAdapter={read:()=>Promise<unknown>};
/** Received values are not imported. A future integration must use the authenticated acceptance boundary. */
export async function readDeviceMeasurements(adapter:DeviceAdapter|null,consent:boolean):Promise<{status:'unavailable';reason:'not-configured'|'consent-required'}|{status:'failed'}|{status:'received';readings:MeasurementInput[]}> {
 if(!consent)return {status:'unavailable',reason:'consent-required'};
 if(!adapter)return {status:'unavailable',reason:'not-configured'};
 try {
  const values=await adapter.read();
  if(!Array.isArray(values)||values.length>100||!values.every(v=>validMeasurement(v))||new Set(values.map(v=>v.submissionId)).size!==values.length)return {status:'failed'};
  return {status:'received',readings:values.map(v=>({submissionId:v.submissionId,measuredAt:v.measuredAt,systolic:v.systolic,diastolic:v.diastolic,...(v.pulse!==undefined?{pulse:v.pulse}:{})}))};
 }catch{return {status:'failed'};}
}
