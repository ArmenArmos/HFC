/** Conversation sequencing is independent of browser IO so cancellation races can be exercised locally. */
export type ConversationPhase='off'|'listening'|'transcribing'|'review'|'paused'|'waiting'|'speaking'|'emergency'|'error';
export type ConversationTranscript={status:'ok';text:string;receipt?:string;urgent?:boolean};
export type CaptureCallbacks={barge:boolean;onSpeech:()=>void;onTurn:(audio:Blob,durationMs:number)=>void;onError:()=>void};
export type ConversationDependencies={
 capture:(callbacks:CaptureCallbacks)=>Promise<()=>void>;
 transcribe:(audio:Blob,durationMs:number,signal:AbortSignal)=>Promise<ConversationTranscript>;
 play:(text:string,signal:AbortSignal)=>Promise<void>;
 onTranscript:(result:ConversationTranscript)=>void;onSend:(urgent?:boolean)=>void;
 onState:(phase:ConversationPhase,seconds:number)=>void;emergencyText:()=>string;
 /** Staff transcripts use their ordinary text route, including urgent words. */
 memberEmergency?:boolean;autoSend?:(result:ConversationTranscript)=>boolean;
 setTimer?:(fn:()=>void,ms:number)=>unknown;clearTimer?:(id:unknown)=>void;
};
export class ConversationController {
 phase:ConversationPhase='off';active=false;
 private generation=0;private captureStop:(()=>void)|null=null;private request:AbortController|null=null;
 private idle:unknown;private countdown:unknown;private urgentHandled=false;
 private deps:ConversationDependencies;
 constructor(deps:ConversationDependencies){this.deps=deps;}
 private later(fn:()=>void,ms:number){return this.deps.setTimer?.(fn,ms)??setTimeout(fn,ms);}
 private clear(id:unknown){if(id===undefined)return;if(this.deps.clearTimer)this.deps.clearTimer(id);else clearTimeout(id as ReturnType<typeof setTimeout>);}
 private state(phase:ConversationPhase,seconds=0){this.phase=phase;this.deps.onState(phase,seconds);}
 private resetIdle(){this.clear(this.idle);this.idle=this.later(()=>this.stop(),60_000);}
 private cancelIO(){this.generation++;this.captureStop?.();this.captureStop=null;this.request?.abort();this.request=null;}
 private cancelCountdown(){this.clear(this.countdown);this.countdown=undefined;}
 async start(){this.stop();this.active=true;this.urgentHandled=false;this.resetIdle();await this.listen();}
 stop(){this.active=false;this.cancelCountdown();this.clear(this.idle);this.cancelIO();this.state('off');}
 hidden(){this.stop();}
 error(){this.fail();}
 private fail(){this.stop();this.state('error');}
 private async capture(barge:boolean){
  const generation=this.generation;
  try{
   const stop=await this.deps.capture({barge,onSpeech:()=>{
    if(!this.active||generation!==this.generation)return;
    this.resetIdle();
    if(this.phase==='speaking'){this.request?.abort();this.request=null;this.state('listening');}
   },onTurn:(audio,ms)=>{if(this.active&&generation===this.generation)void this.transcribe(audio,ms);},onError:()=>{if(this.active&&generation===this.generation)this.fail();}});
   if(!this.active||generation!==this.generation)stop();else this.captureStop=stop;
  }catch{if(this.active&&generation===this.generation)this.fail();}
 }
 private async listen(){if(!this.active)return;this.cancelIO();this.resetIdle();this.state('listening');await this.capture(false);}
 private async transcribe(audio:Blob,ms:number){
  this.cancelIO();this.state('transcribing');this.resetIdle();const generation=this.generation;
  const request=new AbortController();this.request=request;
  try{
   const result=await this.deps.transcribe(audio,ms,request.signal);
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   this.request=null;this.deps.onTranscript(result);
   if(result.urgent&&this.deps.memberEmergency!==false){this.deps.onSend(true);this.emergency();return;}
   if(this.deps.autoSend&&!this.deps.autoSend(result)){this.state('paused');return;}
   this.state('review',3);let remaining=3;
   const tick=()=>{if(!this.active||this.phase!=='review')return;remaining--;if(remaining===0){this.sent();this.deps.onSend();}else{this.state('review',remaining);this.countdown=this.later(tick,1000);}};
   this.countdown=this.later(tick,1000);
  }catch{if(this.active&&generation===this.generation&&!request.signal.aborted)this.fail();}
 }
 /** Editing keeps the receipt on the existing ephemeral draft, but requires an explicit send. */
 edit(){if(!this.active)return;this.cancelCountdown();this.cancelIO();this.state('paused');this.resetIdle();}
 sent(){if(!this.active)return;this.cancelCountdown();this.cancelIO();this.state('waiting');this.resetIdle();}
 reply(text:string){if(this.active&&this.phase==='waiting'){if(text.trim())void this.speak(text,false);else void this.listen();}}
 emergency(){if(!this.active||this.urgentHandled)return;this.urgentHandled=true;this.cancelCountdown();void this.speak(this.deps.emergencyText(),true);}
 private async speak(text:string,urgent:boolean){
  this.cancelIO();this.state(urgent?'emergency':'speaking');this.clear(this.idle);this.idle=undefined;const generation=this.generation;
  const request=new AbortController();this.request=request;
  // Echo cancellation plus a sustained voice threshold guards playback; only actual barge-in opens a recording.
  if(!urgent)void this.capture(true);
  try{
   await this.deps.play(text,request.signal);
   if(!this.active||generation!==this.generation||request.signal.aborted)return;
   if(urgent)this.stop();else await this.listen();
  }catch{if(this.active&&generation===this.generation&&!request.signal.aborted)this.fail();}
 }
}
