'use server';
import {startSession,sendMessage,replaceRecord,markReply} from '@/lib/zoe/practice/server';
import {loggedAction} from '@/lib/observability/with-logging';
export const startPracticeSession=loggedAction('startPracticeSession',async(input:unknown)=>startSession(input));
export const sendPracticeMessage=loggedAction('sendPracticeMessage',async(input:unknown)=>sendMessage(input));
export const changePracticeRecord=loggedAction('changePracticeRecord',async(input:unknown)=>replaceRecord(input));
export const resetPracticeSession=loggedAction('resetPracticeSession',async(input:unknown)=>replaceRecord(input,true));
export const markPracticeReply=loggedAction('markPracticeReply',async(input:unknown)=>markReply(input));
