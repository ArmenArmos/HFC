import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {readOwnLabResults} from '@/lib/member-history/ai-server';
import {readAllPages} from '@/lib/patient-care/pagination';
import {yerevanToday} from '@/lib/member-history/measures';
import {freshTestEvidence,suggestedTests} from './fresh-tests';

/** Member session only. RLS scopes both sources; never use the last forty chat cards as evidence.
 * Missing approved results keep the full set; an unreadable receipt history stops booking. */
export async function readMemberSuggestedTests<T extends {id:string;title:string;method:string}>(tests:readonly T[]):Promise<T[]>{
 const results=await readOwnLabResults();
 if(!results?.documents.some(d=>d.state==='approved'))return [...tests];
 const client=await createClient();
 const receipts=await readAllPages((from,to)=>client.from('zoe_chat_cards').select('snapshot,outcome').eq('kind','document').eq('state','done').order('updated_at',{ascending:false}).order('id',{ascending:false}).range(from,to));
 return suggestedTests(tests,freshTestEvidence(tests,results,receipts),yerevanToday(new Date()));
}
