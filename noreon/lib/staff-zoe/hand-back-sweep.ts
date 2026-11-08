import 'server-only';
import {after} from 'next/server';
import {runConfiguredTelegramSweep} from '@/lib/telegram-runtime/server';
import type {EverydayResult} from './everyday-runtime';

export function afterHandBack(result:EverydayResult){
 if(result.kind==='saved'&&result.notice==='handed_back')after(async()=>{await runConfiguredTelegramSweep({withZoe:false}).catch(()=>null);});
}
