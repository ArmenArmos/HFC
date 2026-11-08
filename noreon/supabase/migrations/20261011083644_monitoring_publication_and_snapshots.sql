-- Keep the seven-key clinical draft unchanged; decisions are separate metadata.
alter function public.workspace_save_review_draft(uuid,uuid,integer,bigint,jsonb) rename to workspace_save_review_draft_before_monitoring;
revoke all on function public.workspace_save_review_draft_before_monitoring(uuid,uuid,integer,bigint,jsonb) from public,anon,authenticated,service_role;
create function public.workspace_save_review_draft(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint,p_draft jsonb,p_monitoring_decisions jsonb default '[]') returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;choice jsonb;rid uuid;v integer;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 perform public.workspace_review_doctor(p_id,p_actor);
 if jsonb_typeof(p_monitoring_decisions) is distinct from 'array' then raise exception 'Invalid monitoring decisions.';end if;
 if jsonb_array_length(p_monitoring_decisions)<>(select count(distinct x->>'requirementId') from jsonb_array_elements(p_monitoring_decisions) x) then raise exception 'Duplicate monitoring decisions.';end if;
 v:=public.workspace_save_review_draft_before_monitoring(p_id,p_actor,p_expected_revision,p_expected_evidence_revision,p_draft);
 delete from public.workspace_monitoring_decisions where requirement_id in(select id from public.workspace_monitoring_requirements where case_id=p_id);
 for choice in select value from jsonb_array_elements(p_monitoring_decisions) loop
  if jsonb_typeof(choice)<>'object' or (select count(*) from jsonb_object_keys(choice))<>2 or choice->>'decision' is null or choice->>'decision' not in ('retain','supersede') then raise exception 'Invalid monitoring decision.';end if;
  rid:=(choice->>'requirementId')::uuid;
  if not exists(select 1 from public.workspace_monitoring_requirements where case_id=p_id and id=rid and status='active') then raise exception 'Monitoring requirement changed. Refresh the review.';end if;
  insert into public.workspace_monitoring_decisions(requirement_id,decision,evidence_revision,publication_version,draft,actor_id)
  values(rid,choice->>'decision',p_expected_evidence_revision,(c.state#>>'{workflow,publication,version}')::integer,p_draft,p_actor);
 end loop;
 return v;
end $$;
revoke all on function public.workspace_save_review_draft(uuid,uuid,integer,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_save_review_draft(uuid,uuid,integer,bigint,jsonb,jsonb) to service_role;

alter function public.workspace_publish_review(uuid,uuid,integer,bigint) rename to workspace_publish_review_before_monitoring;
revoke all on function public.workspace_publish_review_before_monitoring(uuid,uuid,integer,bigint) from public,anon,authenticated,service_role;
create function public.workspace_publish_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;r record;v integer;publication_version integer;label text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 label:=public.workspace_review_doctor(p_id,p_actor);
 perform 1 from public.workspace_monitoring_requirements where case_id=p_id and status='active' order by id for update;
 if exists(select 1 from public.workspace_monitoring_requirements q left join public.workspace_monitoring_decisions d on d.requirement_id=q.id
  where q.case_id=p_id and q.status='active' and (d.requirement_id is null or d.actor_id is distinct from p_actor or d.evidence_revision is distinct from c.evidence_revision or d.publication_version is distinct from (c.state#>>'{workflow,publication,version}')::integer or d.draft is distinct from c.state#>'{workflow,draft}')) then
  raise exception 'Decide whether to retain or supersede each monitoring requirement and save the reviewed draft.';
 end if;
 publication_version:=coalesce((c.state#>>'{workflow,publication,version}')::integer,0)+1;
 v:=public.workspace_publish_review_before_monitoring(p_id,p_actor,p_expected_revision,p_expected_evidence_revision);
 for r in select q.id,d.decision from public.workspace_monitoring_requirements q join public.workspace_monitoring_decisions d on d.requirement_id=q.id where q.case_id=p_id and q.status='active' order by q.id loop
  if r.decision='retain' then
   update public.workspace_monitoring_requirements set current_publication=publication_version,revision=revision+1 where id=r.id;
  else
   update public.workspace_monitoring_requirements set status='superseded',revision=revision+1 where id=r.id;
   update public.workspace_followup_work set status='superseded',resolved_at=clock_timestamp() where requirement_id=r.id and status='open';
  end if;
  insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label,note) values(r.id,case when r.decision='retain' then 'retained' else 'superseded' end,p_actor,label,'Approved plan version '||publication_version);
 end loop;
 delete from public.workspace_monitoring_decisions where requirement_id in(select id from public.workspace_monitoring_requirements where case_id=p_id);
 return v;
end $$;
revoke all on function public.workspace_publish_review(uuid,uuid,integer,bigint) from public,anon,authenticated;
grant execute on function public.workspace_publish_review(uuid,uuid,integer,bigint) to service_role;

alter function public.workspace_reset_review(uuid,uuid,integer,jsonb) rename to workspace_reset_review_before_monitoring;
revoke all on function public.workspace_reset_review_before_monitoring(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
create function public.workspace_reset_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare v integer;label text;r record;
begin
 -- Existing reset locks/authenticates the case and retains review history.
 v:=public.workspace_reset_review_before_monitoring(p_id,p_actor,p_expected_revision,p_workflow);
 select display_name into label from public.workspace_staff where user_id=p_actor;
 for r in select id from public.workspace_monitoring_requirements where case_id=p_id and status='active' order by id for update loop
  update public.workspace_monitoring_requirements set status='superseded',revision=revision+1 where id=r.id;
  update public.workspace_followup_work set status='superseded',resolved_at=clock_timestamp() where requirement_id=r.id and status='open';
  insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label,note) values(r.id,'superseded',p_actor,label,'workflow.reset');
 end loop;
 delete from public.workspace_monitoring_decisions where requirement_id in(select id from public.workspace_monitoring_requirements where case_id=p_id);
 return v;
end $$;
revoke all on function public.workspace_reset_review(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_reset_review(uuid,uuid,integer,jsonb) to service_role;

-- Every component of this snapshot uses one statement/MVCC snapshot.
create function public.workspace_monitoring_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'requirements',coalesce((select jsonb_agg(to_jsonb(r) order by r.starts_at desc,r.id) from public.workspace_monitoring_requirements r where r.case_id=p_id),'[]'),
 'readings',coalesce((select jsonb_agg(to_jsonb(m) order by m.measured_at,m.id) from public.workspace_accepted_readings m where m.case_id=p_id and exists(select 1 from public.workspace_monitoring_evidence e where e.reading_id=m.id)),'[]'),
 'evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.requirement_id,e.reading_id) from public.workspace_monitoring_evidence e where e.case_id=p_id),'[]'),
 'work',coalesce((select jsonb_agg(to_jsonb(w) order by w.due_at,w.requirement_id) from public.workspace_followup_work w where w.case_id=p_id),'[]'),
 'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.workspace_followup_events e join public.workspace_monitoring_requirements r on r.id=e.requirement_id where r.case_id=p_id),'[]'),
 'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at,l.requirement_id) from public.workspace_followup_review_links l where l.case_id=p_id),'[]'),
 'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.requirement_id) from public.workspace_monitoring_decisions d join public.workspace_monitoring_requirements r on r.id=d.requirement_id where r.case_id=p_id),'[]'))
$$;
revoke all on function public.workspace_monitoring_snapshot(uuid) from public,anon,authenticated,service_role;

create or replace function public.workspace_case_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('case',to_jsonb(c),'monitoring',public.workspace_monitoring_snapshot(c.id),
 'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from public.workspace_case_reports r where r.case_id=c.id),'[]'),
 'changes',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.draft_evidence_revision,-1)),'[]'),
 'reviewChanges',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.reviewed_evidence_revision,-1)),'[]'),
 'reviewTasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.opened_at desc,t.id) from public.workspace_review_tasks t where t.case_id=c.id),'[]'))
 from public.workspace_cases c where c.id=p_id and c.expires_at>now()
$$;

-- The plan publication event already notifies recipients. Retain the review
-- outcome in activity without sending a second publication notification.
create or replace function public.workspace_record_event(p_case uuid, p_kind text, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e bigint; d uuid; actor text; label text;
begin
 actor := coalesce(nullif(current_setting('noreon.actor',true),''),'system');
 label := coalesce(nullif(current_setting('noreon.actor_label',true),''),'System');
 insert into public.workspace_activity(case_id,kind,actor_id,actor_label,case_revision)
 values(p_case,p_kind,actor,label,p_revision) returning id into e;
 select assigned_doctor_id into d from public.workspace_cases where id=p_case;
 if p_kind in ('draft.saved','questionnaire.updated','review.published') then return; end if;
 insert into public.workspace_notifications(event_id,recipient)
 select e,'staff:'||user_id from public.workspace_staff where role='admin' and active and 'staff:'||user_id <> actor;
 if d is not null and 'staff:'||d <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'staff:'||d) on conflict do nothing;
 end if;
 if p_kind in ('assignment.changed','consultation.changed','appointment.changed','booking.changed','plan.published','review.no_change','workflow.reset','monitoring.created','monitoring.cancelled') and 'member:'||p_case <> actor then
 insert into public.workspace_notifications(event_id,recipient) values(e,'member:'||p_case) on conflict do nothing;
 end if;
end; $$;
