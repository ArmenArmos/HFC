import {inflateSync} from 'node:zlib';

/**
 * Cheap, bounded checks on a clinic PDF before any model sees it. This is not a parser: the bytes
 * go to the model as a document, never to a PDF library here (the parked qpdf work and its OP1-OP15
 * findings stay parked). What this bounds is what we send and pay for: size, type, encryption and
 * page count, failing closed when unsure.
 *  - Size: at most 4 MB (pilot limit, lead decision 16 Oct).
 *  - Type: the bytes start with a PDF header and end with an end-of-file marker.
 *  - Encryption: only the standard security handler is accepted (lab exports often carry permissions-only
 *    encryption that opens without a password; lead decision 17 Oct, Fable F4). Names and numbers are not
 *    encrypted, so pages are still counted in the plain bytes; an encrypted file with object streams fails
 *    closed (their content cannot be counted). Any other handler is rejected.
 *  - Pages: at most 10. Page objects are counted in the plain bytes and inside compressed object
 *    streams, each inflated with a hard output cap and a total budget; the larger of that count and
 *    the page tree's own /Count is used, so a file cannot understate its pages.
 */
export const LAB_PDF_MAX_BYTES=4*1024*1024;
export const LAB_PDF_MAX_PAGES=10;
const STREAM_CAP=4*1024*1024,TOTAL_INFLATE_BUDGET=16*1024*1024,MAX_OBJECT_STREAMS=64;

export type PdfRejection='file_too_large'|'empty_file'|'not_pdf'|'malformed'|'encrypted'|'too_many_pages';
export type PdfInspection={ok:true;pageCount:number}|{ok:false;reason:PdfRejection};

const PAGE=/\/Type\s*\/Page(?![A-Za-z0-9])/g;
const count=(text:string,re:RegExp)=>{re.lastIndex=0;let n=0;while(re.exec(text))n++;return n;};
/** 'none', the standard security handler, or anything else (another handler or an unreadable dictionary). */
function encryption(text:string):'none'|'standard'|'other'{
 const refs=[...text.matchAll(/\/Encrypt(?![A-Za-z0-9])\s*(?:(\d+)\s+(\d+)\s+R|<<)/g)];
 if(!/\/Encrypt(?![A-Za-z0-9])/.test(text))return 'none';
 if(!refs.length)return 'other';
 for(const m of refs){
  let dict:string;
  if(m[1]){const at=text.search(new RegExp(`(^|[^0-9])${m[1]}\\s+${m[2]}\\s+obj\\b`));if(at<0)return 'other';dict=text.slice(at,text.indexOf('endobj',at)>0?text.indexOf('endobj',at):at+2000);}
  else dict=text.slice(m.index,m.index+2000);
  if(!/\/Filter\s*\/Standard\b/.test(dict))return 'other';
 }
 return 'standard';
}
/** #xx-escaped names decoded in place; the name is right-aligned with spaces so byte offsets do not move. */
const decodeNames=(t:string)=>t.replace(/\/[^\s/<>\[\]()%{}]*#[0-9A-Fa-f]{2}[^\s/<>\[\]()%{}]*/g,n=>{const d=n.replace(/#([0-9A-Fa-f]{2})/g,(_,h:string)=>String.fromCharCode(parseInt(h,16)));return ' '.repeat(n.length-d.length)+d;});
/** Leaf references under the page tree: every reference in a /Kids array, minus the intermediate nodes. */
function kidsCount(text:string){
 let refs=0,nodes=0;
 // Comments may sit between the numbers of a reference; an empty array is not a node (Fable R3).
 for(const m of text.matchAll(/\/Kids\s*\[([^\]]{0,200000})\]/g)){const n=(m[1]!.replace(/%[^\r\n]*/g,' ').match(/\d+\s+\d+\s+R/g)??[]).length;if(n){nodes++;refs+=n;}}
 return Math.max(0,refs-Math.max(0,nodes-1));
}
/** The largest /Count near any /Type /Pages: a window around each match, linear in the input. */
function maxCount(text:string){
 let max=0;
 for(const m of text.matchAll(/\/Type\s*\/Pages\b/g)){
  const open=text.lastIndexOf('<<',m.index),close=text.indexOf('>>',m.index);
  const from=open>=0&&m.index-open<=2000?open:Math.max(0,m.index-2000),to=close>=0&&close-m.index<=2000?close:m.index+2000;
  for(const c of text.slice(from,to).matchAll(/\/Count\s+(\d{1,7})/g))max=Math.max(max,Number(c[1]));
 }
 return max;
}

/**
 * A comment between a page-structure key and its value ("/Type %x\n/Page", "/Count %x\n100", "/Kids %x\n[...]")
 * can hide pages from the scans, and blanking comments is not safe either: a "%" inside a string is not a
 * comment (Astra A3-5, R2). Real lab exports never write a comment there, so such a file is refused.
 */
const HIDDEN=/\/(?:Type|Count|Kids|Pages|Page|Parent)\s*%/;
function scan(text:string){
 return {hidden:HIDDEN.test(text),pages:count(text,PAGE),declared:maxCount(text),kids:kidsCount(text)};
}

export function inspectPdf(bytes:Uint8Array):PdfInspection{
 if(bytes.byteLength===0)return {ok:false,reason:'empty_file'};
 if(bytes.byteLength>LAB_PDF_MAX_BYTES)return {ok:false,reason:'file_too_large'};
 const buf=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(!/^%PDF-[12]\.\d/.test(buf.subarray(0,8).toString('latin1')))return {ok:false,reason:'not_pdf'};
 if(!buf.subarray(Math.max(0,buf.length-2048)).toString('latin1').includes('%%EOF'))return {ok:false,reason:'malformed'};
 // Names may be written with #xx escapes (/Pa#67e is /Page): decode them before any scan (Fable F1).
 const text=decodeNames(buf.toString('latin1'));
 const enc=encryption(text);
 if(enc==='other')return {ok:false,reason:'encrypted'};
 if(enc==='standard'&&text.includes('/ObjStm'))return {ok:false,reason:'malformed'};
 const top=scan(text);
 if(top.hidden)return {ok:false,reason:'malformed'};
 let pages=top.pages,declared=top.declared,kids=top.kids,budget=TOTAL_INFLATE_BUDGET,streams=0;
 // Object streams: find each /ObjStm, its dictionary (within 2000 bytes) and the stream after it.
 for(let at=text.indexOf('/ObjStm');at>=0;at=text.indexOf('/ObjStm',at+7)){
  if(++streams>MAX_OBJECT_STREAMS)return {ok:false,reason:'malformed'};
  const open=text.lastIndexOf('<<',at),kw=text.indexOf('stream',at);
  if(open<0||at-open>2000||kw<0||kw-at>2000)return {ok:false,reason:'malformed'};
  const dict=text.slice(open,kw);
  let start=kw+6;if(text[start]==='\r')start++;if(text[start]==='\n')start++;
  const end=text.indexOf('endstream',start);
  if(end<0)return {ok:false,reason:'malformed'};
  if(!/\/Filter\s*\/FlateDecode\b/.test(dict)||/\/DecodeParms/.test(dict)){
   // A stream we will not decode could hold page objects; only a plain one is read as is.
   if(/\/Filter/.test(dict))return {ok:false,reason:'malformed'};
   const inner=scan(text.slice(start,end));if(inner.hidden)return {ok:false,reason:'malformed'};pages+=inner.pages;declared=Math.max(declared,inner.declared);kids+=inner.kids;continue;
  }
  if(budget<=0)return {ok:false,reason:'malformed'};
  let out:Buffer;
  // A stream that will not inflate within its cap could hide pages: fail closed.
  try{out=inflateSync(buf.subarray(start,end),{maxOutputLength:Math.min(STREAM_CAP,budget)});}
  catch{return {ok:false,reason:'malformed'};}
  budget-=out.length;
  const innerText=decodeNames(out.toString('latin1')),inner=scan(innerText);
  if(inner.hidden)return {ok:false,reason:'malformed'};
  pages+=inner.pages;declared=Math.max(declared,inner.declared);kids+=inner.kids;
  if(/\/Encrypt(?![A-Za-z0-9])/.test(innerText))return {ok:false,reason:'encrypted'};
 }
 // Three lower bounds: page objects, the tree's /Count and the references in /Kids (pages without
 // /Type are still drawn by lenient readers). The largest wins.
 const tree=Math.max(declared,kids);
 if(Math.max(pages,tree)===0)return {ok:false,reason:'malformed'};
 if(tree>LAB_PDF_MAX_PAGES)return {ok:false,reason:'too_many_pages'};
 // More page objects than the tree holds: an incremental save rewrote pages, or something is hidden.
 // Not "too many pages" to the doctor, but not read either (Fable F7).
 if(pages>LAB_PDF_MAX_PAGES)return {ok:false,reason:tree>0&&pages>tree?'malformed':'too_many_pages'};
 return {ok:true,pageCount:Math.max(pages,tree)};
}
