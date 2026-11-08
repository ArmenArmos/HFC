"use client";
import {createContext,useContext,useEffect,useId,useState,type ReactNode} from 'react';
import {Volume2,Square} from 'lucide-react';
import {tx,type PatientLocale} from '@/lib/patient/copy';
type Playback={locale:PatientLocale;voices:SpeechSynthesisVoice[];active:string|null;play:(id:string,text:string,voice:SpeechSynthesisVoice)=>void};
const PlaybackContext=createContext<Playback|null>(null);
/** One screen owns playback. Local voices only: browser cloud voices could send member text away. */
export function VoicePlayback({enabled,children,locale='hy'}:{enabled:boolean;children?:ReactNode;locale?:PatientLocale}) {
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [active,setActive]=useState<string|null>(null);
  useEffect(()=>{
    if(!enabled||!('speechSynthesis'in window))return;
    const synth=window.speechSynthesis;
    const update=()=>setVoices(synth.getVoices().filter(v=>v.localService));
    const stop=()=>{synth.cancel();setActive(null);};
    const visibility=()=>{if(document.hidden)stop();};
    update();synth.addEventListener('voiceschanged',update);window.addEventListener('pagehide',stop);window.addEventListener('cv2-conversation-playback',stop);document.addEventListener('visibilitychange',visibility);
    return ()=>{synth.cancel();synth.removeEventListener('voiceschanged',update);window.removeEventListener('pagehide',stop);window.removeEventListener('cv2-conversation-playback',stop);document.removeEventListener('visibilitychange',visibility);};
  },[enabled]);
  const play:Playback['play']=(id,text,voice)=>{
    window.dispatchEvent(new Event('cv2-local-playback'));
    window.speechSynthesis.cancel();setActive(null);
    if(active===id)return;
    if(!text.trim())return;
    const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang=voice.lang;
    utterance.onend=utterance.onerror=()=>setActive(current=>current===id?null:current);
    setActive(id);window.speechSynthesis.speak(utterance);
  };
  return <PlaybackContext value={enabled?{voices,active,play,locale}:null}>{children}</PlaybackContext>;
}
export function Speaker({text,locale}:{text:string|(()=>string);locale?:PatientLocale}) {
  const playback=useContext(PlaybackContext),id=useId();
  const l=locale??playback?.locale??'hy';
  const language=typeof text==='function'?l:/[\u0530-\u058f]/u.test(text)?'hy':/[\u0400-\u04ff]/u.test(text)?'ru':/[a-z]/iu.test(text)?'en':l;
  const voice=playback?.voices.find(v=>v.lang.toLowerCase().split(/[-_]/)[0]===language);
  if(!playback||!voice)return null;
  const playing=playback.active===id;
  return <button type="button" className="cv2-speaker" aria-pressed={playing} aria-label={playing?tx(l,'Դադարեցնել լսելը','Stop listening','Остановить воспроизведение'):tx(l,'Լսել այս հաղորդագրությունը','Listen to this message','Прослушать сообщение')} onClick={()=>playback.play(id,typeof text==='function'?text():text,voice)}>{playing?<Square size={16} aria-hidden/>:<Volume2 size={18} aria-hidden/>}</button>;
}
