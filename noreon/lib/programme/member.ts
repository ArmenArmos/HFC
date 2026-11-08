import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {readMemberTimeline,type ProgrammeRpc} from './runtime';
import {journeyStages,type StageInput} from './stages';

/** Real members only. Null when the programme is off or unreadable: pages keep their existing view.
 * The page's own inputs are read only when the programme is on. */
export async function memberProgramme(inputs:()=>Promise<Omit<StageInput,'programme'>>){
 const timeline=await readMemberTimeline(await createClient() as unknown as ProgrammeRpc);
 if(!timeline?.enabled)return null;
 return {schedulePending:timeline.schedulePending,stages:journeyStages({...await inputs(),programme:timeline})};
}
