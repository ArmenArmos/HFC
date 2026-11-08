import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {readMemberFirstNote,type FirstNoteRpc} from './runtime';

/** Home: the doctor's approved first note, until a plan is active. Undefined or null shows nothing. */
export async function memberFirstNote(){
 return readMemberFirstNote(await createClient() as unknown as FirstNoteRpc);
}
