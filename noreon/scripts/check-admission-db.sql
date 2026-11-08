begin;
do $$
declare i integer; s text := repeat('a',64); other text := repeat('b',64); pair text := repeat('c',64);
begin
 if to_regprocedure('public.claim_workspace_admission(text,text,text)') is null then
   raise exception 'Missing atomic admission control: unlimited creation/upload and source-independent login protection absent';
 end if;
 for i in 1..20 loop
   if public.claim_workspace_admission('case',s,null) <> 0 then raise exception 'Case admission rejected before 20'; end if;
 end loop;
 if public.claim_workspace_admission('case',s,null) <= 0 then raise exception '21st case admitted'; end if;
 if public.claim_workspace_admission('case',other,null) <> 0 then raise exception 'Independent connection blocked'; end if;
 for i in 1..8 loop
   if public.claim_workspace_admission('login',s,pair) <> 0 then raise exception 'Login rejected before eight'; end if;
 end loop;
 if public.claim_workspace_admission('login',s,pair) <= 0 then raise exception 'Ninth login admitted'; end if;
 if public.claim_workspace_admission('login',other,pair) <> 0 then raise exception 'Attacker locked out another source'; end if;
 for i in 1..50 loop
   if public.claim_workspace_admission('upload',s,null) <> 0 then raise exception 'Upload rejected before 50'; end if;
 end loop;
 if public.claim_workspace_admission('upload',s,null) <= 0 then raise exception '51st hourly upload admitted'; end if;
 if has_function_privilege('anon','public.claim_workspace_admission(text,text,text)','execute') or has_function_privilege('authenticated','public.claim_workspace_admission(text,text,text)','execute') then raise exception 'Browser can claim admission'; end if;
end $$;
do $$
declare i integer; result integer; id uuid:=gen_random_uuid();
begin
 delete from public.workspace_admission_counters;
 for i in 1..200 loop
  if public.claim_workspace_admission('case',lpad(to_hex(i),64,'0'),null)<>0 then raise exception 'Global case quota rejected early'; end if;
 end loop;
 if public.claim_workspace_admission('case',repeat('f',64),null)<=0 then raise exception 'Global case cap bypassed'; end if;
 update public.workspace_admission_counters set expires_at=now()-interval '1 second';
 if public.claim_workspace_admission('case',repeat('f',64),null)<>0 then raise exception 'Expired quota not reset'; end if;
 if (select count(*) from public.workspace_admission_counters)<>2 then raise exception 'Expired counters not cleaned'; end if;
 delete from public.workspace_admission_counters;
 for i in 1..500 loop
  if public.claim_workspace_admission('upload',lpad(to_hex(i),64,'0'),null)<>0 then raise exception 'Global upload quota rejected early'; end if;
 end loop;
 if public.claim_workspace_admission('upload',repeat('f',64),null)<=0 then raise exception 'Global upload cap bypassed'; end if;
 for i in 1..40 loop
  if public.claim_workspace_admission('login',repeat('a',64),lpad(to_hex(i),64,'0'))<>0 then raise exception 'Source login quota rejected early'; end if;
  perform public.clear_workspace_login_source(repeat('a',64),lpad(to_hex(i),64,'0'));
 end loop;
 if public.claim_workspace_admission('login',repeat('a',64),repeat('f',64))<=0 then raise exception 'Successful login reset aggregate source quota'; end if;
 delete from public.workspace_admission_counters;
 begin
  perform public.workspace_create_case_admitted(id,jsonb_build_object('userId','wrong'),repeat('d',64),null);
  raise exception 'Invalid case unexpectedly inserted';
 exception when others then
  if sqlerrm='Invalid case unexpectedly inserted' then raise; end if;
 end;
 if exists(select 1 from public.workspace_admission_counters) then raise exception 'Failed insert consumed quota'; end if;
 -- Disposable transaction: fill active cases, while expired rows must not count.
 delete from public.workspace_cases;
 insert into public.workspace_cases(id,state,expires_at) select gen_random_uuid(),'{}',now()+interval '1 day' from generate_series(1,999);
 insert into public.workspace_cases(id,state,expires_at) select gen_random_uuid(),'{}',now()-interval '1 day' from generate_series(1,5);
 result:=public.workspace_create_case_admitted(id,jsonb_build_object('userId',id,'expiresAt',extract(epoch from now()+interval '1 day')*1000),repeat('d',64),null);
 if result<>0 then raise exception 'Expired cases consumed active capacity'; end if;
 id:=gen_random_uuid();
 begin
  perform public.workspace_create_case_admitted(id,jsonb_build_object('userId',id,'expiresAt',extract(epoch from now()+interval '1 day')*1000),repeat('d',64),null);
  raise exception '1001st active case admitted';
 exception when others then
  if sqlerrm<>'demo_capacity' then raise; end if;
 end;
 if (select attempts from public.workspace_admission_counters where operation='case' and bucket='global')<>1 then raise exception 'Capacity failure consumed creation quota'; end if;
end $$;
rollback;
