begin;
do $$
declare c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); cl uuid:=gen_random_uuid();
 rid text:=gen_random_uuid()::text; other text:=gen_random_uuid()::text; path text; rec jsonb; before_row jsonb; ev bigint; n integer;
begin
 insert into auth.users(id) values(d);
 insert into public.workspace_clinics(id,name) values(cl,'Fictional deduplication clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(d,'doctor','Fictional',cl);
 perform public.workspace_create_case(c,jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000),d);
 perform public.workspace_create_case(c2,jsonb_build_object('userId',c2,'expiresAt',extract(epoch from now()+interval '1 day')*1000),null);
 path:=c||'/'||rid||'/'||gen_random_uuid();
 rec:=jsonb_build_object('id',rid,'user_id',c,'object_path',path,'checksum',repeat('a',64),'mime','application/pdf','file_name','same.pdf','revision',0,'state','confirmed','reviewed',jsonb_build_object('rows','[]'::jsonb));
 perform public.workspace_write_report(c,rid,'insert',null,rec);
 select record into rec from public.workspace_case_reports where case_id=c and id=rid;
 perform public.workspace_write_report(c,rid,'approve',0,null,jsonb_build_object('revision',0,'report',rec,'doctor','Fictional'),d);
 -- Existing duplicates and published history must never be rewritten as a migration shortcut.
 update public.workspace_case_reports set published=jsonb_build_object('key','frozen','approval',approval) where case_id=c and id=rid;
 select to_jsonb(r) into before_row from public.workspace_case_reports r where case_id=c and id=rid;
 select evidence_revision into ev from public.workspace_cases where id=c;
 begin
   perform public.workspace_write_report(c,other,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('id',other,'file_name','renamed.pdf','object_path',c||'/'||other||'/'||gen_random_uuid()));
   raise exception 'TEST: identical bytes with a different ID were inserted';
 exception when unique_violation then if sqlerrm<>'duplicate' then raise;end if;end;
 if (select count(*) from public.workspace_case_reports where case_id=c)<>1 then raise exception 'TEST: duplicate consumed a slot';end if;
 if (select to_jsonb(r) from public.workspace_case_reports r where case_id=c and id=rid) is distinct from before_row then raise exception 'TEST: duplicate modified existing evidence';end if;
 if (select evidence_revision from public.workspace_cases where id=c)<>ev then raise exception 'TEST: duplicate changed case evidence';end if;
 n:=public.workspace_write_report(c,rid,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('object_path',c||'/'||rid||'/'||gen_random_uuid()));
 if n<>1 or (select to_jsonb(r) from public.workspace_case_reports r where case_id=c and id=rid) is distinct from before_row then raise exception 'TEST: same-ID replay changed the original';end if;
 begin
   perform public.workspace_write_report(c,rid,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('checksum',repeat('b',64)));
   raise exception 'TEST: same ID with different bytes was accepted';
 exception when unique_violation then if sqlerrm<>'duplicate' then raise;end if;end;
 foreach path in array array['checksum','object_path'] loop
   begin
     perform public.workspace_write_report(c,rid,'update',1,jsonb_set(rec,array[path],'"changed"'),null,d);
     raise exception 'TEST: original identity was mutable';
   exception when others then if sqlerrm<>'protected report identity' then raise;end if;end;
 end loop;
 -- The same bytes in another member case are independent.
 perform public.workspace_write_report(c2,other,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('id',other,'user_id',c2,'object_path',c2||'/'||other||'/'||gen_random_uuid()));
 other:=gen_random_uuid()::text;
 perform public.workspace_write_report(c2,other,'insert',null,jsonb_build_object('id',other,'user_id',c2,'checksum',repeat('b',64),'file_name','same.pdf'));
 if (select count(*) from public.workspace_case_reports where case_id=c2)<>2 then raise exception 'TEST: different bytes with the same filename were rejected';end if;
 -- Legacy duplicates may already exist; keep both and reject only new duplicates.
 other:=gen_random_uuid()::text;
 insert into public.workspace_case_reports(case_id,id,record) values(c2,other,jsonb_build_object('id',other,'user_id',c2,'checksum',repeat('b',64),'file_name','legacy duplicate.pdf'));
 other:=gen_random_uuid()::text;
 begin
   perform public.workspace_write_report(c2,other,'insert',null,jsonb_build_object('id',other,'user_id',c2,'checksum',repeat('b',64)));
   raise exception 'TEST: another legacy duplicate was inserted';
 exception when unique_violation then if sqlerrm<>'duplicate' then raise;end if;end;
 if (select count(*) from public.workspace_case_reports where case_id=c2)<>3 then raise exception 'TEST: legacy duplicates were destroyed';end if;
 -- Missing hashes (sample/legacy reports) do not all become one report.
 for n in 1..9 loop
   other:=gen_random_uuid()::text;
   perform public.workspace_write_report(c,other,'insert',null,jsonb_build_object('id',other,'user_id',c,'checksum',null,'file_name','same.pdf'));
 end loop;
 other:=gen_random_uuid()::text;
 begin
   perform public.workspace_write_report(c,other,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('id',other));
   raise exception 'TEST: duplicate at capacity accepted';
 exception when unique_violation then if sqlerrm<>'duplicate' then raise;end if;end;
 begin
   perform public.workspace_write_report(c,other,'insert',null,jsonb_build_object('id',other,'user_id',c,'checksum',repeat('b',64),'file_name','same.pdf'));
   raise exception 'TEST: capacity bypassed';
 exception when others then if sqlerrm<>'report_limit' then raise;end if;end;
 perform public.workspace_write_report(c,rid,'delete',1);
 perform public.workspace_write_report(c,other,'insert',null,(rec-'contentRevision'-'associations'-'associationHistory')||jsonb_build_object('id',other,'object_path',c||'/'||other||'/'||gen_random_uuid()));
 if not exists(select 1 from public.workspace_case_reports where case_id=c and id=other) then raise exception 'TEST: removal prevented fresh-ID reupload';end if;
end $$;
rollback;
