import {VOICE_MAX_BYTES,VOICE_MAX_MS} from '@/lib/zoe-chat-actions/voice-contract';
import type {PatientLocale} from '@/lib/patient/copy';
import type {CaptureCallbacks,ConversationTranscript} from './conversation-controller';

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
/** Prefer whole sentences around 160 characters; long sentences have a hard 200-character cap. */
export function splitConversationSpeech(text:string):string[]{
 const sentences:string[]=[];let start=0;
 for(const match of text.matchAll(/[.!?։;:\n]+["'»”’)]*/g)){
  const at=match.index;
  if(match[0]==='.'&&/\d/.test(text[at-1]??'')&&/\d/.test(text[at+1]??''))continue;
  sentences.push(text.slice(start,at+match[0].length).trim());start=at+match[0].length;
 }
 sentences.push(text.slice(start).trim());
 const chunks:string[]=[];let chunk='';
 const append=(part:string)=>{
  if(chunk&&chunk.length+1+part.length>160){chunks.push(chunk);chunk='';}
  chunk=chunk?`${chunk} ${part}`:part;
 };
 for(let sentence of sentences){
  while(sentence.length>200){
   const space=sentence.lastIndexOf(' ',200),end=space>0?space:200;
   append(sentence.slice(0,end));sentence=sentence.slice(end).trim();
  }
  if(sentence)append(sentence);
 }
 if(chunk)chunks.push(chunk);
 return chunks;
}
async function playSpeechChunk(result:{audioBase64:string;mime:string},signal:AbortSignal):Promise<void>{
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
