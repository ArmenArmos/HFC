-- App-only V3 adapters. The caller checks the environment switch; SQL checks publication,
-- exact version confirmation and the native schedule again while holding the publisher's lock.
create function public.zoe_v3_dose_record(p_member uuid,p_card uuid,p_op uuid,p_medicine uuid,p_due timestamptz,p_status text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;s jsonb;r jsonb;n jsonb;item text;pid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_member is null or p_op is null or p_due is null or p_status is null or p_status not in('taken','skipped')or not public._telegram_member_eligible(p_member)then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found or k.kind<>'dose'or k.snapshot->>'v3' is distinct from 'true' or jsonb_array_length(k.snapshot->'slots')<>1 then return jsonb_build_object('ok',false,'code','invalid');end if;
 s:=k.snapshot->'slots'->0;pid:=(s->>'planId')::uuid;
 if s->>'medicineId' is distinct from p_medicine::text or (s->>'dueAt')::timestamptz is distinct from p_due then return jsonb_build_object('ok',false,'code','invalid');end if;
 item:='dose:'||p_medicine::text||':'||(extract(epoch from p_due)*1000)::bigint::text;
 if k.outcome?item then
  if k.outcome#>>array[item,'status']<>p_status then return jsonb_build_object('ok',false,'code','stale');end if;
  r:=jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));
  if p_status='skipped'then
   select public._zoe_chat_card_json(x)into n from public.zoe_chat_cards x where x.member_id=p_member and x.request_id=md5('v3-reason:'||pid::text||':'||item)::uuid;
   r:=r||jsonb_build_object('next',n);
  end if;
  return r;
 end if;
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed');end if;
 perform 1 from public.patient_care_plans p join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
  join public.patient_care_plan_versions v on v.plan_id=p.id and v.user_id=p.user_id
  where p.id=pid and p.user_id=p_member and p.active and p.published_at<=now()and c.published_at<=now()and v.teach_back_confirmed_at is not null;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 -- An approved string is compared, never truncated, inferred or accepted from the browser.
 perform 1 from public.patient_care_medications m where m.id=p_medicine and m.user_id=p_member and m.active
  and(m.plan_id=pid or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=pid and l.medication_id=m.id))
  and m.name=s->>'name'and m.dose=s->>'dose';
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 r:=public.zoe_chat_card_claim(p_member,p_card,item,p_op,jsonb_build_object('status',p_status));
 if not coalesce((r->>'ok')::boolean,false)then return r;end if;
 if r#>>'{claim,payload,status}'is distinct from p_status then return jsonb_build_object('ok',false,'code','stale');end if;
 begin
  perform public._report_patient_dose_versioned(p_member,p_medicine,p_due,p_status,(s->>'revision')::bigint);
 exception when raise_exception then
  if sqlerrm in('dose revision conflict','dose outside schedule','plan unavailable','medication unavailable')then return jsonb_build_object('ok',false,'code','stale');end if;
  raise;
 end;
 r:=public.zoe_chat_card_record(p_member,p_card,item,jsonb_build_object('status',p_status),true);
 if not coalesce((r->>'ok')::boolean,false)then raise exception using errcode='40001',message='Dose receipt unavailable';end if;
 if p_status='skipped'then
  n:=public.zoe_chat_card_post(p_member,md5('v3-reason:'||pid::text||':'||item)::uuid,'ask','chip',null,jsonb_build_object('v',1,'v3',true,'askId',p_card,'name',s->>'name','dueAt',p_due,'trigger','skipped'));
  if not coalesce((n->>'ok')::boolean,false)then raise exception using errcode='40001',message='Dose follow-up unavailable';end if;
  r:=r||jsonb_build_object('next',n->'card');
 end if;
 return r;
end$$;

-- Same five-minute job as the existing reminder path, but only writes app chat cards.
-- A deterministic request per plan/medicine/instant makes repeated and concurrent sweeps safe.
create function public.zoe_v3_reminders_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare stamp timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;r record;j jsonb;posted integer:=0;failed integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('state','off','posted',0,'failed',0);end if;
 lt:=stamp at time zone 'Asia/Yerevan';
 for r in
  select p.id plan_id,p.user_id,m.id medicine_id,m.name,m.dose,t.tm,d.day due_day,
   ((d.day+t.tm)at time zone 'Asia/Yerevan')due_at
  from public.patient_care_plans p
  join public.patient_care_plan_versions v on v.plan_id=p.id and v.user_id=p.user_id and v.teach_back_confirmed_at is not null
  join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
  join public.patient_care_medications m on m.user_id=p.user_id and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
  cross join lateral(select distinct unnest(m.times)tm)t
  cross join lateral(values(lt::date-1),(lt::date))d(day)
  left join public.patient_reminder_preferences pref on pref.user_id=p.user_id
  where p.active and p.published_at<=stamp and c.published_at<=stamp and m.active and d.day>=m.start_date and(m.end_date is null or d.day<=m.end_date)
   and coalesce((pref.preferences->>'medicationEnabled')::boolean,true)
   -- Yesterday is eligible only when the chosen offset moves its reminder into today.
   and(d.day=lt::date or ((d.day+t.tm)+coalesce((pref.preferences->>'medicationOffsetMinutes')::integer,0)*interval '1 minute')::date=lt::date)
   and not public._member_quiet_now(p.user_id,lt::time)and public._telegram_member_eligible(p.user_id)
   and ((d.day+t.tm)at time zone 'Asia/Yerevan')between coalesce(m.effective_at,p.published_at)and stamp
   and ((d.day+t.tm)at time zone 'Asia/Yerevan')+coalesce((pref.preferences->>'medicationOffsetMinutes')::integer,0)*interval '1 minute'<=stamp
   and not exists(select 1 from public.patient_dose_events e where e.user_id=p.user_id and e.medication_id=m.id and e.due_at=((d.day+t.tm)at time zone 'Asia/Yerevan'))
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=p.user_id and k.request_id=md5('v3-dose:'||p.id::text||':'||m.id::text||':'||d.day::text||':'||t.tm::text)::uuid)
  order by p.user_id,m.id,d.day,t.tm limit 100
 loop
  -- Publisher and dose action use the same outer lock. Recheck after waiting for a publication.
  perform 1 from public.patient_clinical_cases where user_id=r.user_id for update;
  if not exists(select 1 from public.patient_care_plans where id=r.plan_id and active)then continue;end if;
  j:=public.zoe_chat_card_post(r.user_id,md5('v3-dose:'||r.plan_id::text||':'||r.medicine_id::text||':'||r.due_day::text||':'||r.tm::text)::uuid,'dose','chip',null,
   jsonb_build_object('v',1,'v3',true,'enabled',true,'date',r.due_day,'slots',jsonb_build_array(jsonb_build_object('medicineId',r.medicine_id,'planId',r.plan_id,'name',r.name,'dose',r.dose,'dueAt',r.due_at,'time',to_char(r.tm,'HH24:MI'),'status','due','revision',0))));
  if coalesce((j->>'ok')::boolean,false)then posted:=posted+1;else failed:=failed+1;end if;
 end loop;
 return jsonb_build_object('state','ran','posted',posted,'failed',failed);
end$$;
revoke all on function public.zoe_v3_dose_record(uuid,uuid,uuid,uuid,timestamptz,text),public.zoe_v3_reminders_run(timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_dose_record(uuid,uuid,uuid,uuid,timestamptz,text),public.zoe_v3_reminders_run(timestamptz)to service_role;

-- Read-time validity, using the same published version/teach-back gate as the write and sweep.
-- A replacement hides obsolete open reminders immediately, without a background cleanup.
-- Completed dose receipts remain history even after their publication is retired.
create or replace function public.zoe_chat_cards_member()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();newest bigint;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',true,'enabled',false);end if;
 select max(cm.seq)into newest from public.conversations c join public.conversation_messages cm on cm.conversation_id=c.id where c.member_id=m;
 return jsonb_build_object('ok',true,'enabled',true,
  'cards',coalesce((select jsonb_agg(public._zoe_chat_card_json(x)order by x.created_at,x.id)
   from(select k.* from public.zoe_chat_cards k where k.member_id=m
    and(k.kind<>'dose'or k.snapshot->>'v3'is distinct from 'true'or k.state='done'or exists(
     select 1 from public.patient_care_plans p
     join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
     join public.patient_care_plan_versions v on v.plan_id=p.id and v.user_id=p.user_id
     where p.user_id=m and p.id::text=k.snapshot#>>'{slots,0,planId}'and p.active
      and p.published_at<=now()and c.published_at<=now()and v.teach_back_confirmed_at is not null))
    order by k.created_at desc,k.id desc limit 40)x),'[]'::jsonb),
  'clearedSeq',case when newest is not null and public._zoe_chat_message_cleared(m,newest)
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=m and k.source_seq=newest)then newest end,
  'readingSeq',case when newest is not null and public._zoe_chat_reading_cleared(m,newest)
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=m and k.source_seq=newest)then newest end);
end$$;
