import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {createClient} from '@/lib/supabase/server';
import {realReviewEnabled} from './real-review-config';
import {currentPublishedReviewSchema} from './published-review';
/** Bounded owner read; historical review content is fetched only on its explicit page. */
export async function currentPatientPublishedReview(client?:SupabaseClient<Database>){
 if(!realReviewEnabled(process.env))return null;
 const response=await (client??await createClient()).rpc('patient_current_published_clinical_review');
 if(response.error)throw new Error('Published care details are unavailable. Please try again.');
 return currentPublishedReviewSchema.parse(response.data);
}
