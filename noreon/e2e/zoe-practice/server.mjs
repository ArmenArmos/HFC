/** No HTTP listener or credentials: Playwright routes the view to the actual in-memory pipeline. */
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {startPractice,runPracticeTurn,editPracticeRecord} from '../../lib/zoe/practice/engine.ts';
import {createFakeProvider} from '../../lib/zoe/provider.ts';
import {createFakeJudge} from '../../lib/zoe/reply-check.ts';
const require=createRequire(resolve('package.json'));
const {webpack}=require('next/dist/compiled/webpack/webpack');
export async function startPracticeFixture(){
 const directory=mkdtempSync(join(tmpdir(),'noreon-practice-')),root=resolve('.');
 await new Promise((done,reject)=>webpack({mode:'development',devtool:false,context:root,entry:join(root,'e2e/zoe-practice/entry.tsx'),output:{path:directory,filename:'practice.js'},resolve:{extensions:['.tsx','.ts','.js'],alias:{'@/app/staff/real/zoe-practice/actions$':join(root,'e2e/zoe-practice/actions.ts'),'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:join(root,'e2e/chat-v2/loader.cjs')}]}
 },(error,stats)=>error?reject(error):stats.hasErrors()?reject(Error(stats.toString({all:false,errors:true}))):done()));
 let session=null,failed=false,limit=false,loseSend=false;const jobs=[],marks=[];
 const provider=createFakeProvider();
 const deps={provider,judge:createFakeJudge(),env:{NOREON_ZOE_URGENT_PLACEHOLDER:'true',NOREON_ZOE_MEMBER_CLEAR:'true',NOREON_ZOE_TEST_LEXICON:'false'}};
 const result=(body,contentType='application/json')=>({status:200,body:typeof body==='string'?body:JSON.stringify(body),contentType});
 const respond=async(address,method='GET',body='')=>{
  const url=new URL(address);
  if(url.pathname==='/practice.js')return result(readFileSync(join(directory,'practice.js'),'utf8'),'text/javascript');
  if(url.pathname==='/practice.css')return result(readFileSync(join(root,'components/chat-v2/chat.css'),'utf8')+'\n'+readFileSync(join(root,'components/zoe-practice/practice.css'),'utf8'),'text/css');
  if(url.pathname==='/staff/real/zoe-practice'){
   session=null;failed=false;limit=false;jobs.length=0;marks.length=0;
   return result('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/practice.css"><style>*{box-sizing:border-box}html,body{margin:0}button,input{font:inherit}button{border:0}</style></head><body><div id="root"></div><script src="/practice.js"></script></body></html>','text/html');
  }
  if(method==='POST'&&url.pathname.startsWith('/fixture/')){
   const input=JSON.parse(body);
   if(url.pathname==='/fixture/start')session={id:crypto.randomUUID(),version:0,state:startPractice(input.patientId)};
   if(url.pathname==='/fixture/send'){
    if(input.expectedVersion!==session.version)return result({ok:false,code:'conflict',session});
    if(limit)return result({ok:false,code:'doctor_daily_limit'});
    session={...session,version:session.version+1,state:await runPracticeTurn(session.state,input.text,deps)};jobs.push(session.state.turns.at(-1).job);if(loseSend){loseSend=false;return result({ok:false,code:'unavailable'});}
   }
   if(url.pathname==='/fixture/edit')session={...session,version:session.version+1,state:editPracticeRecord(session.state,input.edit)};
   if(url.pathname==='/fixture/reset')session={id:crypto.randomUUID(),version:0,state:startPractice(session.state.patientId)};
   if(url.pathname==='/fixture/mark'){
    if(failed){failed=false;return result({ok:false,code:'unavailable'});}
    marks.push(input);return result({ok:true,mark:{...input,id:crypto.randomUUID(),turn_id:input.turnId}});
   }
   return result({ok:true,session});
  }
  return {status:404,body:''};
 };
 return {url:'http://127.0.0.1',respond,jobs,marks,failNextMark(){failed=true;},reachLimit(){limit=true;},loseNextSendResponse(){loseSend=true;},close:async()=>rmSync(directory,{recursive:true,force:true})};
}
