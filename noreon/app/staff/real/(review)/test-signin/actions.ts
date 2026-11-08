'use server';
import {revalidatePath} from 'next/cache';
import {unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {testSigninAdminRpc} from '@/lib/telegram-auth/test-signin-admin';
export type TestSigninActionState={message:string;code?:string};
const reply=z.object({ok:z.boolean(),code:z.string().optional(),testCode:z.string().regex(/^[0-9]{6}$/).optional()});
export const manageTestSignin=loggedAction('manageTestSignin',async function manageTestSignin(_previous:TestSigninActionState,form:FormData):Promise<TestSigninActionState>{
 const {client}=await requireRealAdmin();
 const action=form.get('action');
 try{
  let result:unknown;
  if(action==='add'){
   const input=z.object({phone:z.string().regex(/^\+999[0-9]{5,11}$/),label:z.string().trim().min(1).max(80),days:z.coerce.number().int().min(1).max(30)})
    .safeParse({phone:form.get('phone'),label:form.get('label'),days:form.get('days')});
   if(!input.success)return {message:'Enter a +999 number, a label and an expiry of 1 to 30 days.'};
   result=await testSigninAdminRpc(client,'test_signin_admin_add',{p_phone:input.data.phone,p_label:input.data.label,p_days:input.data.days});
  }else if(action==='remove'||action==='set_code'){
   const id=z.uuid().safeParse(form.get('id'));
   if(!id.success)return {message:'Reload the list and try again.'};
   result=await testSigninAdminRpc(client,action==='remove'?'test_signin_admin_remove':'test_signin_admin_set_code',
    {p_id:id.data});
  }else if(action==='switch'){
   const enabled=form.get('enabled');
   if(enabled!=='true'&&enabled!=='false')return {message:'Reload the switch state and try again.'};
   result=await testSigninAdminRpc(client,'test_signin_admin_switch',{p_enabled:enabled==='true'});
  }else return {message:'Choose an action from this page.'};
  const data=reply.parse(result);
  if(!data.ok)return {message:data.code==='already_exists'?'That number is already listed. Remove it before adding it again.':'This action is unavailable. Reload and check the switches and expiry.'};
  revalidatePath('/staff/real/test-signin');
  return data.testCode?{message:'Save this test code now. It is shown once and single-use; issue a new code before each sign-in. Request a code on the member sign-in screen, then enter this test code there.',code:data.testCode}:{message:action==='remove'?'Number removed.':'Database switch updated.'};
 }catch(error){unstable_rethrow(error);return {message:'Test sign-in settings are unavailable. Try again.'};}
});
