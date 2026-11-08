'use client';
import {StaffVoiceBar} from './staff-voice-bar';
import type {Locale} from '@/lib/locale';

/**
 * WP V: the care coordinator's voice on the care queue. Logistics only: words open the care queue, the consultations to
 * arrange or the task list; nothing clinical, nothing written, and never a member by name.
 */
const PLACES={open_worklist:'/staff/real/care-queue',open_operations:'/staff/real/consultations'}as const;
export function CoordinatorVoice({locale,available,live}:{locale:Locale;available:boolean;live:boolean}){
 return <StaffVoiceBar locale={locale} role="care_coordinator" available={available} live={live} onIntent={action=>{
  const href=action.kind in PLACES?PLACES[action.kind as keyof typeof PLACES]:null;
  if(!href)return false;
  window.location.assign(href);
  return true;
 }}/>;
}
