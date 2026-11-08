import assert from "node:assert/strict";
import { validatedStaffSession } from "@/lib/staff/real-session-binding";
const userId="22222222-2222-4222-8222-222222222222", sessionId="33333333-3333-4333-8333-333333333333";
const calls:string[]=[];
let denied=false, claims:Record<string,unknown>={sub:userId,session_id:sessionId};
const auth={
 async getSession(){return {data:{session:{access_token:"synthetic-local-access-token"}},error:null};},
 async getUser(token:string){calls.push(`user:${token}`);return {data:{user:{id:userId,email:"doctor@example.invalid",email_confirmed_at:"2026-10-13"}},error:denied?{status:403}:null};},
 async getClaims(token:string){calls.push(`claims:${token}`);return {data:{claims},error:null};},
} as unknown as Parameters<typeof validatedStaffSession>[0];
assert.equal((await validatedStaffSession(auth))?.sessionId,sessionId);
assert.deepEqual(calls,["user:synthetic-local-access-token","claims:synthetic-local-access-token"]);
claims={sub:sessionId,session_id:sessionId};assert.equal(await validatedStaffSession(auth),null);
claims={sub:userId,session_id:"bad"};assert.equal(await validatedStaffSession(auth),null);
claims={sub:userId};assert.equal(await validatedStaffSession(auth),null);
denied=true;claims={sub:userId,session_id:sessionId};assert.equal(await validatedStaffSession(auth),null);
console.log("Exact-token staff session validation and subject/session binding passed.");
