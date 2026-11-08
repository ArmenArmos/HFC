import {renderedStaffReply} from '@/components/staff/voice-reply';
/** Browser tests call the production DOM extractor, never a copy of its implementation. */
(window as unknown as {renderedStaffReply:typeof renderedStaffReply}).renderedStaffReply=renderedStaffReply;
