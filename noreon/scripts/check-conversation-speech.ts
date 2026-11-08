/** Real browser playback with synthetic HTTP/audio: bounded chunks and cancellation, no provider IO. */
import assert from 'node:assert/strict';
import {playConversation} from '@/components/chat-v2/conversation-browser';
const requests:Array<{url:string;text:string}>=[];
let ended:(()=>void)|null=null;
Object.assign(globalThis,{window:new EventTarget(),Audio:class{
 onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 pause(){} removeAttribute(){} load(){}
 async play(){ended=()=>this.onended?.();queueMicrotask(()=>this.onended?.());}
},fetch:async(url:string,init:{body:string})=>{
 const {text}=JSON.parse(init.body);requests.push({url,text});
 return Response.json(text.length<=1200?{status:'ok',audioBase64:'YXVkaW8=',mime:'audio/wav'}:{status:'unavailable'},{status:text.length<=1200?200:400});
}});
const text=Array.from({length:80},(_,i)=>`Visible reply sentence ${i}.`).join(' ');
await playConversation(text,'en',new AbortController().signal,'/api/staff/zoe/speech');
assert.ok(requests.length>1,'Long replies must be spoken in bounded parts');
assert.ok(requests.every(r=>r.text.length<=1200&&r.url==='/api/staff/zoe/speech'));
assert.equal(requests.map(r=>r.text).join(' ').replace(/\s+/gu,' '),text);
requests.length=0;const controller=new AbortController();
Object.assign(globalThis,{fetch:async(url:string,init:{body:string})=>{requests.push({url,text:JSON.parse(init.body).text});controller.abort();return Response.json({status:'ok',audioBase64:'YXVkaW8=',mime:'audio/wav'});}});
await playConversation(text,'hy',controller.signal,'/api/staff/zoe/speech');assert.ok(requests.length<=2,'Cancellation prevents anything beyond the current chunk and its prefetch');
assert.equal(ended!==null,true);
console.log('Conversation speech: bounded complete reply, staff endpoint and cancellation passed');
