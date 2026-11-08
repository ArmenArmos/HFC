"use client";
import {useEffect,useRef,useState} from 'react';
import {Mic,LoaderCircle} from 'lucide-react';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {useHydrated} from '@/components/patient/use-hydrated';
import {VOICE_MAX_BYTES,VOICE_MAX_MS,type VoiceResult} from '@/lib/zoe-chat-actions/voice-contract';
type Capture={released:boolean;cancelled:boolean;stream?:MediaStream;recorder?:MediaRecorder;context?:AudioContext;frame?:number;timer?:ReturnType<typeof setTimeout>;start:number;size:number;chunks:Blob[]};
const clean=(capture:Capture)=>{
  capture.stream?.getTracks().forEach(track=>track.stop());
  if(capture.frame)cancelAnimationFrame(capture.frame);
  clearTimeout(capture.timer);
  void capture.context?.close().catch(()=>{});
};
/** Permission is requested only inside the member's hold gesture. Release before permission resolves discards it. */
export function Microphone({locale:l,disabled,onTranscript,onBusy}:{locale:PatientLocale;disabled:boolean;onTranscript:(text:string,receipt?:string)=>void;onBusy:(busy:boolean)=>void}) {
  const hydrated=useHydrated();
  const [phase,setPhase]=useState<'idle'|'recording'|'transcribing'>('idle');
  const [cancelled,setCancelled]=useState(false),[level,setLevel]=useState(0),[error,setError]=useState(false);
  const capture=useRef<Capture|null>(null),upload=useRef<AbortController|null>(null),mounted=useRef(true),origin=useRef({x:0,y:0});
  const callbacks=useRef({onTranscript,onBusy});
  useEffect(()=>{callbacks.current={onTranscript,onBusy};});
  const finish=(cancel=false)=>{
    const current=capture.current;
    if(!current||current.released)return;
    current.released=true;current.cancelled ||= cancel;
    if(current.recorder?.state==='recording')current.recorder.stop();
    clean(current);
    if(!current.recorder||current.cancelled){capture.current=null;setPhase('idle');callbacks.current.onBusy(false);}
    setLevel(0);setCancelled(false);
  };
  useEffect(()=>{
    mounted.current=true;
    const leave=()=>{
      const current=capture.current;
      if(current){current.cancelled=true;current.released=true;if(current.recorder?.state==='recording')current.recorder.stop();clean(current);capture.current=null;}
      upload.current?.abort();
      if(mounted.current){setPhase('idle');setLevel(0);callbacks.current.onBusy(false);}
    };
    const visibility=()=>{if(document.hidden)leave();};
    window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visibility);
    return ()=>{mounted.current=false;leave();window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{if(disabled)finish(true);});
  if(!hydrated||typeof MediaRecorder==='undefined'||!navigator.mediaDevices?.getUserMedia)return null;
  // Safari records AAC in MP4. Opus/WebM is the fallback for browsers without MP4 recording.
  const mimeType=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  if(!mimeType)return null;
  const start=async()=>{
    if(disabled||capture.current||upload.current)return;
    const current:Capture={released:false,cancelled:false,start:0,size:0,chunks:[]};capture.current=current;
    setError(false);setPhase('recording');callbacks.current.onBusy(true);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});current.stream=stream;
      if(current.released||!mounted.current){clean(current);return;}
      const recorder=new MediaRecorder(stream,{mimeType});current.recorder=recorder;current.start=performance.now();
      recorder.ondataavailable=event=>{
        current.size+=event.data.size;
        if(current.size>VOICE_MAX_BYTES){current.cancelled=true;finish(true);if(mounted.current)setError(true);return;}
        current.chunks.push(event.data);
      };
      recorder.onerror=()=>{finish(true);if(mounted.current)setError(true);};
      recorder.onstop=async()=>{
        clean(current);
        if(current.cancelled||!mounted.current){
          if(capture.current===current){capture.current=null;if(mounted.current){setPhase('idle');callbacks.current.onBusy(false);}}
          return;
        }
        capture.current=null;
        const controller=new AbortController();upload.current=controller;setPhase('transcribing');
        const timer=setTimeout(()=>{if(mounted.current)setError(true);controller.abort();},20_000);
        try{
          const response=await fetch('/api/patient/zoe/voice',{method:'POST',body:new Blob(current.chunks,{type:recorder.mimeType||mimeType}),headers:{'Content-Type':recorder.mimeType||mimeType,'X-Voice-Locale':l,'X-Voice-Duration-Ms':String(Math.min(VOICE_MAX_MS,Math.max(1,Math.round(performance.now()-current.start))))},cache:'no-store',signal:controller.signal});
          const result:VoiceResult=await response.json();
          if(!mounted.current||controller.signal.aborted)return;
          if(result.status==='ok'&&typeof result.text==='string')callbacks.current.onTranscript(result.text,result.receipt);
          else setError(true);
        }catch{if(mounted.current&&!controller.signal.aborted)setError(true);}
        finally{clearTimeout(timer);upload.current=null;if(mounted.current){setPhase('idle');callbacks.current.onBusy(false);}}
      };
      recorder.start(250);current.timer=setTimeout(()=>finish(),VOICE_MAX_MS);
      // A level meter is optional on browsers without Web Audio; it never affects capture.
      try{
        const context=new AudioContext();current.context=context;
        const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(stream).connect(analyser);
        const data=new Uint8Array(analyser.fftSize);
        const meter=()=>{analyser.getByteTimeDomainData(data);setLevel(Math.min(1,Math.sqrt(data.reduce((sum,n)=>sum+(n-128)**2,0)/data.length)/32));current.frame=requestAnimationFrame(meter);};meter();
      }catch{}
    }catch{clean(current);if(capture.current===current){capture.current=null;if(mounted.current){setError(true);setPhase('idle');callbacks.current.onBusy(false);}}}
  };
  return <div className="cv2-voice">
    <button type="button" className="cv2-mic" disabled={disabled||phase==='transcribing'} data-recording={phase==='recording'||undefined} aria-label={phase==='recording'?tx(l,'Բաց թողեք՝ կարդալու համար','Release to review','Отпустите, чтобы проверить'):tx(l,'Պահեք՝ ձայնագրելու համար','Hold to record','Удерживайте для записи')}
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);origin.current={x:event.clientX,y:event.clientY};void start();}}
      onPointerMove={event=>{const current=capture.current;if(!current||current.released)return;if(origin.current.x-event.clientX>80||origin.current.y-event.clientY>80){current.cancelled=true;setCancelled(true);}}}
      onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}
      onKeyDown={event=>{if(event.key==='Escape'){finish(true);return;}if((event.key===' '||event.key==='Enter')&&!event.repeat){event.preventDefault();void start();}}}
      onKeyUp={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();finish();}}} onBlur={()=>finish(true)}>
      {phase==='transcribing'?<LoaderCircle size={22} aria-hidden/>:<Mic size={24} aria-hidden/>}
    </button>
    {phase==='recording'&&<div className="cv2-recording" role="status"><meter min={0} max={1} value={level} aria-label={tx(l,'Ձայնի մակարդակը','Microphone level','Уровень звука')}/><span>{cancelled?tx(l,'Ձայնագրությունը կչեղարկվի','Recording will be cancelled','Запись будет отменена'):tx(l,'Սահեցրեք ձախ՝ չեղարկելու համար','Slide left to cancel','Сдвиньте влево для отмены')}</span></div>}
    {phase==='transcribing'&&<p className="cv2-voice-status" role="status">{tx(l,'Ձայնագրությունը տեքստի է վերածվում…','Turning your recording into text…','Преобразуем запись в текст…')}</p>}
    {error&&<p className="cv2-voice-status" role="alert">{tx(l,'Ձայնագրությունը չհաջողվեց կարդալ։ Կարող եք գրել։','Your recording could not be read. You can type your message.','Не удалось распознать запись. Вы можете написать сообщение.')}</p>}
  </div>;
}
