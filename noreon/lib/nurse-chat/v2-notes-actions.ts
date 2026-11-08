'use server';
import {readNurseMemberCard} from './member-card-actions';
import {nurseChatEnabled} from './config';
import {loggedAction} from '@/lib/observability/with-logging';

/** Uses the same assignment-scoped snapshot as the existing nurse notes card. */
export const readNurseChatNotes = loggedAction('readNurseChatNotes', async function readNurseChatNotes(memberId: string) {
 if (process.env.NOREON_NURSE_CHAT_V2 !== 'true' || !nurseChatEnabled()) return {kind:'off' as const};
 return readNurseMemberCard(memberId, 'notes');
});
