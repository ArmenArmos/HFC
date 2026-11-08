import {notFound,redirect} from 'next/navigation';

/** Any /clinic/real address that has no page. "uploads" is what the upload status page is called in the chat, so it goes there;
 * every other guess (reports, exports, settings) gets the clinic's own not-found page with a way back to the chat. */
export default async function ClinicUnknownPage({params}:{params:Promise<{missing:string[]}>}){
 const {missing}=await params;
 if(missing.length===1&&missing[0]==='uploads')redirect('/clinic/real/batches');
 notFound();
}
