import type {ConversationPhase,ConversationTranscript} from './conversation-controller';

/**
 * The hands-free conversation over a Gemini Live session (WP V), independent of browser IO so races can be exercised
 * locally, in the style of ConversationController. Live is only a streaming transcription and turn-detection transport:
 * partial transcripts are shown as they arrive, and at the end of each turn the final transcript takes the same path as a
 * recorded turn (emergency screening first: urgent text sends at once and the urgent text is spoken; otherwise the 3 s
 * review countdown and the auto-send rules). Zoe's words are never Live audio: replies come from the guarded text
 * pipeline and are spoken by the existing speech synthesis (play). Barge-in: when the session reports that the person
 * started speaking while Zoe is speaking, playback stops at once. Any connection failure calls fallback() and goes
 * quiet, so the caller can continue with the recorded (batch) controller without telling the person anything.
 */
export type LivePhase=ConversationPhase|'connecting';
export type LiveTranscript=ConversationTranscript&{origin:'live'};
export type LiveSessionCallbacks={
 /** The person started speaking (server activity start, an interruption, or a first transcript chunk), after the local level guard. */
 onSpeechStart:()=>void;
 /** The transcript of the current turn so far. */
 onPartial:(text:string)=>void;
 /** The turn ended; the final transcript of the turn. */
 onTurnEnd:(text:string)=>void;
 onError:()=>void;
 /** The session closed without being asked to (time limit, network, server). */
 onClose:()=>void;
};
export type LiveConnection={close:()=>void};
export type LiveDependencies={
 connect:(callbacks:LiveSessionCallbacks,signal:AbortSignal)=>Promise<LiveConnection>;
 /** The chat's deterministic emergency screening of a final transcript (member). Staff resolve {urgent:false}. */
 screen:(text:string,signal:AbortSignal)=>Promise<{urgent:boolean}>;
 play:(text:string,signal:AbortSignal)=>Promise<void>;
 onPartial:(text:string)=>void;
 onTranscript:(result:LiveTranscript)=>void;onSend:(urgent?:boolean)=>void;
 onState:(phase:LivePhase,seconds:number)=>void;emergencyText:()=>string;
 /** Live failed: the caller switches to the recorded controller. Called at most once per start. */
 fallback:()=>void;
 memberEmergency?:boolean;autoSend?:(result:LiveTranscript)=>boolean;
 setTimer?:(fn:()=>void,ms:number)=>unknown;clearTimer?:(id:unknown)=>void;
};
export const LIVE_IDLE_MS=60_000;

export class LiveController{
 phase:LivePhase='off';active=false;
 private generation=0;private connection:LiveConnection|null=null;private connecting:AbortController|null=null;
 private request:AbortController|null=null;private idle:unknown;private countdown:unknown;private urgentHandled=false;private fellBack=false;
 private deps:LiveDependencies;
 constructor(deps:LiveDependencies){this.deps=deps;}
 private later(fn:()=>void,ms:number){return this.deps.setTimer?.(fn,ms)??setTimeout(fn,ms);}
 private clear(id:unknown){if(id===undefined)return;if(this.deps.clearTimer)this.deps.clearTimer(id);else clearTimeout(id as ReturnType<typeof setTimeout>);}
 private state(phase:LivePhase,seconds=0){this.phase=phase;this.deps.onState(phase,seconds);}
 private resetIdle(){this.clear(this.idle);this.idle=this.later(()=>this.stop(),LIVE_IDLE_MS);}
 private cancelCountdown(){this.clear(this.countdown);this.countdown=undefined;}
 private abortRequest(){this.request?.abort();this.request=null;}
 private close(){this.generation++;this.connecting?.abort();this.connecting=null;const c=this.connection;this.connection=null;c?.close();this.abortRequest();}

 async start(){
  this.stop();this.active=true;this.urgentHandled=false;this.fellBack=false;this.state('connecting');this.resetIdle();
  const generation=this.generation,abort=new AbortController();this.connecting=abort;
  const current=()=>this.active&&generation===this.generation;
  try{
   const connection=await this.deps.connect({
    onSpeechStart:()=>{if(current())this.speechStart();},
    onPartial:text=>{if(current())this.partial(text);},
    onTurnEnd:text=>{if(current())void this.turnEnd(text);},
    onError:()=>{if(current())this.failOver();},
    onClose:()=>{if(current())this.failOver();},
   },abort.signal);
   if(!current()||abort.signal.aborted){connection.close();return;}
   this.connecting=null;this.connection=connection;this.state('listening');
  }catch{if(current())this.failOver();}
 }
 stop(){this.active=false;this.cancelCountdown();this.clear(this.idle);this.idle=undefined;this.close();this.state('off');}
 hidden(){this.stop();}
 error(){this.stop();this.state('error');}
 /** Live could not serve this conversation: go quiet and let the caller continue with the recorded controller. */
 private failOver(){
  const first=!this.fellBack;this.fellBack=true;
  this.stop();
  if(first)this.deps.fallback();
 }

 private speechStart(){
  this.resetIdle();
  // Barge-in: the person speaks over Zoe. Stop playback at once and listen to them.
  if(this.phase==='speaking'){this.abortRequest();this.state('listening');}
 }
 private partial(text:string){
  if(this.phase!=='listening')return;
  this.resetIdle();this.deps.onPartial(text);
 }
 private async turnEnd(raw:string){
  // A turn heard while Zoe speaks without a barge-in is her own voice through the speaker: never a member turn.
  if(this.phase!=='listening')return;
  const text=raw.trim();
  if(!text)return;
  this.state('transcribing');this.resetIdle();
  const generation=this.generation,request=new AbortController();this.request=request;
  try{
   const {urgent}=await this.deps.screen(text,request.signal);
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   this.request=null;
   const result:LiveTranscript={status:'ok',text,urgent,origin:'live'};
   this.deps.onTranscript(result);
   if(urgent&&this.deps.memberEmergency!==false){this.deps.onSend(true);this.emergency();return;}
   if(this.deps.autoSend&&!this.deps.autoSend(result)){this.state('paused');return;}
   this.state('review',3);let remaining=3;
   const tick=()=>{if(!this.active||this.phase!=='review')return;remaining--;if(remaining===0){this.sent();this.deps.onSend();}else{this.state('review',remaining);this.countdown=this.later(tick,1000);}};
   this.countdown=this.later(tick,1000);
  }catch{
   // Screening could not answer: never auto-send an unscreened turn. The text waits in the composer for an explicit send.
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   this.request=null;
   this.deps.onTranscript({status:'ok',text,origin:'live'});
   this.state('paused');
  }
 }
 /** Editing cancels the countdown and requires an explicit send. */
 edit(){if(!this.active)return;this.cancelCountdown();this.abortRequest();this.state('paused');this.resetIdle();}
 sent(){if(!this.active)return;this.cancelCountdown();this.abortRequest();this.state('waiting');this.resetIdle();}
 reply(text:string){if(this.active&&this.phase==='waiting'){if(text.trim())void this.speak(text,false);else{this.state('listening');this.resetIdle();}}}
 emergency(){if(!this.active||this.urgentHandled)return;this.urgentHandled=true;this.cancelCountdown();void this.speak(this.deps.emergencyText(),true);}
 private async speak(text:string,urgent:boolean){
  this.abortRequest();this.state(urgent?'emergency':'speaking');this.clear(this.idle);this.idle=undefined;
  const generation=this.generation,request=new AbortController();this.request=request;
  try{
   await this.deps.play(text,request.signal);
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   this.request=null;
   if(urgent)this.stop();else{this.state('listening');this.resetIdle();}
  }catch{if(this.active&&generation===this.generation&&!request.signal.aborted)this.error();}
 }
}
