alter table public.patient_message_recovery_events drop constraint patient_message_recovery_events_action_check;
alter table public.patient_message_recovery_events add constraint patient_message_recovery_events_action_check check(action in ('retry','resume','acknowledge'));
alter table public.patient_message_recovery_events add column evidence text check(evidence ~ '^[0-9a-f]{32}$');
create unique index patient_message_attention_one_ack on public.patient_message_recovery_events(attempt_id,evidence) where action='acknowledge';
alter table public.patient_message_attempts add column last_polled_status text,add column stable_polls integer not null default 0 check(stable_polls between 0 and 20);

create function public.patient_message_attention_fact(p_attempt_id uuid)
returns table(reason text,evidence text)
language sql stable security definer set search_path='' as $$
 with facts as(
 select a.*,e.success,e.failure,e.sent,e.events from public.patient_message_attempts a
 cross join lateral(select coalesce(bool_or(d.status in ('delivered','read')),false) success,coalesce(bool_or(d.status in ('failed','undelivered','canceled')),false) failure,coalesce(bool_or(d.status='sent'),false) sent,coalesce(jsonb_agg(jsonb_build_array(d.status,d.error_code) order by d.status,d.error_code),'[]'::jsonb) events from public.patient_message_delivery_events d where d.attempt_id=a.id) e
 where a.id=p_attempt_id
 ),attention as(
 select f.*,case when f.status='unknown' then 'submission-unknown'
 when f.status='submitting' then 'submission-pending'
 when f.status='failed' and not exists(select 1 from public.patient_message_recovery_events r where r.attempt_id=f.id and r.action='retry') then 'submission-rejected'
 when f.status='accepted' then case when f.success and f.failure then 'delivery-conflict'
 when f.failure then 'delivery-failed'
 when not f.success and f.reconcile_failures>0 then 'reconciliation-failed'
 when not f.success and f.started_at<=now()-interval '48 hours' then case when f.channel='sms' and f.sent then 'no-delivery-receipt' else 'delivery-overdue' end end end why
 from facts f)
 select why,md5(jsonb_build_object('status',status,'reason',why,'events',events,'pollFailures',reconcile_failures)::text) from attention where why is not null;
$$;
revoke all on function public.patient_message_attention_fact(uuid) from public,anon,authenticated,service_role;

drop function public.patient_message_attention(timestamptz,uuid,integer);
create function public.patient_message_attention(p_before_started_at timestamptz default null,p_before_id uuid default null,p_limit integer default 51,p_include_acknowledged boolean default false)
returns table(attempt_id uuid,started_at timestamptz,submission_status text,reason text,reconcile_failures integer,evidence text,acknowledged boolean)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 51 or p_include_acknowledged is null or (p_before_started_at is null)<>(p_before_id is null) then raise exception 'invalid';end if;
 return query select a.id,a.started_at,a.status,f.reason,a.reconcile_failures,f.evidence,k.done
 from public.patient_message_attempts a
 cross join lateral public.patient_message_attention_fact(a.id) f
 cross join lateral(select exists(select 1 from public.patient_message_recovery_events r where r.attempt_id=a.id and r.action='acknowledge' and r.evidence=f.evidence) done) k
 where (p_before_started_at is null or (a.started_at,a.id)<(p_before_started_at,p_before_id)) and (p_include_acknowledged or not k.done)
 order by a.started_at desc,a.id desc limit p_limit;
end $$;
revoke all on function public.patient_message_attention(timestamptz,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.patient_message_attention(timestamptz,uuid,integer,boolean) to service_role;

create function public.acknowledge_patient_message_attention(p_attempt_id uuid,p_expected_evidence text,p_operator_label text) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_evidence text;
begin
 if p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9@._-]{3,100}$' or p_expected_evidence is null or p_expected_evidence !~ '^[0-9a-f]{32}$' then raise exception 'invalid';end if;
 -- Callback, finish and poll outcomes lock this same attempt before changing evidence.
 perform 1 from public.patient_message_attempts where id=p_attempt_id for update;
 if not found then return false;end if;
 select f.evidence into current_evidence from public.patient_message_attention_fact(p_attempt_id) f;
 if current_evidence is distinct from p_expected_evidence then return false;end if;
 insert into public.patient_message_recovery_events(attempt_id,action,operator_label,evidence) values(p_attempt_id,'acknowledge',p_operator_label,current_evidence) on conflict do nothing;
 return true;
end $$;
revoke all on function public.acknowledge_patient_message_attention(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.acknowledge_patient_message_attention(uuid,text,text) to service_role;

drop function public.defer_patient_message_reconciliation(uuid,boolean);
create function public.defer_patient_message_reconciliation(p_attempt_id uuid,p_failed boolean,p_observed_status text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.patient_message_attempts;failures integer;stable_count integer;delay integer;
begin
 if p_failed is null or (p_observed_status is not null and p_observed_status not in ('accepted','scheduled','queued','sending','sent','delivered','read','undelivered','failed','canceled')) then raise exception 'invalid';end if;
 select * into a from public.patient_message_attempts where id=p_attempt_id and status='accepted' for update;
 if not found then return false;end if;
 failures:=case when p_failed then least(a.reconcile_failures+1,20) else 0 end;
 stable_count:=case when not p_failed and p_observed_status is not null and p_observed_status=a.last_polled_status then least(a.stable_polls+1,20) else 0 end;
 delay:=least(21600,300*power(2,least(greatest(failures,stable_count),7)))::integer;
 update public.patient_message_attempts set reconcile_failures=failures,stable_polls=stable_count,last_polled_status=case when p_failed then a.last_polled_status else p_observed_status end,next_reconcile_at=clock_timestamp()+make_interval(secs=>delay) where id=a.id;
 return true;
end $$;
revoke all on function public.defer_patient_message_reconciliation(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.defer_patient_message_reconciliation(uuid,boolean,text) to service_role;
