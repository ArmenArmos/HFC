/** Real doctor view and scroll hooks; synthetic reads, page state and menu actions. No auth, secrets or DB. */
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(resolve('package.json'));
const {webpack}=require('next/dist/compiled/webpack/webpack');
export async function startDoctorChatFixture(){
 const root=resolve('.'),directory=mkdtempSync(join(tmpdir(),'noreon-doctor-chat-v2-'));
 // The chat-v2-actions alias below includes readDoctorChatApprovals, keeping history reads synthetic too.
 const actions=join(root,'e2e/doctor-chat-v2/actions.ts');
 await new Promise((done,reject)=>webpack({
  mode:'development',devtool:false,context:root,entry:join(root,'e2e/doctor-chat-v2/entry.tsx'),output:{path:directory,filename:'chat.js'},
  resolve:{extensions:['.tsx','.ts','.js'],alias:{...Object.fromEntries(['@/lib/care-alerts/actions','@/lib/staff/chat-member-identity-actions','@/lib/ai-plan/actions','@/lib/patient-care/clinical-review-actions','@/lib/doctor-decisions/approval-actions','@/lib/first-note/actions','@/lib/staff/staff-locale-actions','@/lib/patient-care/clinical-actions','@/lib/staff-zoe/chat-v2-actions','@/lib/staff-zoe/home-actions','@/lib/gp-report/actions','@/lib/doctor-telegram/actions'].map(name=>[name+'$',actions])),'next/navigation$':join(root,'e2e/doctor-chat-v2/navigation.ts'),'@':root}},
  module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(root,'e2e/doctor-chat-v2/loader.cjs')}]},
 },(error,stats)=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):done()));
 const {PDFDocument}=require('pdf-lib');const pdf=await PDFDocument.create();
 for(let n=1;n<=3;n++)pdf.addPage().drawText(`Synthetic lab sheet, page ${n}`);
 const pdfBytes=Buffer.from(await pdf.save());
 const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss');
 const css=(await postcss([tailwind()]).process(readFileSync(join(root,'app/globals.css'),'utf8'),{from:join(root,'app/globals.css')})).css;
 const respond=async(address)=>{
  const url=new URL(address),result=(body,contentType='text/html')=>({status:200,body,contentType});
  if(/^\/staff\/real\/members\/[^/]+\/documents\/[^/]+$/.test(url.pathname))return result(pdfBytes,'application/pdf');
  if(/^\/staff\/real\/members\/[^/]+\/member-uploads\/[^/]+$/.test(url.pathname))return result(pdfBytes,'application/pdf');
  if(url.pathname==='/chat.js')return result(readFileSync(join(directory,'chat.js'),'utf8'),'text/javascript');
  if(url.pathname==='/chat.css')return result(css+'\n'+readFileSync(join(root,'components/chat-v2/chat.css'),'utf8')+'\n'+readFileSync(join(root,'components/doctor-chat-v2/doctor-chat.css'),'utf8'),'text/css');
  if(url.pathname==='/staff/real/login')return result('<p>Signed out</p>');
  if(url.pathname!=='/staff/real/doctor-chat-v2')return {status:404,body:''};
  const history=url.searchParams.has('history')?Array.from({length:100},(_,i)=>({id:`history-${i}`,kind:'reply',reply:{kind:'text',text:`Earlier reply ${i}`}})):[];
  const locale=['hy','ru'].includes(url.searchParams.get('locale'))?url.searchParams.get('locale'):'en';
  return result(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/chat.css"><style>*{box-sizing:border-box}html,body{margin:0}button,input{font:inherit}svg{flex:none}</style></head><body><div id="root"></div><script>window.process={env:{}};window.fixture=${JSON.stringify({history,locale,state:url.searchParams.get('state'),long:url.searchParams.has('long'),dayReads:0,pollReads:0,newAlert:false})}</script><script src="/chat.js"></script></body></html>`);
 };
 return {url:'http://127.0.0.1',respond,close:async()=>rmSync(directory,{recursive:true,force:true})};
}
