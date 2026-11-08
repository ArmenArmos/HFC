-- The record from the chat (Armen 542, 543, 544 and 539; Monika 558; Tasks 14 and 20).
--
-- 1. A medicine the member names in chat and confirms goes on their own list (member_medicines), as their statement, for the doctor to check. The add
--    function's body moves into an internal one with the member as an argument, as the cards did (20261030102535); the session entry point is unchanged.
--    When it is taken is unknown, so such a row has no times: nothing is due and no reminder goes. The column check allows that only for a row from chat.
-- 2. A questionnaire correction ("I never had a stroke") is stored as the member's statement. No urgency rule reads this table: it only shapes Zoe's tone.
-- 3. zoe_run_member_record also carries the medicine switch, the questionnaire answers a summary needs and what the member disputes. A new key in a
--    function whose row schema ignores unknown keys, so a worker still on the old build reads it as before.
-- 4. Test members. profiles.is_test_account exists (20261019185639). New: workspace_staff.sees_test_members. A flagged member's alerts and forwards are
--    still recorded, and reach only staff with that column set: not the alert list, the staff Telegram notice or the doctor's Today lanes of anyone else.
--    No row changes for a member without the flag. Set the column by SQL for the staging doctors: there is no screen for it.

-- 1. Medicines named in chat ------------------------------------------------------------------------------------------------
alter table public.member_medicines add column from_chat_at timestamptz;
comment on column public.member_medicines.from_chat_at is
 'Set when the member named this medicine in the chat with Zoe and confirmed it: their statement, for the doctor to check. Such a row may have no times.';
alter table public.member_medicines drop constraint member_medicines_times_check;
alter table public.member_medicines add constraint member_medicines_times_check check((from_chat_at is not null and cardinality(times)=0)or public._member_medicine_times_ok(times));

create or replace function public._member_medicine_json(m public.member_medicines,p_from timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',m.id,'source',m.source,'name',m.name,'dose',m.dose,
  'times',coalesce((select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),'[]'::jsonb),'fromChat',m.from_chat_at is not null,
  'startedOn',m.started_on,'createdAt',m.created_at,'stoppedAt',m.stopped_at,'effectiveAt',m.effective_at,'replacedBy',m.replaced_by,
  'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',d.due_at,'status',d.status,'recordedAt',d.recorded_at,'revision',d.revision)order by d.due_at)
   from public.member_medicine_doses d where d.medicine_id=m.id and d.due_at>=p_from),'[]'::jsonb))
$$;

-- The add, for a verified member. p_chat: from the chat, so times may be empty, and a medicine already on the list is not added twice.
create function public._member_medicine_add(uid uuid,p_name text,p_dose text,p_times time[],p_request_id uuid,p_chat boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare mid uuid;prior public.member_medicines;ts time[];
begin
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_name is null or length(btrim(p_name))not between 1 and 120 or(p_dose is not null and length(btrim(p_dose))>120)
  or not(p_chat and p_times='{}'or public._member_medicine_times_ok(p_times))then return jsonb_build_object('status','invalid');end if;
 ts:=coalesce((select array_agg(t order by t)from unnest(p_times)t),'{}');
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 if p_request_id is not null then
  select * into prior from public.member_medicines where user_id=uid and request_id=p_request_id;
  if found then
   if prior.name=btrim(p_name)and prior.dose is not distinct from nullif(btrim(p_dose),'')and prior.times=ts then
    return jsonb_build_object('status','added','id',prior.id);
   end if;
   return jsonb_build_object('status','conflict');
  end if;
 end if;
 if p_chat then
  select * into prior from public.member_medicines where user_id=uid and stopped_at is null and lower(name)=lower(btrim(p_name))limit 1;
  if found then return jsonb_build_object('status','added','id',prior.id,'already',true);end if;
 end if;
 if(select count(*)from public.member_medicines where user_id=uid and stopped_at is null)>=20 then return jsonb_build_object('status','limit');end if;
 insert into public.member_medicines(user_id,name,dose,times,started_on,request_id,from_chat_at)
  values(uid,btrim(p_name),nullif(btrim(p_dose),''),ts,(clock_timestamp()at time zone 'Asia/Yerevan')::date,p_request_id,case when p_chat then clock_timestamp()end)
  returning id into mid;
 return jsonb_build_object('status','added','id',mid);
end$$;
revoke all on function public._member_medicine_add(uuid,text,text,time[],uuid,boolean)from public,anon,authenticated,service_role;

create or replace function public.member_medicine_add(p_name text,p_dose text,p_times time[],p_request_id uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 return public._member_medicine_add(uid,p_name,p_dose,p_times,p_request_id,false);
end$$;

-- The worker, for the member who said yes on this run. Each medicine's request id comes from the run and the position, so a repeated call adds nothing.
-- {status:'added'} when every medicine is on the list; otherwise the first refusal.
create function public.zoe_run_medicines_add(p_run uuid,p_medicines jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;x jsonb;i integer:=0;res jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run;
 if not found or r.state<>'started'or jsonb_typeof(p_medicines)is distinct from 'array'or jsonb_array_length(p_medicines)not between 1 and 3 then return jsonb_build_object('status','invalid');end if;
 if exists(select 1 from public.workspace_staff where user_id=r.member_id)then return jsonb_build_object('status','invalid');end if;
 for x in select value from jsonb_array_elements(p_medicines) loop
  i:=i+1;
  res:=public._member_medicine_add(r.member_id,x->>'name',x->>'dose','{}',(md5(p_run::text||':'||i::text))::uuid,true);
  if res->>'status'<>'added'then return res;end if;
 end loop;
 return jsonb_build_object('status','added');
end$$;
revoke all on function public.zoe_run_medicines_add(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_medicines_add(uuid,jsonb)to service_role;

-- 2. A questionnaire correction -----------------------------------------------------------------------------------------------
create table public.member_statements(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 run_id uuid not null references public.zoe_runs(id),
 kind text not null default 'questionnaire_correction'check(kind='questionnaire_correction'),
 subject text not null check(subject~'^[a-z0-9_]{2,40}$'),
 words text not null check(length(btrim(words))between 1 and 300),
 created_at timestamptz not null default clock_timestamp(),
 unique(member_id,kind,subject,words)
);
comment on table public.member_statements is
 'What a member says is wrong on their questionnaire, in their words (Task 14). Their statement, sent to the doctor. It shapes the tone only: no urgency rule reads it, and the answers stay as they were.';
alter table public.member_statements enable row level security;
revoke all on public.member_statements from public,anon,authenticated,service_role;

create function public.zoe_run_member_statements(p_run uuid,p_statements jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run;
 if not found or r.state<>'started'or jsonb_typeof(p_statements)is distinct from 'array'or jsonb_array_length(p_statements)>3 then return jsonb_build_object('ok',false);end if;
 if exists(select 1 from public.workspace_staff where user_id=r.member_id)then return jsonb_build_object('ok',false);end if;
 insert into public.member_statements(member_id,run_id,subject,words)
  select r.member_id,r.id,s->>'subject',left(btrim(s->>'words'),300)from jsonb_array_elements(p_statements)s
  on conflict(member_id,kind,subject,words)do nothing;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.zoe_run_member_statements(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_member_statements(uuid,jsonb)to service_role;

-- 3. The worker's record ------------------------------------------------------------------------------------------------------
create or replace function public.zoe_run_member_record(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select health_answers_enabled from public.zoe_settings where singleton),false);ldl_on boolean:=public._ldl_goal_enabled();
 today_ date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 cards_on boolean:=coalesce((select zoe_chat_actions_enabled from public.conversation_policy where singleton),false);
 list_on boolean:=coalesce((select enabled from public.member_medicine_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'today',today_,'chatCards',on_ and cards_on,
   'medicineList',on_ and list_on,
   'viaTelegram',coalesce((select cm.source='telegram_member'from public.conversation_messages cm where cm.conversation_id=r.conversation_id and cm.seq=r.message_seq),false),
   'questionnaire',case when on_ then coalesce((select jsonb_build_object('completed',pa.completed_at is not null,'answers',pa.answers)from public.patient_assessments pa where pa.user_id=r.member_id),
    jsonb_build_object('completed',false,'answers','{}'::jsonb))end,
   'nextVisit',case when on_ then(select jsonb_build_object('at',to_char(v.starts_at at time zone 'Asia/Yerevan','YYYY-MM-DD HH24:MI'))from(
     select ap.starts_at from public.patient_care_appointments ap where ap.user_id=r.member_id and ap.status='confirmed'
     union all select(a.current_arrangement->>'startsAt')::timestamptz from public.booking_appointments a where a.member_id=r.member_id and a.status='confirmed'and a.current_reservation_id is not null
    )v where v.starts_at>clock_timestamp()order by v.starts_at limit 1)end,
   'questionnaireFacts',case when on_ then(select nullif(jsonb_object_agg(k,x.answers->k->'value'),'{}'::jsonb)from(select pa.answers from public.patient_assessments pa
      where pa.user_id=r.member_id and pa.completed_at is not null order by pa.completed_at desc limit 1)x
     cross join unnest(array['q2.height','q2.weight','q2.waist','q3.status','q3.years','q3.per_day','q3.quit_years_ago','q4.frequency','q4.drinks_per_day','q5.diagnosed','q6.hba1c','q7.relatives','q7.relative_age','q8.sleep_hours','q8.breathing','q8.daytime_sleepiness','q8.neck'])k
     where jsonb_typeof(x.answers->k->'value')in('string','number','array'))end,
   'disputed',case when on_ then coalesce((select jsonb_agg(distinct s.subject)from public.member_statements s where s.member_id=r.member_id),'[]'::jsonb)end,
   'ageYears',case when on_ then(select extract(year from age(today_,p.birth_date))::integer from public.profiles p where p.id=r.member_id)end,
   'medicines',case when on_ then public._ldl_medicine_facts(r.member_id,7)end,
   'ldl',case when on_ and ldl_on then jsonb_build_object(
    'goal',(select jsonb_build_object('thresholdMmol',g.threshold_mmol,'setOn',(g.set_at at time zone 'Asia/Yerevan')::date)from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1),
    'observations',public._ldl_response_observations(r.member_id),
    'event',(select jsonb_build_object('type',e.event_type,'other',e.event_other,'on',e.event_on)from public.ldl_index_events e where e.member_id=r.member_id and e.removed_at is null order by e.event_on desc nulls last,e.recorded_at desc limit 1),
    'therapies',coalesce((select jsonb_agg(jsonb_build_object('drug',t.drug,'other',t.drug_other,'dose',t.dose,'startedOn',t.started_on)order by t.recorded_at desc)
     from public.ldl_lipid_therapies t where t.member_id=r.member_id and t.ended_at is null),'[]'::jsonb),
    'nextTestOn',coalesce((select t.due_from from public.ldl_retests t where t.member_id=r.member_id and t.state in('scheduled','requested','fenced')order by t.created_at desc limit 1),
     (select g.next_test_on from public.ldl_goals g where g.member_id=r.member_id order by g.version desc limit 1)))end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;

-- 4. Test members --------------------------------------------------------------------------------------------------------------
alter table public.workspace_staff add column sees_test_members boolean not null default false;
comment on column public.workspace_staff.sees_test_members is
 'Test staff: this person sees the alerts and forwards of members flagged profiles.is_test_account. Everyone else does not.';

create function public._test_member_hidden(p_member uuid,p_staff uuid)returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select is_test_account from public.profiles where id=p_member),false)
  and not coalesce((select sees_test_members from public.workspace_staff where user_id=p_staff),false)
$$;
revoke all on function public._test_member_hidden(uuid,uuid)from public,anon,authenticated,service_role;

-- As 20261017083922, for flagged members only staff who see them.
create or replace function public._care_alert_visible(a public.care_alerts,actor jsonb)returns boolean language sql stable security definer set search_path=''as $$
 select not public._test_member_hidden(a.member_id,(actor->>'id')::uuid)
  and(actor->>'role'='admin'or exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id and c.assigned_doctor_id=(actor->>'id')::uuid))
$$;

-- As 20261017083922: no staff notice about a flagged member to anyone else.
create or replace function public._care_alert_notify(a public.care_alerts)returns void
language plpgsql security definer set search_path=''as $$
declare s public.care_alert_settings:=public._care_alert_settings();r record;mid uuid;n integer:=0;eligible integer:=0;
begin
 if s.telegram_delivery is not true then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','telegram_delivery_off','system',null,'{}');return;end if;
 -- A repeat within 15 minutes of the last notice does not page staff again; the inbox shows the count.
 if a.occurrences>1 and exists(select 1 from public.care_alert_deliveries where alert_id=a.id and created_at>clock_timestamp()-interval '15 minutes')then
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped','recently_notified','system',null,'{}');return;end if;
 for r in select distinct on(ws.user_id)ws.user_id,b.address,b.principal_ref
  from public.workspace_staff ws join public.telegram_auth_bindings b on b.auth_user_id=ws.user_id and b.kind='staff'and b.active
  where ws.active and ws.removed_at is null and(ws.role='admin'or(ws.role='doctor'and ws.user_id=a.doctor_id))
   and not public._test_member_hidden(a.member_id,ws.user_id)order by ws.user_id loop
  eligible:=eligible+1;
  if exists(select 1 from public.care_alert_deliveries where alert_id=a.id and recipient_id=r.user_id and occurrence=a.occurrences)then continue;end if;
  mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(r.user_id),r.address,r.principal_ref,null,null);
  if mid is null then continue;end if;
  insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)values(a.id,r.user_id,'telegram',mid,a.occurrences);
  n:=n+1;
 end loop;
 if n>0 then
  perform public._care_alert_trace(a,'care_alert.telegram_queued','queued',
   case when(select approved from public.system_message_templates where template_id='care_alert.staff_notice'order by version desc limit 1)is not true
    then 'queued_wording_unapproved_will_be_held'else 'staff_notice_queued'end,'system',null,jsonb_build_object('noreon.care_alert.recipients',n));
 else
  perform public._care_alert_trace(a,'care_alert.telegram_skipped','skipped',case when eligible=0 then 'no_enrolled_staff'else 'no_template_available'end,'system',null,'{}');
 end if;
end$$;

-- As 20261031182321: the doctor's list of members leaves out flagged members unless the doctor sees them.
create or replace function public.doctor_ai_inbox()returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 today date:=public._programme_today(clock_timestamp());
 p0 jsonb:='[]';items jsonb:='[]';part jsonb;missing text[]:='{}';
 p0_total integer;p0_cap constant integer:=200;lane_cap constant integer:=50;
 members uuid[];za jsonb:='[]';za_total integer:=0;nurse_activity jsonb:='[]';
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;

 -- Members this doctor may read: assigned to them, with care access (as doctor_programme_queue). An array, not a
 -- temp table, so a caller's own session objects can never stand in for it.
 select coalesce(array_agg(k.user_id),'{}')into members from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)and not public._test_member_hidden(k.user_id,me);

 -- P0: care alerts. Open (new, or open again) before acknowledged; then oldest first.
 select count(*)into p0_total from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved';
 select coalesce(jsonb_agg(x order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0 from(
  select jsonb_build_object('id','care_alert:'||a.id,'lane','P0','kind','care_alert','rank',case when a.state='open'then 0 else 1 end,
   'memberId',a.member_id,'at',a.created_at,'confidence','rule','ai','none',
   'sources',jsonb_build_array(jsonb_build_object('type','care_alert','ref',a.id::text),jsonb_build_object('type','source','ref',a.source))
    ||coalesce((select jsonb_agg(jsonb_build_object('type','rule','ref',f))from unnest(a.red_flags)f),'[]'),
   'alert',public._care_alert_json(a))x
  from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved'
  order by(a.state='open')desc,a.created_at,a.id limit p0_cap)q;

 -- P1 and P2: lab files with values still to review. Flagged values make a P1 item; unflagged only, a P2 item.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','lab:'||v.file_id,'lane',case when bool_or(v.attention is not null)then 'P1'else 'P2'end,
    'kind',case when bool_or(v.attention is not null)then 'lab_attention'else 'lab_sheet'end,
    'rank',case when bool_or(v.attention='lab_critical'or v.lab_flag='critical')then 0 when bool_or(v.attention is not null)then 1 else 3 end,
    'memberId',v.user_id,'at',min(v.created_at),'confidence','H','ai','values',
    'fileId',v.file_id,'toReview',count(*),'flagged',count(*)filter(where v.attention is not null),
    'critical',count(*)filter(where v.attention='lab_critical'or v.lab_flag='critical'),
    'sources',coalesce(jsonb_agg(jsonb_build_object('type','lab_value','ref',v.id::text,'rule',v.attention_rule,'page',v.page)order by v.seq)
     filter(where v.attention is not null),'[]')||jsonb_build_array(jsonb_build_object('type','lab_file','ref',v.file_id::text)))x
   from public.lab_ai_values v
   where v.user_id=any(members)and v.status='unverified'and public._lab_ai_current(v.attachment_id)
   group by v.user_id,v.file_id)q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'lab');end;

 -- P1 "worse" check-ins and P2 checkpoints due within 3 days (or overdue), while the programme is on.
 begin
  if public._programme_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','checkpoint:'||c.id,'lane',case when i.feeling='worse'then 'P1'else 'P2'end,
     'kind',case when i.feeling='worse'then 'checkin_worse'else 'checkpoint_due'end,
     'rank',case when i.feeling='worse'then 2 when c.due_on<today then 0 else 2 end,
     'memberId',c.member_id,'at',coalesce(i.submitted_at,c.due_on::timestamptz),'confidence','H','ai','none',
     'checkpointId',c.id,'checkpointKind',c.kind,'dueOn',c.due_on,'overdue',c.due_on<today,'medicines',i.medicines,
     'sources',jsonb_build_array(jsonb_build_object('type','checkpoint','ref',c.id::text,'rule',c.kind))
      ||case when i.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','checkin','ref',i.id::text))end)x
    from public.programme_checkpoints c
    left join public.programme_checkins i on i.checkpoint_id=c.id
    where c.member_id=any(members)and c.state in('scheduled','open')and(i.feeling='worse'or c.due_on<=today+3))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'programme');end;

 -- P2 AI care plan drafts: the member's latest ready draft, not adopted, with no plan published since.
 begin
  if public._ai_plan_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','plan:'||g.id,'lane','P2','kind','plan_draft','rank',1,
     'memberId',g.user_id,'at',g.created_at,'confidence','M','ai',case when g.mode='protocol_only'then 'protocol'else 'draft'end,
     'generationId',g.id,'stale',(g.lab_token is distinct from public._ai_plan_lab_token(g.user_id)or g.case_revision is distinct from k.revision),
     'sources',jsonb_build_array(jsonb_build_object('type','plan_generation','ref',g.id::text,'rule',g.prompt_version),
      jsonb_build_object('type','case_revision','ref',g.case_revision::text)))x
    from public.patient_clinical_cases k
    cross join lateral(select * from public.ai_plan_generations g where g.user_id=k.user_id and g.state='ready'order by g.created_at desc limit 1)g
    where k.user_id=any(members)and g.adopted_at is null
     and not exists(select 1 from public.patient_clinical_publications p where p.user_id=g.user_id and p.published_at>g.created_at))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'plan');end;

 -- P1 and P3 replies, by the Replies page's rules (conversation_awaiting_replies) with two differences so that only a
 -- decision closes an item (review DI-01, DI-02): an undelivered reply stays until a newer reply or a rejection, at any
 -- age; and the wait starts at the oldest unanswered member event, a stored message or a media or over-limit message
 -- that has no stored row. Over 24 h is P1.
 -- Zoe's structured reply draft (#323) for the pending draft is carried on the item: the exact text, its revision and
 -- content hash (what an inbox Approve is bound to), and its sources. A question whose draft needs the doctor's
 -- judgement is P1 at any age. The draft is approvable from the inbox only when it is structured, current (conversation,
 -- clinical revision and evidence token unchanged), quotes the plan that is still published, needs no judgement, and the
 -- member has no unresolved care alert: P0 is never answered by a one-tap reply. The approval itself still goes through
 -- conversation_actions and conversation_command, which re-check all of this.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','reply:'||q.cid,'memberId',q.member_id,
    'lane',case when q.reason='not_delivered'or q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 'P1'else 'P3'end,
    'kind',case when q.reason='not_delivered'then 'reply_not_delivered'when q.since<clock_timestamp()-interval '24 hours'then 'reply_overdue'else 'reply_draft'end,
    'rank',case when q.reason='not_delivered'then 5 when q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 4 else 0 end,
    'at',case when q.reason='not_delivered'then q.delivered_at else q.since end,
    'confidence',case when q.reason='not_delivered'then 'rule'when q.draft_id is null or q.human_only or q.stale or(q.run_id is not null and not q.plan_current)then 'L'else 'M'end,
    'ai',case when q.reason='not_delivered'or q.draft_id is null or q.human_only then 'none'else 'draft'end,
    'unanswered',q.unanswered,'delivery',q.delivery,
    'sources',jsonb_build_array(jsonb_build_object('type','conversation','ref',q.cid::text,'seq',q.version))
     ||case when q.draft_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','draft','ref',q.draft_id::text,'seq',q.draft_seq))end
     ||case when q.run_id is null or q.reason='not_delivered'then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','zoe_run','ref',q.run_id::text,'rule',q.s_version))
      ||case when q.plan_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','plan_publication','ref',q.plan_id::text))end
      ||coalesce((select jsonb_agg(jsonb_build_object('type','plan_item','ref',e->>'id','rule',e->>'kind'))from jsonb_array_elements(q.quoted)e),'[]')end)
    ||case when q.reason='not_delivered'or q.draft_id is null then '{}'::jsonb else jsonb_build_object('draft',jsonb_build_object(
     'draftId',q.draft_id,'revision',q.draft_revision,'body',q.body,'contentHash',q.content_hash,'author',q.author,
     'structured',q.run_id is not null,'stale',q.stale,'planCurrent',q.plan_current,'openAlert',q.open_alert,
     'asked',q.asked,'acknowledgementId',q.ack_id,'needsJudgement',coalesce(q.needs_judgement,false),'outsidePlan',coalesce(q.outside_plan,false),
     'judgementReasons',coalesce(to_jsonb(q.judgement_reasons),'[]'),'doctorDecides',coalesce(to_jsonb(q.doctor_decides),'[]'),
     'approvable',q.run_id is not null and not q.stale and q.plan_current and not q.judgement and not q.open_alert))end x
   from(
    select q0.*,
     q0.draft_id is not null and(q0.draft_ctx<>q0.version or q0.draft_clinical is distinct from q0.case_revision
      or q0.draft_source is distinct from(case when q0.draft_id is null then null else public.patient_clinical_evidence(q0.member_id)->>'token'end))stale,
     q0.run_id is not null and q0.reason='new_message'and(coalesce(q0.needs_judgement,false)or coalesce(q0.outside_plan,false))judgement,
     q0.run_id is not null and q0.plan_id is not distinct from(select p.plan_id from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
      where plan.user_id=q0.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1)plan_current,
     exists(select 1 from public.care_alerts al where al.member_id=q0.member_id and al.state<>'resolved')open_alert
    from(
    select c.id cid,c.member_id,c.version,ld.state delivery,ld.created_at delivered_at,d.id draft_id,d.context_version draft_seq,
     d.revision draft_revision,d.context_version draft_ctx,d.clinical_revision draft_clinical,d.source_token draft_source,k.revision case_revision,
     rv.body,rv.content_hash,rv.author_kind author,
     rv.author_kind='staff'and not exists(select 1 from public.conversation_revisions ar where ar.draft_id=d.id and ar.author_kind='ai_assistant')human_only,
     s.run_id,s.version s_version,s.plan_id,s.quoted,s.asked,s.acknowledgement_id ack_id,s.needs_judgement,s.outside_plan,s.judgement_reasons,s.doctor_decides,
     (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0))::int unanswered,
     -- 20261031134000: Zoe sent something in the open window to the doctor at the same-day level or above (the zoe.forward audit
     -- zoe_run_finish writes). The member was told it needs a doctor today, so it is in Today at any age, until a decision.
     exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.forward'
      and(au.detail->>'seq')::bigint>coalesce(dec.v,0)and au.detail->>'urgency'in('same_day','emergency'))same_day,
     case when c.version>coalesce(dec.v,0)and zst.st is null then 'new_message'
      when ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'
       and not(ld.reason='route_policy_missing'and exists(select 1 from public.conversation_app_releases ar where ar.approval_id=ld.approval_id)))
      then case when exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at)then null else 'not_delivered'end
     end reason,
     coalesce(least(
      (select min(cm.created_at)from public.conversation_messages cm where cm.conversation_id=c.id and cm.seq>coalesce(dec.v,0)),
      (select min(au.created_at)from public.conversation_audit au where au.conversation_id=c.id and au.kind in('message.media','message.overflow')
        and(au.detail->>'version')::bigint>coalesce(dec.v,0))),clock_timestamp())since
    from public.conversations c
    join public.patient_clinical_cases k on k.user_id=c.member_id
    left join lateral(select max(dd.context_version)v from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state in('approved','rejected'))dec on true
    left join lateral(select dl.state,dl.reason,dl.created_at,dl.approval_id from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
    left join lateral(select dd.* from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state='pending'order by dd.created_at desc,dd.id desc limit 1)d on true
    left join public.conversation_revisions rv on rv.draft_id=d.id and rv.revision=d.revision
    left join lateral(select zr.* from public.zoe_runs z join public.zoe_reply_drafts zr on zr.run_id=z.id where z.draft_id=d.id order by zr.created_at desc limit 1)s on true
    -- Part 2 (20261020060842): a thread Zoe fully answered is not "new message"; an undelivered reply still is.
    left join lateral(select public._zoe_answered_open(c.id)st)zst on true
    where c.member_id=any(members))q0)q
   where q.reason is not null)q2;
  items:=items||part;
 exception when others then missing:=array_append(missing,'replies');end;

 -- P1 finished symptom intakes the doctor has not answered yet (no reply decision at or after the intake's last message).
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','intake:'||s.id,'lane','P1','kind','intake','rank',3,'memberId',s.member_id,'at',coalesce(s.finished_at,s.updated_at),
    'confidence','H','ai','summary','intakeId',s.id,'sheetId',s.sheet_id,'ending',s.ending,'redFlags',jsonb_array_length(coalesce(s.summary#>'{redFlags,hits}','[]')),
    'sources',jsonb_build_array(jsonb_build_object('type','intake','ref',s.id::text,'rule',s.sheet_id||'@'||s.sheet_version,'seq',s.last_seq)))x
   from public.zoe_symptom_intakes s
   where s.member_id=any(members)and s.state<>'active'
    and not exists(select 1 from public.conversation_drafts dd where dd.conversation_id=s.conversation_id and dd.state in('approved','rejected')and dd.context_version>=s.last_seq))q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'intake');end;

 -- Recent nurse activity is information, not a clinical decision or a closed reply.
 -- Keep it separate from the existing item kinds, so an older app can still parse the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'at'desc,x->>'id'),'[]')into nurse_activity from(
   select jsonb_build_object('id',r.id,'memberId',c.member_id,'memberName',coalesce(pr.display_name,''),
    'text',r.body,'at',r.created_at,'senderName',r.nurse_name,'senderRole','nurse')x
   from public.conversation_nurse_replies r join public.conversations c on c.id=r.conversation_id
   left join public.profiles pr on pr.id=c.member_id
   where c.member_id=any(members)and r.created_at>=clock_timestamp()-interval '24 hours'
   order by r.created_at desc,r.id limit lane_cap)q;
 exception when others then missing:=array_append(missing,'nurse_activity');end;

 -- Part 2 (20261020060842): threads Zoe fully answered, not yet marked reviewed, newest first (not an item: the item kinds
 -- stay those the running app parses). Its own block, so a failure here is reported and never hides the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'answeredAt'desc,x->>'memberId'),'[]'),count(*)into za,za_total from(
   select q.st||jsonb_build_object('memberName',coalesce(pr.display_name,''))x
   from(select c.member_id,public._zoe_answered_open(c.id)st from public.conversations c where c.member_id=any(members))q
   left join public.profiles pr on pr.id=q.member_id
   where q.st is not null and not(q.st->>'reviewed')::boolean)q2;
  za:=coalesce((select jsonb_agg(x order by n)from jsonb_array_elements(za)with ordinality e(x,n)where n<=lane_cap),'[]');
 exception when others then missing:=array_append(missing,'zoe_answered');za:='[]';za_total:=0;end;

 -- Names, lane order, caps. The order is lane, rank, age (oldest first), id; check:doctor-ai-inbox pins it.
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(pr.display_name,''))order by x->>'lane',(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into items
 from(select x,row_number()over(partition by x->>'lane'order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id')n from jsonb_array_elements(items)x)q
 left join public.profiles pr on pr.id=(x->>'memberId')::uuid where n<=lane_cap;
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(x#>>'{alert,memberName}',''))order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0
 from jsonb_array_elements(p0)x;

 -- One access record per member shown, as other doctor reads.
 perform public._access_audit_record(mid,'doctor_inbox',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(p0||items||za||nurse_activity)x)q;

 return jsonb_build_object('version','doctor-inbox-v1','ok',true,'asOf',clock_timestamp(),
  'p0',p0,'p0Total',p0_total,'items',items,'laneCap',lane_cap,'unavailable',to_jsonb(missing),'zoeAnswered',za,'zoeAnsweredTotal',za_total,'nurseActivity',nurse_activity);
end$$;
