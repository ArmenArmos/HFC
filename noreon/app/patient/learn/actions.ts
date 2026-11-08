'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requirePatient} from '@/lib/patient/auth';
import {dismissLessonOffer,setLessonDone} from '@/lib/lessons/server';

/** Mark a lesson done or not done. Only lessons this deployment shows can be marked. */
export const markLessonDone=loggedAction('markLessonDone',async function markLessonDone(lessonId:string,done:boolean){
 await requirePatient();
 if(typeof lessonId!=='string'||typeof done!=='boolean')return {ok:false};
 const ok=await setLessonDone(lessonId,done).catch(()=>false);
 if(ok){revalidatePath('/patient/learn');revalidatePath(`/patient/learn/${lessonId}`);}
 return {ok};
});

/** "Not now" on Zoe's lesson offer for today. No other offer comes the same day. */
export const dismissZoeLessonOffer=loggedAction('dismissZoeLessonOffer',async function dismissZoeLessonOffer(){
 await requirePatient();
 return {ok:await dismissLessonOffer().catch(()=>false)};
});
