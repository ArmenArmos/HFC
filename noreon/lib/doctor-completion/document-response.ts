import 'server-only';
import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {PDFDocument} from 'pdf-lib';
import {clinicalWriteClient} from '@/lib/patient-care/clinical-publication-server';
type Target={bucket:string;objectKey:string;sha256:string;sizeBytes:number};
/** iOS Safari draws only the first page of a framed PDF, so the chat's sheet asks for one page at a time. */
async function onePage(bytes:Uint8Array<ArrayBuffer>,page:number):Promise<Uint8Array<ArrayBuffer>>{
 try{
  const source=await PDFDocument.load(bytes);if(page>source.getPageCount())return bytes;
  const single=await PDFDocument.create(),[copy]=await single.copyPages(source,[page-1]);single.addPage(copy);
  return new Uint8Array(await single.save());
 }catch{return bytes;}
}
/** Serves the bytes from the route, never a signed link, so every fetch is one
 * audited open (as for clinic originals, review CF-6). The stored hash and size
 * are checked before anything is sent. */
export async function documentResponse(target:Target,page?:number){
 const download=await clinicalWriteClient().storage.from(target.bucket).download(target.objectKey);
 if(download.error||!download.data)return new NextResponse('The document is unavailable.',{status:503});
 const bytes=Buffer.from(await download.data.arrayBuffer());
 if(bytes.length!==target.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==target.sha256)return new NextResponse('The document is unavailable.',{status:503});
 return new NextResponse(page?await onePage(bytes,page):bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="lab-result.pdf"','Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
