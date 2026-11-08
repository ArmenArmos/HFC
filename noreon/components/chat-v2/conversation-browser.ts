import {VOICE_MAX_BYTES,VOICE_MAX_MS} from '@/lib/zoe-chat-actions/voice-contract';
import type {PatientLocale} from '@/lib/patient/copy';
import type {CaptureCallbacks,ConversationTranscript} from './conversation-controller';
import {splitConversationSpeech} from '@/lib/voice-core/chunk';

export const conversationSupported=()=>typeof window!=='undefined'&&typeof MediaRecorder!=='undefined'&&typeof AudioContext!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&['audio/mp4','audio/webm;codecs=opus','audio/webm'].some(type=>MediaRecorder.isTypeSupported(type));
/** One microphone stream per listening/playback interval; late permission is always released. */
export async function captureConversation(callbacks:CaptureCallbacks):Promise<()=>void>{
 let cancelled=false,finished=false,stream:MediaStream|undefined,context:AudioContext|undefined,recorder:MediaRecorder|undefined,frame=0;
 let timer:ReturnType<typeof setTimeout>|undefined;const chunks:Blob[]=[];let size=0,start=0,lastVoice=0,voiced=false,onset=0;
 const dispose=()=>{cancelAnimationFrame(frame);clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());void context?.close().catch(()=>{});};
 const stop=()=>{cancelled=true;dispose();if(recorder?.state==='recording')recorder.stop();};
 const error=()=>{if(cancelled||finished)return;finished=true;stop();callbacks.onError();};
 // Return a cancel handle before the permission prompt resolves so pagehide can invalidate it immediately.
 void (async()=>{
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(cancelled){dispose();return;}
   context=new AudioContext();await context.resume();if(cancelled){dispose();return;}
   const analyser=context.createAnalyser();analyser.fftSize=1024;context.createMediaStreamSource(stream).connect(analyser);
   const data=new Float32Array(analyser.fftSize);
   const mimeType=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mimeType){error();return;}
   const finish=()=>{if(finished||cancelled)return;finished=true;if(recorder?.state==='recording')recorder.stop();dispose();};
   const record=()=>{
    recorder=new MediaRecorder(stream!,{mimeType});start=performance.now();
    recorder.ondataavailable=event=>{size+=event.data.size;if(size>VOICE_MAX_BYTES){finished=false;error();return;}chunks.push(event.data);};
    recorder.onerror=()=>{finished=false;error();};
    recorder.onstop=()=>{if(!cancelled&&voiced&&size<=VOICE_MAX_BYTES)callbacks.onTurn(new Blob(chunks,{type:recorder!.mimeType||mimeType}),Math.min(VOICE_MAX_MS,Math.max(1,Math.round(performance.now()-start))));};
    recorder.start(250);timer=setTimeout(finish,VOICE_MAX_MS);
   };
   if(!callbacks.barge)record();
   const meter=()=>{
    if(cancelled||finished)return;
    analyser.getFloatTimeDomainData(data);const rms=Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length),now=performance.now();
    // Speaker monitoring uses a higher sustained threshold. Browser acoustic echo cancellation is still required.
    if(rms>(callbacks.barge&&!voiced?0.08:0.025)){
     if(!onset)onset=now;
     if(voiced||now-onset>=(callbacks.barge?250:100)){
      lastVoice=now;
      if(!voiced){voiced=true;if(!recorder)record();callbacks.onSpeech();}
     }
    }else onset=0;
    if(voiced&&now-lastVoice>=1200){finish();return;}
    frame=requestAnimationFrame(meter);
   };frame=requestAnimationFrame(meter);
  }catch{error();}
 })();
 return stop;
}
export async function transcribeConversation(audio:Blob,durationMs:number,locale:PatientLocale,signal:AbortSignal,endpoint='/api/patient/zoe/voice'):Promise<ConversationTranscript>{
 const response=await fetch(endpoint,{method:'POST',body:audio,headers:{'Content-Type':audio.type,'X-Voice-Locale':locale,'X-Voice-Duration-Ms':String(durationMs)},cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])});
 const result=await response.json();
 if(!response.ok||result.status!=='ok'||typeof result.text!=='string'||!result.text.trim()||typeof result.receipt!=='string')throw new Error('Voice transcription unavailable');
 return result;
}
/** The chunker moved to lib/voice-core so the streaming speech route uses the same chunks; re-exported for callers. */
export {splitConversationSpeech};
export async function playSpeechChunk(result:{audioBase64:string;mime:string},signal:AbortSignal):Promise<void>{
 const bytes=Uint8Array.from(atob(result.audioBase64),char=>char.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:result.mime})),audio=new Audio(url);
 await new Promise<void>((resolve,reject)=>{
  const clean=()=>{audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);signal.removeEventListener('abort',aborted);audio.onended=null;audio.onerror=null;};
  const aborted=()=>{clean();resolve();};
  signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted){aborted();return;}
  audio.onended=()=>{clean();resolve();};audio.onerror=()=>{clean();reject(new Error('Voice playback unavailable'));};
  void audio.play().catch(()=>{clean();reject(new Error('Voice playback unavailable'));});
 });
}
export async function playConversation(text:string,locale:PatientLocale,signal:AbortSignal,endpoint='/api/patient/zoe/speech'):Promise<void>{
 if(signal.aborted)return;
 // Keep local message playback and the conversation response from talking over one another.
 window.dispatchEvent(new Event('cv2-conversation-playback'));
 const chunks=splitConversationSpeech(text);if(!chunks.length)return;
 const controller=new AbortController(),playbackSignal=AbortSignal.any([signal,controller.signal]);
 const fetchChunk=async(text:string)=>{
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,locale}),cache:'no-store',signal:AbortSignal.any([playbackSignal,AbortSignal.timeout(30_000)])});
   const result=await response.json();
   if(!response.ok||result.status!=='ok'||typeof result.audioBase64!=='string'||typeof result.mime!=='string'||!/^audio\//.test(result.mime))return null;
   return {audioBase64:result.audioBase64 as string,mime:result.mime as string};
  }catch{return null;} // Prefetch failures are handled in order, never as unhandled rejections.
 };
 let pending=fetchChunk(chunks[0]);
 let next=chunks.length>1?fetchChunk(chunks[1]):null;
 try{
  for(let i=0;i<chunks.length;i++){
   if(playbackSignal.aborted)return;
   try{
    const result=await pending;if(playbackSignal.aborted)return;
    if(!result)throw new Error('Voice playback unavailable');
    // At most the current chunk and its successor are requested. No unbounded queue.
    if(i>0)next=i+1<chunks.length?fetchChunk(chunks[i+1]):null;
    await playSpeechChunk(result,playbackSignal);
   }catch{
    if(i===0&&!playbackSignal.aborted)throw new Error('Voice playback unavailable');
    return; // The complete reply remains on screen if later audio is unavailable.
   }
   if(next)pending=next;
  }
 }finally{controller.abort();}
}

/** One server-sent event block ("event: x\ndata: {...}") parsed; null when it is not one of ours. Exported for the checks. */
export function parseSpeechEvent(block:string):{event:'chunk';index:number;audioBase64:string;mime:string}|{event:'end'|'failed'}|null{
 let name='',data='';
 for(const line of block.split('\n')){if(line.startsWith('event: '))name=line.slice(7).trim();else if(line.startsWith('data: '))data+=line.slice(6);}
 try{
  const value=JSON.parse(data);
  if(name==='chunk'&&Number.isInteger(value?.index)&&typeof value.audioBase64==='string'&&typeof value.mime==='string'&&/^audio\//.test(value.mime))return {event:'chunk',index:value.index,audioBase64:value.audioBase64,mime:value.mime};
  if(name==='end'||name==='failed')return {event:name};
 }catch{/* not ours */}
 return null;
}

/**
 * Streaming speech (WP V): Zoe's reply arrives as server-sent sentence chunks while the server synthesizes them, so
 * playback starts after the first chunk. Chunks play strictly in order; an abort (barge-in, stop, page hidden) stops the
 * current audio at once and cancels the rest of the stream. When the stream route is unavailable before any audio
 * arrives, the existing per-chunk route (playConversation) speaks the reply instead.
 */
export async function playConversationStream(text:string,locale:PatientLocale,signal:AbortSignal,endpoint='/api/patient/zoe/speech-stream',fallback='/api/patient/zoe/speech'):Promise<void>{
 if(signal.aborted||!text.trim())return;
 window.dispatchEvent(new Event('cv2-conversation-playback'));
 const controller=new AbortController(),stop=AbortSignal.any([signal,controller.signal]);
 let response:Response;
 try{
  response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,locale}),cache:'no-store',signal:AbortSignal.any([stop,AbortSignal.timeout(60_000)])});
 }catch{if(signal.aborted)return;return playConversation(text,locale,signal,fallback);}
 if(!response.ok||!response.body||!(response.headers.get('content-type')??'').startsWith('text/event-stream')){
  if(signal.aborted)return;
  return playConversation(text,locale,signal,fallback);
 }
 const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
 const queue:{audioBase64:string;mime:string}[]=[];let done=false,failed=false,played=0,wake:(()=>void)|null=null;
 const notify=()=>{const w=wake;wake=null;w?.();};
 // Reads the stream into the in-order queue while the chunks play.
 const read=(async()=>{
  let buffer='',expected=0;
  try{
   for(;;){
    const {value,done:end}=await reader.read();
    if(end)break;
    buffer+=value;
    let at:number;
    while((at=buffer.indexOf('\n\n'))>=0){
     const parsed=parseSpeechEvent(buffer.slice(0,at));buffer=buffer.slice(at+2);
     if(!parsed)continue;
     if(parsed.event==='chunk'){if(parsed.index!==expected){failed=true;break;}expected++;queue.push({audioBase64:parsed.audioBase64,mime:parsed.mime});}
     else if(parsed.event==='failed')failed=true;
     notify();
     if(failed)break;
    }
    if(failed)break;
   }
  }catch{failed=true;}
  finally{done=true;notify();}
 })();
 try{
  for(;;){
   if(stop.aborted)return;
   const next=queue.shift();
   if(next){await playSpeechChunk(next,stop);played++;continue;}
   if(done)break;
   await new Promise<void>(resolve=>{wake=resolve;stop.addEventListener('abort',()=>resolve(),{once:true});});
  }
  // Nothing could be spoken: the same failure the per-chunk player reports, so the controller can stop cleanly.
  if(played===0&&failed&&!stop.aborted)throw new Error('Voice playback unavailable');
 }finally{controller.abort();void reader.cancel().catch(()=>{});await read.catch(()=>{});}
}
