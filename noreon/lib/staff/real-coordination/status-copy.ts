import {pick} from '@/lib/locale';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
import {taskStatuses,type CoordinationTask} from './schema';
const statusesHy: Record<CoordinationTask['status'], string> = { open: 'Բաց', 'awaiting-member': 'Սպասում է անդամին', 'awaiting-doctor': 'Սպասում է բժշկին', completed: 'Ավարտված', cancelled: 'Չեղարկված' };
const statusesRu: Record<CoordinationTask['status'],string> = {"open": "Открыта", "awaiting-member": "Ожидание участника", "awaiting-doctor": "Ожидание врача", "completed": "Завершена", "cancelled": "Отменена"};
export const taskStatusLabel = (l: StaffLocale, status: string) => pick(l,{en:taskStatuses,hy:statusesHy,ru:statusesRu})[status as CoordinationTask['status']];
