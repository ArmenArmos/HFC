-- V3, app only: the version is the immutable identity of exactly what the doctor published.
-- Old acknowledgements are NOT teach-back, and nothing is backfilled as confirmed.
alter table public.patient_care_plan_versions add column teach_back_confirmed_at timestamptz;

-- Preserve every clinical/version field. The only permitted update is null -> first confirmation time.
create function public._patient_plan_version_confirmation_only()returns trigger
language plpgsql set search_path=''as $$
begin
 if tg_op='UPDATE' and old.teach_back_confirmed_at is null and new.teach_back_confirmed_at is not null
  and (to_jsonb(new)-'teach_back_confirmed_at')=(to_jsonb(old)-'teach_back_confirmed_at')then return new;end if;
 raise exception using errcode='23514',message='Published plan versions are immutable';
end$$;
drop trigger patient_care_plan_versions_immutable on public.patient_care_plan_versions;
create trigger patient_care_plan_versions_immutable before update or delete on public.patient_care_plan_versions
 for each row execute function public._patient_plan_version_confirmation_only();

-- Own current approved version only. No clinical draft, risk class, or staff identifiers.
create function public.zoe_v3_plan_state()returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('planId',v.plan_id,'version',v.version,'teachBackConfirmedAt',v.teach_back_confirmed_at)
 from public.patient_care_plan_versions v
 join public.patient_care_plans p on p.id=v.plan_id and p.user_id=v.user_id
 join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
 where v.user_id=auth.uid() and public._telegram_member_eligible(auth.uid())
  and p.active and p.published_at<=now() and c.published_at<=now()
$$;

-- Service adapter checks zoeAppV3Enabled before calling. Authenticated callers cannot invoke this.
-- Confirmation and its dialog receipt commit together. Lost responses replay both with the original time.
create function public.zoe_v3_plan_confirm(p_member uuid,p_card uuid,p_op uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;v public.patient_care_plan_versions;r jsonb;pid uuid;stamp timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or p_card is null or p_op is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if not public._telegram_member_eligible(p_member)then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Same lock as publication, before card/version locks: a replacement cannot race this confirmation.
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member for update;
 if not found or k.kind<>'plan' or not(k.snapshot?'v3')then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- A completed historical action remains replayable; it cannot activate the replacement version.
 if k.outcome?'plan'then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
 if k.state='done'then return jsonb_build_object('ok',false,'code','closed');end if;
 pid:=(k.snapshot#>>'{plan,id}')::uuid;
 perform 1 from public.patient_care_plans p join public.patient_clinical_publications c on c.plan_id=p.id and c.user_id=p.user_id
  where p.id=pid and p.user_id=p_member and p.active and p.published_at<=clock_timestamp() and c.published_at<=clock_timestamp() for share of p;
 if not found then return jsonb_build_object('ok',false,'code','stale');end if;
 select * into v from public.patient_care_plan_versions where plan_id=pid and user_id=p_member for update;
 if not found or k.snapshot#>>'{v3,planId}' is distinct from pid::text
  or k.snapshot#>>'{v3,version}' is distinct from v.version::text then return jsonb_build_object('ok',false,'code','stale');end if;
 r:=public.zoe_chat_card_claim(p_member,p_card,'plan',p_op,jsonb_build_object('planId',pid));
 if not coalesce((r->>'ok')::boolean,false)then return r;end if;
 stamp:=coalesce(v.teach_back_confirmed_at,clock_timestamp());
 if v.teach_back_confirmed_at is null then
  update public.patient_care_plan_versions set teach_back_confirmed_at=stamp where plan_id=pid;
 end if;
 r:=public.zoe_chat_card_record(p_member,p_card,'plan',jsonb_build_object('planId',pid,'confirmedAt',stamp),true);
 if not coalesce((r->>'ok')::boolean,false)then
  raise exception using errcode='40001',message='Plan confirmation receipt unavailable';
 end if;
 return r;
end$$;

revoke all on function public._patient_plan_version_confirmation_only(),public.zoe_v3_plan_state(),public.zoe_v3_plan_confirm(uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_v3_plan_state()to authenticated;
grant execute on function public.zoe_v3_plan_confirm(uuid,uuid,uuid)to service_role;
