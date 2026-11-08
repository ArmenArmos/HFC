import {requirePracticeAccess} from '@/lib/zoe/practice/access';
import {PracticeRoom} from '@/components/zoe-practice/practice-room';
import '@/components/chat-v2/chat.css';
import '@/components/zoe-practice/practice.css';
export const dynamic='force-dynamic';
export const maxDuration=90;
export default async function ZoePracticePage(){
 await requirePracticeAccess();
 return <PracticeRoom/>;
}
