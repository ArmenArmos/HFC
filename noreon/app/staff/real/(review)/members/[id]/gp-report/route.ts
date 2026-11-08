import {withRouteLogging} from '@/lib/observability/with-logging';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {documentBlocks,footerText,reportId,type Lang} from '@/lib/gp-report/document';
import {readApprovedGpReport,readGpReport,type GpRpc} from '@/lib/gp-report/runtime';
import {loadFonts,renderPdf} from '@/lib/gp-report/render-pdf';
import {renderDocx} from '@/lib/gp-report/render-docx';

const query=z.object({format:z.enum(['pdf','docx']),lang:z.enum(['hy','en','both']).default('both'),version:z.coerce.number().int().positive().optional()});

/** Download of the GP report for the assigned doctor: the current draft, or a frozen
 * approved version. Download only; Noreon sends nothing to an external GP. */
export const GET=withRouteLogging(async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const q=query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!z.uuid().safeParse(id).success||!q.success)return new NextResponse(null,{status:404});
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return new NextResponse(null,{status:404});
 const rpc=client as unknown as GpRpc;
 let built;
 if(q.data.version){built=await readApprovedGpReport(rpc,id,q.data.version);}
 else{const state=await readGpReport(rpc,id);built=state.status==='ready'?{report:state.report,approval:null}:null;}
 if(!built)return new NextResponse(null,{status:404});
 const langs:Lang[]=q.data.lang==='both'?['hy','en']:[q.data.lang];
 const blocks=documentBlocks(built.report,built.approval,langs);
 const name=`${reportId(built.report,built.approval).replace('/','-')}${built.approval?'':'-draft'}-${langs.join('-')}`;
 const title=`Noreon GP report ${reportId(built.report,built.approval)}`;
 const body=q.data.format==='pdf'?await renderPdf(blocks,footerText(built.approval),await loadFonts(),title):renderDocx(blocks,footerText(built.approval),title);
 return new NextResponse(Buffer.from(body),{headers:{
  'Content-Type':q.data.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'Content-Disposition':`attachment; filename="${name}.${q.data.format}"`,
  'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 }});
});
