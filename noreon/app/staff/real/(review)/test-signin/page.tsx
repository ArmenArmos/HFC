import {unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {testSigninAdminRpc,testSigninListSchema} from '@/lib/telegram-auth/test-signin-admin';
import {TestSigninManager} from './manager';
export const dynamic='force-dynamic';
export default async function TestSigninPage(){
 const {client}=await requireRealAdmin();
 let data=null;
 try{data=testSigninListSchema.parse(await testSigninAdminRpc(client,'test_signin_admin_list'));}catch(error){unstable_rethrow(error);}
 return <div className="mx-auto max-w-3xl space-y-8">
  <header className="space-y-2"><h1 className="text-h1">Test-account sign-in</h1><p className="text-body2 text-muted-foreground">Manage temporary sign-in access for reserved numbers.</p></header>
  {data?<TestSigninManager data={data} envEnabled={process.env.NOREON_TEST_SIGNIN_ENABLED==='true'}/>:<p role="status">Test sign-in settings are unavailable. Reload to try again.</p>}
 </div>;
}
