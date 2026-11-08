'use client';
import {useActionState,useState} from 'react';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Alert,AlertDescription,AlertTitle} from '@/components/ui/alert';
import type {TestSigninList} from '@/lib/telegram-auth/test-signin-admin';
import {manageTestSignin,type TestSigninActionState} from './actions';
export function TestSigninManager({data,envEnabled}:{data:TestSigninList;envEnabled:boolean}){
 const [state,action,pending]=useActionState(manageTestSignin,{message:''} as TestSigninActionState);
 const [hiddenCode,setHiddenCode]=useState<string|null>(null);
 return <div className="space-y-8">
  <Alert variant={envEnabled&&data.enabled?'warning':'info'}>
   <AlertTitle>Test sign-in is {envEnabled&&data.enabled?'on':'off'}</AlertTitle>
   <AlertDescription>Environment switch: {envEnabled?'on':'off'}. Database switch: {data.enabled?'on':'off'}. Both must be on. Before real members, turn both off and empty this list.</AlertDescription>
  </Alert>
  <form action={action}>
   <input type="hidden" name="action" value="switch"/><input type="hidden" name="enabled" value={String(!data.enabled)}/>
   <Button variant="outline" type="submit" disabled={pending}>Turn database switch {data.enabled?'off':'on'}</Button>
  </form>
  <section className="space-y-4" aria-labelledby="add-number"><h2 id="add-number" className="text-h2">Add a number</h2>
   <p className="text-body2 text-muted-foreground">Only reserved +999 numbers are accepted. The test code is shown once when you add a number or reset its code. It is single-use; issue a new code before each sign-in. Request a code on the member sign-in screen, then enter that test code.</p>
   <form action={action} className="grid gap-4 sm:grid-cols-2">
    <input type="hidden" name="action" value="add"/>
    <div className="space-y-2"><Label htmlFor="test-phone">Full phone number</Label><Input id="test-phone" name="phone" type="tel" autoComplete="off" placeholder="+999…" required disabled={pending}/></div>
    <div className="space-y-2"><Label htmlFor="test-label">Label</Label><Input id="test-label" name="label" maxLength={80} required disabled={pending}/></div>
    <div className="space-y-2"><Label htmlFor="test-days">Days until expiry</Label><Input id="test-days" name="days" type="number" min={1} max={30} defaultValue={7} required disabled={pending}/></div>
    <div className="self-end"><Button type="submit" disabled={pending}>{pending?'Saving…':'Add number'}</Button></div>
   </form>
  </section>
  {state.message&&<Alert role="status"><AlertDescription>{state.message}</AlertDescription></Alert>}
  {state.code&&state.code!==hiddenCode&&<Alert variant="warning" role="status">
   <AlertTitle>Test sign-in code: <span className="font-mono tabular-nums">{state.code}</span></AlertTitle>
   <AlertDescription>Shown once and single-use; issue a new code before each sign-in. <Button variant="outline" type="button" onClick={()=>setHiddenCode(state.code!)}>Hide code</Button></AlertDescription>
  </Alert>}
  <section className="space-y-4" aria-labelledby="listed-numbers"><h2 id="listed-numbers" className="text-h2">Allowed numbers</h2>
   {data.numbers.length===0?<p className="text-body2 text-muted-foreground">No numbers are allowed.</p>:<ul className="divide-y divide-border">
    {data.numbers.map(number=><li key={number.id} className="space-y-4 py-4">
     <div><h3 className="text-h3 break-words">{number.label}</h3><p className="text-body2 text-muted-foreground">Ending {number.last4} · {number.active?'Active':'Inactive'} · Expires {yerevanStamp(number.expiresAt,'en')+' Yerevan'}</p></div>
     <div className="flex flex-wrap gap-4">
      <form action={action}><input type="hidden" name="action" value="remove"/><input type="hidden" name="id" value={number.id}/><Button variant="destructive" type="submit" disabled={pending}>Remove number</Button></form>
      <form action={action}><input type="hidden" name="action" value="set_code"/><input type="hidden" name="id" value={number.id}/><Button variant="outline" type="submit" disabled={pending}>Reset test code</Button></form>
     </div>
    </li>)}
   </ul>}
  </section>
 </div>;
}
