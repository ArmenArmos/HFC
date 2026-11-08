type Env = Record<string,string|undefined>;
/** Real staff and members must resolve identities in the same Supabase project. */
export function realReviewEnabled(env:Env):boolean {
 if(env.NOREON_REAL_MEMBER_REVIEW_ENABLED!=='true'||env.NOREON_SHARED_DEMO==='true')return false;
 const primary=env.NEXT_PUBLIC_SUPABASE_URL;
 if(!primary||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)return false;
 try {
  const origin=new URL(primary).origin;
  return !env.NOREON_WORKSPACE_SUPABASE_URL||new URL(env.NOREON_WORKSPACE_SUPABASE_URL).origin===origin;
 }catch{return false;}
}
