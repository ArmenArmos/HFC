import {LIVE_PCM_MIME,LIVE_PCM_RATE,LIVE_SESSION_MAX_MS,type LiveToken} from '@/lib/zoe-chat-actions/live-contract';
import type {PatientLocale} from '@/lib/patient/copy';
import type {LiveConnection,LiveSessionCallbacks} from './live-controller';

/**
 * Browser IO for the Gemini Live transcription session (WP V), ported from the demo's LiveAudioManager: microphone
 * capture through an AudioWorklet (registered from a blob: module) at 16 kHz, Float32 to Int16 PCM, base64, streamed
 * over the Live WebSocket. Unlike the demo there is no playback of model audio at all (the session answers in text,
 * which is discarded), and the browser holds only a single-use ephemeral token from our server, never an API key.
 * Echo cancellation stays on in getUserMedia, and a barge-in counts only when the local microphone level also rose
 * (the same 0.08 guard the recorded controller uses during playback), so Zoe's own voice from the speaker does not
 * interrupt her.
 */
const WORKLET_CODE=`
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.offset = 0; }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset >= this.buffer.length) { this.port.postMessage(this.buffer.slice(0)); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
`;
export const BARGE_LEVEL=0.08;
const BARGE_WINDOW_MS=600;
const TURN_SETTLE_MS=500;

export const liveSupported=()=>typeof window!=='undefined'&&typeof AudioContext!=='undefined'&&typeof AudioWorkletNode!=='undefined'
 &&typeof WebSocket!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&typeof Blob!=='undefined'&&typeof URL.createObjectURL==='function';

/** Float32 samples in [-1, 1] to little-endian Int16 PCM, base64 (pure; exported for the checks). */
export function pcm16Base64(samples:Float32Array):string{
 const pcm=new Int16Array(samples.length);
 for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]!));pcm[i]=s<0?s*0x8000:s*0x7fff;}
 const bytes=new Uint8Array(pcm.buffer);let binary='';
 for(let i=0;i<bytes.byteLength;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
 return btoa(binary);
}
export const rmsLevel=(samples:Float32Array)=>{let sum=0;for(let i=0;i<samples.length;i++)sum+=samples[i]!*samples[i]!;return Math.sqrt(sum/Math.max(1,samples.length));};

/** Microphone capture only. One stream per session; stop() releases everything, also a permission that resolves late. */
export class LiveAudioCapture{
 private stream:MediaStream|null=null;private context:AudioContext|null=null;private node:AudioWorkletNode|null=null;private source:MediaStreamAudioSourceNode|null=null;
 private stopped=false;
 async start(onPcm:(base64:string)=>void,onLevel:(level:number)=>void):Promise<void>{
  const stream=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:LIVE_PCM_RATE,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  if(this.stopped){stream.getTracks().forEach(track=>track.stop());throw Error('Live capture stopped');}
  this.stream=stream;
  const context=new AudioContext({sampleRate:LIVE_PCM_RATE});this.context=context;
  if(context.state==='suspended')await context.resume();
  const url=URL.createObjectURL(new Blob([WORKLET_CODE],{type:'application/javascript'}));
  try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
  if(this.stopped)throw Error('Live capture stopped');
  this.source=context.createMediaStreamSource(stream);
  const node=new AudioWorkletNode(context,'pcm-capture-processor');this.node=node;
  node.port.onmessage=(event:MessageEvent<Float32Array>)=>{if(this.stopped)return;onLevel(rmsLevel(event.data));onPcm(pcm16Base64(event.data));};
  this.source.connect(node);
  // The worklet must be pulled by the graph; its output is silence (it writes nothing), so nothing is heard.
  node.connect(context.destination);
 }
 stop(){
  this.stopped=true;
  if(this.node){this.node.port.onmessage=null;this.node.disconnect();this.node=null;}
  this.source?.disconnect();this.source=null;
  this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
  void this.context?.close().catch(()=>{});this.context=null;
 }
}

/** A single-use token from our server for this audience; throws when Live is not available. */
export async function fetchLiveToken(endpoint:string,locale:PatientLocale,signal:AbortSignal):Promise<LiveToken>{
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locale}),cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)])});
 const body=await response.json();
 if(!response.ok||typeof body?.token!=='string'||typeof body.model!=='string'||typeof body.expiresAt!=='string')throw Error('Live unavailable');
 return {token:body.token,model:body.model,expiresAt:body.expiresAt};
}

type LiveMessage={serverContent?:{interrupted?:boolean;turnComplete?:boolean;generationComplete?:boolean;inputTranscription?:{text?:string;finished?:boolean}};
 voiceActivity?:{voiceActivityType?:string};goAway?:unknown};
type LiveSession={sendRealtimeInput(input:{audio:{data:string;mimeType:string}}):void;close():void};
export type LiveConnect=(options:{token:LiveToken;callbacks:{onopen:()=>void;onmessage:(message:LiveMessage)=>void;onerror:()=>void;onclose:()=>void}})=>Promise<LiveSession>;
/** The real connection: @google/genai's browser Live client with the ephemeral token, on the v1alpha API. */
const genaiConnect:LiveConnect=async({token,callbacks})=>{
 const {GoogleGenAI,Modality}=await import('@google/genai');
 const ai=new GoogleGenAI({apiKey:token.token,httpOptions:{apiVersion:'v1alpha'}});
 // The configuration is locked inside the token on the server; this only repeats it.
 return ai.live.connect({model:token.model,config:{responseModalities:[Modality.TEXT]},callbacks:callbacks as never}) as unknown as Promise<LiveSession>;
};

/**
 * Opens one Live transcription session: token, Live socket, microphone. Turn handling: input transcription chunks are
 * concatenated into the current turn; the turn ends shortly after the server's turn completion (late chunks still join
 * it). The model's own text is ignored.
 */
export async function connectLive(options:{endpoint:string;locale:PatientLocale;callbacks:LiveSessionCallbacks;signal:AbortSignal;connect?:LiveConnect;capture?:LiveAudioCapture;now?:()=>number}):Promise<LiveConnection>{
 const {callbacks,signal}=options,now=options.now??(()=>performance.now());
 const token=await fetchLiveToken(options.endpoint,options.locale,signal);
 if(signal.aborted)throw Error('Live cancelled');
 let closing=false,turn='',speaking=false,lastLoud=-Infinity;
 let settle:ReturnType<typeof setTimeout>|undefined;
 let limit:ReturnType<typeof setTimeout>|undefined=undefined;
 const capture=options.capture??new LiveAudioCapture();
 const loudRecently=()=>now()-lastLoud<=BARGE_WINDOW_MS;
 const speechStart=()=>{if(!speaking&&loudRecently()){speaking=true;callbacks.onSpeechStart();}};
 const finish=()=>{clearTimeout(settle);settle=undefined;const text=turn.trim();turn='';speaking=false;if(text)callbacks.onTurnEnd(text);};
 let session:LiveSession|null=null;
 const shut=()=>{closing=true;clearTimeout(settle);clearTimeout(limit);capture.stop();try{session?.close();}catch{/* already closed */}};
 session=await (options.connect??genaiConnect)({token,callbacks:{
  onopen:()=>{},
  onmessage:message=>{
   if(closing)return;
   const content=message.serverContent;
   if(message.voiceActivity?.voiceActivityType==='ACTIVITY_START'||content?.interrupted)speechStart();
   const chunk=content?.inputTranscription?.text;
   if(chunk){speechStart();turn+=chunk;callbacks.onPartial(turn.trim());if(settle){clearTimeout(settle);settle=setTimeout(finish,TURN_SETTLE_MS);}}
   if(content?.turnComplete||content?.generationComplete||content?.inputTranscription?.finished){clearTimeout(settle);settle=setTimeout(finish,TURN_SETTLE_MS);}
   if(message.goAway){shut();callbacks.onClose();}
  },
  onerror:()=>{if(!closing){shut();callbacks.onError();}},
  onclose:()=>{if(!closing){shut();callbacks.onClose();}},
 }});
 if(signal.aborted){shut();throw Error('Live cancelled');}
 try{
  await capture.start(data=>{if(!closing)try{session?.sendRealtimeInput({audio:{data,mimeType:LIVE_PCM_MIME}});}catch{/* the socket reports its own close */}},level=>{if(level>BARGE_LEVEL)lastLoud=now();});
 }catch(error){shut();throw error;}
 if(signal.aborted){shut();throw Error('Live cancelled');}
 limit=setTimeout(()=>{if(!closing){shut();callbacks.onClose();}},LIVE_SESSION_MAX_MS);
 return {close:shut};
}
