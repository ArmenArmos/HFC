-- Nurse visit flow (Khikar, 18 Oct): the nurse's visits list, one action list per visit, a step
-- timeline, and "Complete visit". Design: output/nurse-visit-flow-2026-10-18/DESIGN.md.
--
-- A visit is an arranged visit for one of the nurse's assigned members:
--   source 'home-request': a confirmed (or completed) home request in patient_test_requests;
--   source 'appointment' : a confirmed slot booking in booking_appointments.
-- Action items are built from data: a sample per ordered lab test, the BP reading (weight and
-- waist when that measurement is ordered), the assigned BP monitor, and the protocol checklist
-- (versioned rows, 'protocol-draft-1', derived from the protocols for Armen's sign-off:
-- output/nurse-visit-flow-2026-10-18/CHECKLIST.md). Each item takes an optional comment that the
-- doctor and the admin see and the member never does.
-- Steps (nurse taps, timestamped): confirmed, started, samples-collected, samples-at-lab, completed.
-- Each step belongs to the visit time it was recorded for; a rescheduled visit starts again.
-- Completing a visit records it through the existing visit-record path (patient_staff_visit_command:
-- open-visit, then append-evidence with the observations and, for a slot booking, one collection
-- entry per sample), completes a confirmed home request (the same event the auto-close writes),
-- counts a slot booking as attended, and keeps one completion row. "Samples handed to the lab" on a
-- slot-booking visit also records the existing at-lab stage of each collected sample.
-- No new member message is sent: the step templates are not approved (QUESTIONS Q-NV1).
-- Off until nurse_visit_settings.enabled is switched on.

-- 1. State -----------------------------------------------------------------------------------

create table public.nurse_visit_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 checklist_version text not null default 'protocol-draft-1',
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.nurse_visit_settings(singleton)values(true);

-- The protocol checklist. A clinical edit is a new version (rows plus the settings pointer), never
-- an update of rows a visit was ticked against. requires_test: null = every visit; '*lab' = at least
-- one lab sample ordered; otherwise the id of an ordered test.
create table public.nurse_visit_checklist(
 version text not null check(version~'^[a-z0-9-]{3,40}$'),
 id text not null check(id~'^[a-z0-9-]{1,60}$'),
 position integer not null,
 section text not null check(section in('bp','safety','sampling')),
 requires_test text check(requires_test is null or requires_test~'^(\*lab|[A-Za-z0-9._-]{1,100})$'),
 label_en text not null check(length(label_en)between 3 and 500),
 label_hy text not null check(length(label_hy)between 3 and 500),
 source text not null check(length(source)between 3 and 300),
 primary key(version,id),unique(version,position)
);
insert into public.nurse_visit_checklist(version,id,position,section,requires_test,label_en,label_hy,source)values
 ('protocol-draft-1','bp-validated-device',1,'bp',null,'Use a validated upper-arm blood pressure monitor and check that it works.','Օգտագործեք վավերացված բազկային ճնշաչափ և ստուգեք, որ այն աշխատում է։','Laboratory protocol v2, section 1 (BP confirmation)'),
 ('protocol-draft-1','bp-cuff-fit',2,'bp',null,'Use a cuff that fits the member''s arm.','Օգտագործեք անդամի թևին համապատասխան թևկապ։','Laboratory protocol v2, section 1 (BP confirmation)'),
 ('protocol-draft-1','bp-seated-rest',3,'bp',null,'The member is seated and rested before you measure, and you use the correct technique.','Չափելուց առաջ անդամը նստած է և հանգստացած, և կիրառվում է ճիշտ չափման տեխնիկա։','Laboratory protocol v2, section 1 (BP confirmation)'),
 ('protocol-draft-1','bp-conditions-medicines',4,'bp',null,'Note the measurement conditions and the medicines the member has taken.','Նշեք չափման պայմանները և անդամի ընդունած դեղերը։','Laboratory protocol v2, section 1 (BP confirmation)'),
 ('protocol-draft-1','urgent-symptoms',5,'safety',null,'Ask about chest pain, severe breathlessness, new neurological symptoms, confusion or sudden worsening of vision. If any is present, get urgent medical help now (call 103). Do not wait for tests or the app.','Հարցրեք կրծքավանդակի ցավի, ծանր շնչահեղձության, նոր նյարդաբանական ախտանիշների, գիտակցության խանգարման կամ տեսողության սուր վատացման մասին։ Դրանցից որևէ մեկի դեպքում անմիջապես կազմակերպեք շտապ բժշկական օգնություն (103)։ Մի սպասեք հետազոտություններին կամ հավելվածին։','Laboratory protocol v2, section 1 (urgency), paragraph 1'),
 ('protocol-draft-1','severe-bp-contact',6,'safety',null,'If repeated correct readings are systolic 180 or higher, or diastolic 110 or higher: with symptoms, call 103 now; without symptoms, contact the assigned doctor today.','Եթե կրկնակի ճիշտ չափմամբ սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 110 կամ ավելի. ախտանիշների դեպքում անմիջապես զանգահարեք 103, առանց ախտանիշների՝ այսօր կապվեք նշանակված բժշկի հետ։','Laboratory protocol v2, section 1 (urgency), paragraph 2'),
 ('protocol-draft-1','fasting-8h',7,'sampling','hba1c-glucose','Fasting glucose is ordered: confirm the member has had no food with calories for at least 8 hours.','Նշանակված է քաղցած գլյուկոզա. համոզվեք, որ անդամը առնվազն 8 ժամ կալորիական սնունդ չի ընդունել։','Laboratory protocol v2, section 3 (sampling rules), paragraph 1'),
 ('protocol-draft-1','uacr-first-morning',8,'sampling','urine-acr','For urine ACR, take the first morning urine where possible.','Մեզի ACR-ի համար նախընտրեք առաջին առավոտյան մեզը։','Laboratory protocol v2, section 3 (sampling rules), paragraph 2'),
 ('protocol-draft-1','uacr-confounders',9,'sampling','urine-acr','Note heavy exercise, fever, a urinary infection or menstruation, if present.','Նշեք ծանր ֆիզիկական ծանրաբեռնվածությունը, տենդը, միզուղիների վարակը կամ դաշտանը, եթե առկա են։','Laboratory protocol v2, section 3 (sampling rules), paragraph 2'),
 ('protocol-draft-1','sample-time-medicines',10,'sampling','*lab','Record the sample time and the medicines the member has taken, so they stay with the result.','Գրանցեք նմուշառման ժամը և անդամի ընդունած դեղերը, որպեսզի դրանք պահվեն արդյունքի հետ։','Laboratory protocol v2, section 3 (sampling rules), paragraph 2');

-- One row per tick change; the latest row per item is the item's state. note is the nurse's comment.
create table public.nurse_visit_marks(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 source text not null check(source in('home-request','appointment')),
 source_id uuid not null,
 item text not null check(item~'^(sample:[A-Za-z0-9._-]{1,100}|measure:(bp|weight|waist)|device:[0-9a-f-]{36}|check:[a-z0-9-]{1,60})$'),
 done boolean not null,
 note text check(note is null or length(note)between 1 and 1000),
 vals jsonb check(vals is null or jsonb_typeof(vals)='object'),
 checklist_version text,
 submission_id uuid not null,
 actor_id uuid not null references auth.users(id),
 actor_name text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(member_id,submission_id),
 check((item like 'check:%')=(checklist_version is not null))
);
create index nurse_visit_marks_visit on public.nurse_visit_marks(source,source_id,item,recorded_at desc,id);

-- The visit timeline: one row per step, each recorded once.
create table public.nurse_visit_events(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 source text not null check(source in('home-request','appointment')),
 source_id uuid not null,
 step text not null check(step in('confirmed','started','samples-collected','samples-at-lab','completed')),
 -- The visit time the step was recorded against: a rescheduled visit starts a fresh timeline (review F4).
 arrangement timestamptz not null,
 submission_id uuid not null,
 actor_id uuid not null references auth.users(id),
 actor_name text not null,
 actor_role text not null check(actor_role='nurse'),
 occurred_at timestamptz not null default clock_timestamp(),
 unique(source,source_id,step,arrangement),
 unique(member_id,submission_id)
);
create index nurse_visit_events_member on public.nurse_visit_events(member_id,occurred_at desc);

create table public.nurse_visit_completions(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 source text not null check(source in('home-request','appointment')),
 source_id uuid not null,
 visit_id uuid not null unique references public.patient_care_visits(id),
 submission_id uuid not null unique,
 command jsonb not null,
 reason text check(reason is null or length(reason)between 3 and 1000),
 summary jsonb not null,
 result jsonb not null,
 actor_id uuid not null references auth.users(id),
 actor_name text not null,
 completed_at timestamptz not null default clock_timestamp(),
 unique(source,source_id)
);
create index nurse_visit_completions_member on public.nurse_visit_completions(member_id,completed_at desc);

alter table public.nurse_visit_settings enable row level security;
alter table public.nurse_visit_checklist enable row level security;
alter table public.nurse_visit_marks enable row level security;
alter table public.nurse_visit_events enable row level security;
alter table public.nurse_visit_completions enable row level security;
revoke all on public.nurse_visit_settings,public.nurse_visit_checklist,public.nurse_visit_marks,public.nurse_visit_events,public.nurse_visit_completions
 from public,anon,authenticated,service_role;
create trigger nurse_visit_checklist_immutable before update or delete on public.nurse_visit_checklist for each row execute function public._patient_visit_immutable();
create trigger nurse_visit_marks_immutable before update or delete on public.nurse_visit_marks for each row execute function public._patient_visit_immutable();
create trigger nurse_visit_events_immutable before update or delete on public.nurse_visit_events for each row execute function public._patient_visit_immutable();
create trigger nurse_visit_completions_immutable before update or delete on public.nurse_visit_completions for each row execute function public._patient_visit_immutable();
create trigger nurse_visit_settings_config_audit after insert or update or delete on public.nurse_visit_settings for each row execute function public._config_audit_row('singleton','updated_at');

-- 2. Reading a visit -------------------------------------------------------------------------

create function public._nurse_visit_enabled()returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.nurse_visit_settings where singleton),false)
$$;
-- Whether to show the Visits navigation entry: true only for an active nurse or admin while the
-- switch is on (review F6). Says nothing else.
create function public.nurse_visit_navigation()returns boolean
language sql stable security definer set search_path=''as $$
 select public._nurse_visit_enabled()and auth.role()='authenticated'
  and exists(select 1 from public.workspace_staff where user_id=auth.uid()and role in('nurse','admin')and active and removed_at is null)
$$;

-- The visit header, or null when the source is not an arranged visit.
create function public._nurse_visit_row(p_source text,p_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare r public.patient_test_requests;a public.booking_appointments;arr jsonb;c public.nurse_visit_completions;m uuid;
begin
 if p_source='home-request'then
  select * into r from public.patient_test_requests where id=p_id;
  if not found or r.status not in('confirmed','completed')or r.current_arrangement#>>'{terms,mode}'is distinct from 'home'then return null;end if;
  -- Times are normalised so every row carries an offset (review F5).
  m:=r.user_id;arr:=jsonb_build_object('startsAt',to_jsonb((r.current_arrangement#>>'{terms,startsAt}')::timestamptz),'endsAt',to_jsonb((r.current_arrangement#>>'{terms,endsAt}')::timestamptz),
   'mode','home','location',r.current_arrangement#>>'{terms,location}','bookingStatus',r.status);
 elsif p_source='appointment'then
  select * into a from public.booking_appointments where id=p_id;
  if not found or a.status<>'confirmed'or a.current_arrangement is null or a.current_reservation_id is null then return null;end if;
  m:=a.member_id;arr:=jsonb_build_object('startsAt',to_jsonb((a.current_arrangement->>'startsAt')::timestamptz),'endsAt',to_jsonb((a.current_arrangement->>'endsAt')::timestamptz),
   'mode',a.current_arrangement->>'mode','location',a.current_arrangement->>'location',
   'clinic',(select k.name from public.workspace_clinics k where k.id=(a.current_arrangement->>'clinicId')::uuid),
   'bookingStatus',case when public._booking_visit_attended(a.current_reservation_id)then 'attended'else 'confirmed'end);
 else return null;end if;
 select * into c from public.nurse_visit_completions where source=p_source and source_id=p_id;
 return arr||jsonb_build_object('source',p_source,'id',p_id,'memberId',m,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=m),'Member'),
  'completion',case when c.id is null then null else jsonb_build_object('completedAt',c.completed_at,'nurseName',c.actor_name,'summary',c.summary)end);
end$$;

-- Every ordered test id of the visit (lab and clinic), with title and method.
create function public._nurse_visit_tests(p_source text,p_id uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select case when p_source='home-request'then
  (select coalesce(jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord),'[]')
   from public.patient_test_requests r,jsonb_array_elements(r.requirements)with ordinality as x(i,ord)where r.id=p_id)
 else
  (select coalesce(jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord),'[]')
   from public.booking_appointments a join public.booking_program_seals s on s.id=a.program_id,jsonb_array_elements(s.program->'items')with ordinality as x(i,ord)
   where a.id=p_id and coalesce(a.current_arrangement->'coveredTestIds','[]'::jsonb)?(i->>'id'))
 end
$$;

-- The action items, built from data only.
create function public._nurse_visit_items(p_source text,p_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid;tests jsonb;dev jsonb;checks jsonb;lab boolean;
begin
 m:=case when p_source='home-request'then(select user_id from public.patient_test_requests where id=p_id)else(select member_id from public.booking_appointments where id=p_id)end;
 if m is null then return '[]'::jsonb;end if;
 tests:=public._nurse_visit_tests(p_source,p_id);
 lab:=exists(select 1 from jsonb_array_elements(tests)t where t->>'method'='lab');
 select jsonb_build_object('key','device:'||g.id::text,'kind','device','assignmentId',g.id,'serial',d.serial,'model',d.model)into dev
  from public.bp_device_assignments g join public.bp_devices d on d.id=g.device_id where g.member_id=m and g.ended_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('key','check:'||c.id,'kind','check','checkId',c.id,'section',c.section,'version',c.version,
  'label',jsonb_build_object('en',c.label_en,'hy',c.label_hy),'source',c.source)order by c.position),'[]')into checks
  from public.nurse_visit_checklist c where c.version=(select checklist_version from public.nurse_visit_settings where singleton)
   and(c.requires_test is null or(c.requires_test='*lab'and lab)or exists(select 1 from jsonb_array_elements(tests)t where t->>'id'=c.requires_test));
 return(select coalesce(jsonb_agg(jsonb_build_object('key','sample:'||(t->>'id'),'kind','sample','testId',t->>'id','title',t->>'title')),'[]')
   from jsonb_array_elements(tests)t where t->>'method'='lab')
  ||jsonb_build_array(jsonb_build_object('key','measure:bp','kind','measurement','field','bp'))
  ||case when exists(select 1 from jsonb_array_elements(tests)t where t->>'id'='anthropometry')then
    jsonb_build_array(jsonb_build_object('key','measure:weight','kind','measurement','field','weight'),jsonb_build_object('key','measure:waist','kind','measurement','field','waist'))
   else '[]'::jsonb end
  ||case when dev is null then '[]'::jsonb else jsonb_build_array(dev)end
  ||checks;
end$$;

-- Each item with its latest tick. p_values: include measurement values (nurse and doctor only).
create function public._nurse_visit_items_marked(p_source text,p_id uuid,p_values boolean default true)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(i||jsonb_build_object('mark',(
  select jsonb_build_object('done',k.done,'note',k.note,'values',case when p_values then k.vals end,'recordedAt',k.recorded_at,'nurseName',k.actor_name)
  from public.nurse_visit_marks k where k.source=p_source and k.source_id=p_id and k.item=i->>'key'order by k.recorded_at desc,k.id desc limit 1))order by ord),'[]')
 from jsonb_array_elements(public._nurse_visit_items(p_source,p_id))with ordinality as x(i,ord)
$$;

create function public._nurse_visit_counts(p_items jsonb)returns jsonb
language sql immutable set search_path=''as $$
 select jsonb_build_object(
  'samplesPlanned',count(*)filter(where i->>'kind'='sample'),
  'samplesTaken',count(*)filter(where i->>'kind'='sample'and(i#>>'{mark,done}')='true'),
  'bpTaken',coalesce(bool_or(i->>'key'='measure:bp'and(i#>>'{mark,done}')='true'),false),
  'deviceDone',case when bool_or(i->>'kind'='device')then coalesce(bool_or(i->>'kind'='device'and(i#>>'{mark,done}')='true'),false)end,
  'openItems',coalesce(jsonb_agg(i->>'key')filter(where(i#>>'{mark,done}')is distinct from 'true'),'[]'))
 from jsonb_array_elements(p_items)i
$$;

-- The visit's arranged start, the key its steps are recorded against.
create function public._nurse_visit_arrangement(p_source text,p_id uuid)returns timestamptz
language sql stable security definer set search_path=''as $$
 select(public._nurse_visit_row(p_source,p_id)->>'startsAt')::timestamptz
$$;
-- The timeline of the current arrangement, in step order. p_names: who recorded each step (staff views).
create function public._nurse_visit_events(p_source text,p_id uuid,p_names boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('step',e.step,'at',e.occurred_at)
  ||case when p_names then jsonb_build_object('by',e.actor_name)else '{}'::jsonb end
  order by array_position(array['confirmed','started','samples-collected','samples-at-lab','completed'],e.step)),'[]')
 from public.nurse_visit_events e where e.source=p_source and e.source_id=p_id and e.arrangement=public._nurse_visit_arrangement(p_source,p_id)
$$;
create function public._nurse_visit_has_step(p_source text,p_id uuid,p_step text)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.nurse_visit_events e where e.source=p_source and e.source_id=p_id and e.step=p_step and e.arrangement=public._nurse_visit_arrangement(p_source,p_id))
$$;

-- The signed-in active nurse with a current session, or an access refusal.
create function public._nurse_visit_nurse()returns public.workspace_staff
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff;sid uuid;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 select * into s from public.workspace_staff where user_id=auth.uid()and role='nurse'and active and removed_at is null;
 if not found or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=s.user_id and(not_after is null or not_after>clock_timestamp()))
  or not public._real_staff_managed_session_allowed(s.user_id)then raise insufficient_privilege;end if;
 return s;
exception when invalid_text_representation then raise insufficient_privilege;
end$$;

create function public._nurse_visit_is_admin()returns boolean
language sql stable security definer set search_path=''as $$
 select auth.role()='authenticated'and exists(select 1 from public.workspace_staff where user_id=auth.uid()and role='admin'and active and removed_at is null)
  and public._real_staff_managed_session_allowed(auth.uid())
$$;

-- Nurse: today's, upcoming, overdue (14 days) and recently done (7 days) visits of the nurse's
-- members. Admin: the same window for every member, with the assigned nurse and the timeline.
create function public.nurse_visit_list()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare actor uuid;admin boolean:=public._nurse_visit_is_admin();today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
begin
 if admin then actor:=null;else actor:=(public._nurse_visit_nurse()).user_id;end if;
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false,'visits','[]'::jsonb);end if;
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'today',today,'role',case when admin then 'admin'else 'nurse'end,'visits',coalesce((
  select jsonb_agg(v||(select jsonb_build_object('samplesPlanned',c->'samplesPlanned','samplesTaken',c->'samplesTaken','openItems',jsonb_array_length(c->'openItems'))
   from public._nurse_visit_counts(public._nurse_visit_items_marked(v->>'source',(v->>'id')::uuid,false))c)
   ||jsonb_build_object('steps',public._nurse_visit_events(v->>'source',(v->>'id')::uuid,true),
    'nurseName',(select ws.display_name from public.patient_clinical_cases pc join public.workspace_staff ws on ws.user_id=pc.assigned_nurse_id where pc.user_id=(v->>'memberId')::uuid))
   order by v->>'startsAt',v->>'id')
  from(
   select public._nurse_visit_row('home-request',r.id)v from public.patient_test_requests r join public.patient_clinical_cases pc on pc.user_id=r.user_id
    where(admin or pc.assigned_nurse_id=actor)and r.status in('confirmed','completed')and r.current_arrangement#>>'{terms,mode}'='home'
   union all
   select public._nurse_visit_row('appointment',a.id)from public.booking_appointments a join public.patient_clinical_cases pc on pc.user_id=a.member_id
    where(admin or pc.assigned_nurse_id=actor)and a.status='confirmed'and a.current_arrangement is not null and a.current_reservation_id is not null
  )x
  where v is not null and(admin or public.staff_care_access((v->>'memberId')::uuid,actor,true))
   and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date between today-14 and today+60
   and(v->'completion'='null'::jsonb or((v#>>'{completion,completedAt}')::timestamptz at time zone 'Asia/Yerevan')::date>=today-7)),'[]'::jsonb));
end$$;

create function public.nurse_visit_detail(p_member uuid,p_source text,p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare v jsonb;items jsonb;c public.nurse_visit_completions;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._nurse_visit_nurse();
 perform public._patient_visit_authorize(p_member,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false);end if;
 v:=public._nurse_visit_row(p_source,p_id);
 if v is null or(v->>'memberId')::uuid is distinct from p_member then raise insufficient_privilege;end if;
 items:=public._nurse_visit_items_marked(p_source,p_id);
 select * into c from public.nurse_visit_completions where source=p_source and source_id=p_id;
 perform public._access_audit_record(p_member,'member_nurse_visit',p_id::text);
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'visit',v,'items',items,'counts',public._nurse_visit_counts(items),
  'steps',public._nurse_visit_events(p_source,p_id,true),'checklistVersion',(select checklist_version from public.nurse_visit_settings where singleton),
  'caseRevision',(select revision from public.patient_clinical_cases where user_id=p_member),
  'today',(clock_timestamp()at time zone 'Asia/Yerevan')::date,
  'completion',case when c.id is null then null else jsonb_build_object('completedAt',c.completed_at,'nurseName',c.actor_name,'reason',c.reason,'summary',c.summary,'visitId',c.visit_id)end);
exception when insufficient_privilege then return jsonb_build_object('version','nurse-visit-v1','status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('version','nurse-visit-v1','status','unavailable');
end$$;

-- 3. Ticking an item -------------------------------------------------------------------------

create function public._nurse_visit_number(v jsonb,lo numeric,hi numeric,whole boolean)returns boolean
language sql immutable set search_path=''as $$
 select jsonb_typeof(v)='number'and(v::text)::numeric between lo and hi and(not whole or(v::text)::numeric=trunc((v::text)::numeric))
$$;

-- Command: {version:'nurse-visit-v1',memberId,source,sourceId,submissionId,item,done,note,values}.
-- values only on a taken measurement: measure:bp {systolic,diastolic,pulse|null} with the
-- visit-evidence bounds; measure:weight {value} kg; measure:waist {value} cm.
create function public.nurse_visit_mark(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values']<>'{}'
  or jsonb_typeof(p_command->'done')is distinct from 'boolean'or jsonb_typeof(p_command->'item')is distinct from 'string'
  or jsonb_typeof(p_command->'note')not in('null','string')or jsonb_typeof(p_command->'values')not in('null','object')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';item:=p_command->>'item';done:=(p_command->>'done')::boolean;
 note:=nullif(btrim(p_command->>'note'),'');vals:=nullif(p_command->'values','null'::jsonb);
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or(note is not null and length(note)>1000)then return bad;end if;
 if item='measure:bp'and done then
  if vals is null or vals-array['systolic','diastolic','pulse']<>'{}'or not(vals?&array['systolic','diastolic','pulse'])
   or not public._nurse_visit_number(vals->'systolic',60,300,true)or not public._nurse_visit_number(vals->'diastolic',30,200,true)
   or(vals->>'systolic')::numeric<=(vals->>'diastolic')::numeric
   or(vals->'pulse'<>'null'::jsonb and not public._nurse_visit_number(vals->'pulse',20,250,true))then return bad;end if;
 elsif item in('measure:weight','measure:waist')and done then
  if vals is null or vals-array['value']<>'{}'or not public._nurse_visit_number(vals->'value',case when item='measure:weight'then 20 else 30 end,case when item='measure:weight'then 400 else 250 end,false)then return bad;end if;
 elsif vals is not null then return bad;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_marks where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.item<>item or prior.done<>done or prior.note is distinct from note or prior.vals is distinct from vals or prior.actor_id<>s.user_id then
   return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','markId',prior.id,'submissionId',sub,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 select i->>'version'into cv from jsonb_array_elements(public._nurse_visit_items(src,sid))i where i->>'key'=item;
 if not found then return jsonb_build_object('status','stale');end if;
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name)
  values(m,src,sid,item,done,note,vals,cv,sub,s.user_id,s.display_name)returning id into mid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','mark','source',src,'sourceId',sid,'item',item,'done',done,'commented',note is not null,'markId',mid,'submissionId',sub));
 return jsonb_build_object('status','saved','markId',mid,'submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- 4. Steps and completion --------------------------------------------------------------------

create function public._nurse_visit_iso(t timestamptz)returns text
language sql immutable set search_path=''as $$select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$$;

-- "Samples handed to the lab" on a booking-linked visit record: the existing at-lab stage of each
-- current collected sample, through the existing lab stage command (same session, same nurse).
create function public._nurse_visit_sync_lab(p_member uuid,p_visit uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path=''as $$
declare e public.patient_care_visit_entries;res jsonb;
begin
 for e in select * from public.patient_care_visit_entries x where x.user_id=p_member and x.visit_id=p_visit and x.payload->>'kind'='collection'and x.payload->>'outcome'='collected'
  and public._patient_lab_current_collection(x)and not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=x.id and s.stage='at-lab')order by x.position loop
  res:=public.patient_staff_lab_stage_command(jsonb_build_object('version','lab-stage-v1','id',p_member,'submissionId',gen_random_uuid(),'entryId',e.id,'stage','at-lab',
   'occurredAt',public._nurse_visit_iso(greatest(p_at,e.observed_instant))));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Lab stage was not saved';end if;
 end loop;
end$$;

create function public._nurse_visit_record_step(p_member uuid,p_source text,p_id uuid,p_step text,p_submission uuid,p_actor public.workspace_staff)returns uuid
language plpgsql security definer set search_path=''as $$
declare eid uuid;r bigint;
begin
 insert into public.nurse_visit_events(member_id,source,source_id,step,arrangement,submission_id,actor_id,actor_name,actor_role)
  values(p_member,p_source,p_id,p_step,public._nurse_visit_arrangement(p_source,p_id),p_submission,p_actor.user_id,p_actor.display_name,'nurse')returning id into eid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=p_member returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(p_member,r,'care-evidence',p_actor.user_id,jsonb_build_object('nurseVisit','step','step',p_step,'source',p_source,'sourceId',p_id,'eventId',eid,'submissionId',p_submission));
 return eid;
end$$;

-- Command: {version:'nurse-visit-v1',memberId,source,sourceId,submissionId,step}. Steps: confirmed
-- (any time before completion), started and samples-collected (on or after the visit day, before
-- completion; samples-collected needs a sample ticked taken), samples-at-lab (after samples-collected,
-- also after completion). "completed" is recorded by nurse_visit_complete only.
create function public.nurse_visit_step(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;st text;s public.workspace_staff;v jsonb;prior public.nurse_visit_events;eid uuid;vid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','step'])or p_command-array['version','memberId','source','sourceId','submissionId','step']<>'{}'
  or coalesce(p_command->>'step','')not in('confirmed','started','samples-collected','samples-at-lab')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';st:=p_command->>'step';
 if src not in('home-request','appointment')or m is null or sid is null or sub is null then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_events where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.step<>st or prior.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','eventId',prior.id,'submissionId',sub,'occurredAt',prior.occurred_at,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 select * into prior from public.nurse_visit_events where source=src and source_id=sid and step=st and arrangement=(v->>'startsAt')::timestamptz;
 if found then return jsonb_build_object('status','already-recorded','occurredAt',prior.occurred_at);end if;
 if v->'completion'<>'null'::jsonb and st<>'samples-at-lab'then return jsonb_build_object('status','completed');end if;
 if st in('started','samples-collected')and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 if st='samples-collected'and not exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid))i where i->>'kind'='sample'and i#>>'{mark,done}'='true')then
  return jsonb_build_object('status','no-samples');end if;
 if st='samples-at-lab'and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  return jsonb_build_object('status','no-samples');end if;
 -- A completed slot-booking visit hands over the current samples it recorded; none is refused (review F1).
 select visit_id into vid from public.nurse_visit_completions where source=src and source_id=sid;
 if st='samples-at-lab'and src='appointment'and vid is not null and not exists(select 1 from public.patient_care_visit_entries x
  where x.user_id=m and x.visit_id=vid and x.payload->>'kind'='collection'and x.payload->>'outcome'='collected'
  and public._patient_lab_current_collection(x))then
  -- Only current samples count: a later "not collected" correction supersedes an earlier entry (Codex F1 re-check).
  return jsonb_build_object('status','no-lab-entries');end if;
 eid:=public._nurse_visit_record_step(m,src,sid,st,sub,s);
 if st='samples-at-lab'and vid is not null then perform public._nurse_visit_sync_lab(m,vid,clock_timestamp());end if;
 return jsonb_build_object('status','saved','eventId',eid,'submissionId',sub,'occurredAt',(select occurred_at from public.nurse_visit_events where id=eid),'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;

-- Command: {version:'nurse-visit-v1',memberId,source,sourceId,submissionId,visitId,openSubmissionId,
-- appendSubmissionId,reason}. A reason (3 to 1000 characters) is required when any item is not ticked done.
create function public.nurse_visit_complete(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;vid uuid;oid uuid;aid uuid;reason text;s public.workspace_staff;v jsonb;items jsonb;counts jsonb;
 prior public.nurse_visit_completions;rq public.patient_test_requests;b jsonb;booking jsonb;res jsonb;entries jsonb:='[]';i jsonb;bp public.nurse_visit_marks;k public.nurse_visit_marks;
 stamp text:=public._nurse_visit_iso(clock_timestamp());result jsonb;r bigint;canonical jsonb;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason'])
  or p_command-array['version','memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason']<>'{}'
  or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  vid:=(p_command->>'visitId')::uuid;oid:=(p_command->>'openSubmissionId')::uuid;aid:=(p_command->>'appendSubmissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';reason:=nullif(btrim(p_command->>'reason'),'');
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or vid is null or oid is null or aid is null
  or oid=aid or(reason is not null and length(reason)not between 3 and 1000)then return bad;end if;
 canonical:=jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb));
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse();
 s:=public._patient_visit_authorize(m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_completions where source=src and source_id=sid;
 if found then
  if prior.submission_id=sub and prior.command=canonical and prior.actor_id=s.user_id then return prior.result||jsonb_build_object('replayed',true);end if;
  return jsonb_build_object('status','completed');
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 -- A visit is completed on or after its arranged day, never ahead of it.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 items:=public._nurse_visit_items_marked(src,sid);counts:=public._nurse_visit_counts(items);
 if jsonb_array_length(counts->'openItems')>0 and reason is null then return jsonb_build_object('status','reason-required','openItems',counts->'openItems');end if;
 -- 1. The home request closes first, so the auto-close trigger on the visit insert finds nothing to do.
 if src='home-request'then
  select * into rq from public.patient_test_requests where id=sid and user_id=m for update nowait;
  if rq.status='confirmed'then
   update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=sid;
   insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
    values(sid,sub,s.user_id,rq.revision+1,'completed-by-visit',jsonb_build_object('visitId',vid,'nurseVisit',true),jsonb_build_object('status','completed'));
  end if;
 else
  -- A slot booking needs its current booking context, or its samples cannot be recorded against
  -- the booking. The nurse is told to check the booking instead of completing silently (review F1).
  b:=public._patient_visit_booking(m,sid);
  if b->>'availability'is distinct from 'available'then return jsonb_build_object('status','booking-stale');end if;
  booking:=jsonb_build_object('appointmentId',sid,'acceptedRevision',(b#>>'{context,acceptedRevision}')::numeric);
 end if;
 -- 2. The visit record, through the existing nurse visit command.
 res:=public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','open-visit','id',m,'visitId',vid,'submissionId',oid,
  'revision',(select revision from public.patient_clinical_cases where user_id=m),'booking',coalesce(booking,'null'::jsonb)));
 if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit open was not saved';end if;
 select x.* into bp from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item='measure:bp'order by x.recorded_at desc,x.id desc limit 1;
 if bp.done then
  entries:=entries||jsonb_build_array(
   jsonb_build_object('kind','observation','field','systolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'systolic')::int,'unit','mmHg'),
   jsonb_build_object('kind','observation','field','diastolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'diastolic')::int,'unit','mmHg'))
   ||case when bp.vals->'pulse'<>'null'::jsonb then jsonb_build_array(jsonb_build_object('kind','observation','field','pulse','observedAt',public._nurse_visit_iso(bp.recorded_at),
    'state','known','value',(bp.vals->>'pulse')::int,'unit','beats/min'))else '[]'::jsonb end;
 end if;
 for k in select distinct on(x.item)x.* from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item in('measure:weight','measure:waist')order by x.item,x.recorded_at desc,x.id desc loop
  if k.done then entries:=entries||jsonb_build_array(jsonb_build_object('kind','observation','field',substr(k.item,9),'observedAt',public._nurse_visit_iso(k.recorded_at),
   'state','known','value',(k.vals->'value'),'unit',case when k.item='measure:weight'then 'kg'else 'cm'end));end if;
 end loop;
 if booking is not null then
  for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
   and exists(select 1 from jsonb_array_elements(b#>'{context,tests}')t where t->>'id'=x->>'testId')loop
   entries:=entries||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','collection','observedAt',coalesce(public._nurse_visit_iso((i#>>'{mark,recordedAt}')::timestamptz),stamp),
    'appointmentId',sid,'acceptedRevision',booking->'acceptedRevision','testId',i->>'testId',
    'outcome',case when i#>>'{mark,done}'='true'then 'collected'when i->'mark'is not null and i->'mark'<>'null'::jsonb then 'not-collected'else 'unknown'end,
    'reason',case when i#>>'{mark,done}'='true'then null else coalesce(i#>>'{mark,note}',reason)end)));
  end loop;
 end if;
 if reason is not null then entries:=entries||jsonb_build_array(jsonb_build_object('kind','note','observedAt',stamp,'text',reason));end if;
 if jsonb_array_length(entries)>0 then
  res:=public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id',m,'visitId',vid,'submissionId',aid,
   'revision',(select revision from public.patient_clinical_cases where user_id=m),'entries',entries));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit evidence was not saved';end if;
 end if;
 -- 3. The completion, which also counts a slot booking as attended (_booking_visit_attended).
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'summary',counts,'replayed',false);
 insert into public.nurse_visit_completions(member_id,source,source_id,visit_id,submission_id,command,reason,summary,result,actor_id,actor_name)
  values(m,src,sid,vid,sub,canonical,reason,counts,result,s.user_id,s.display_name);
 -- 4. The timeline: samples collected (if taken and not tapped), completed; samples already handed
 -- to the lab get their lab stages now that the collection entries exist.
 if(counts->>'samplesTaken')::int>0 and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 perform public._nurse_visit_record_step(m,src,sid,'completed',sub,s);
 if public._nurse_visit_has_step(src,sid,'samples-at-lab')then
  perform public._nurse_visit_sync_lab(m,vid,(select max(occurred_at)from public.nurse_visit_events where source=src and source_id=sid and step='samples-at-lab'));
 end if;
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;

-- A nurse completion counts as attended, like a clinic arrival or linked results. Same as
-- 20261017204237 plus the third condition.
create or replace function public._booking_visit_attended(p_reservation uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select p_reservation is not null and(
  exists(select 1 from public.clinic_booking_checkins k where k.reservation_id=p_reservation and k.outcome='completed')
  or(select k.outcome from public.clinic_booking_checkins k where k.reservation_id=p_reservation order by k.id desc limit 1)='arrived'
  or exists(select 1 from public.nurse_visit_completions c join public.booking_appointments a on a.id=c.source_id
   where c.source='appointment'and a.current_reservation_id=p_reservation))
$$;

-- 5. Doctor, admin and member reads ----------------------------------------------------------

-- The member's nurse visits with their timeline, items, comments and completion reason, for the
-- assigned doctor or nurse (with measurement values) and the admin (comments, no values).
create function public.nurse_visit_record(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare admin boolean:=public._nurse_visit_is_admin();
begin
 perform set_config('lock_timeout','1500ms',true);
 if not admin then perform public._patient_visit_authorize(p_member,false,false);end if;
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false,'visits','[]'::jsonb);end if;
 perform public._access_audit_record(p_member,'member_nurse_visit_record',null);
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'visits',coalesce((select jsonb_agg(jsonb_build_object(
   'visit',public._nurse_visit_row(x.source,x.source_id),
   'steps',public._nurse_visit_events(x.source,x.source_id,true),
   'items',public._nurse_visit_items_marked(x.source,x.source_id,not admin),
   'completion',(select jsonb_build_object('completedAt',c.completed_at,'nurseName',c.actor_name,'reason',c.reason,'summary',c.summary)
    from public.nurse_visit_completions c where c.source=x.source and c.source_id=x.source_id))order by x.last desc)
  from(select source,source_id,max(at)last from(
    select source,source_id,recorded_at at from public.nurse_visit_marks where member_id=p_member
    union all select source,source_id,occurred_at from public.nurse_visit_events where member_id=p_member)y group by source,source_id)x
  where public._nurse_visit_row(x.source,x.source_id)is not null),'[]'::jsonb));
exception when insufficient_privilege then return jsonb_build_object('version','nurse-visit-v1','status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('version','nurse-visit-v1','status','unavailable');
end$$;

-- Member: the latest nurse visit with a recorded step since the latest published plan. Steps only
-- (the nurse's arrival is not shown), no names, comments or values.
create function public.patient_member_nurse_visit()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();e public.nurse_visit_events;c public.nurse_visit_completions;v jsonb;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','visit',null);end if;
 select * into e from public.nurse_visit_events x where x.member_id=m
  and x.occurred_at>coalesce((select max(published_at)from public.patient_clinical_publications where user_id=m),'-infinity'::timestamptz)
  and x.arrangement=public._nurse_visit_arrangement(x.source,x.source_id)
  order by x.occurred_at desc limit 1;
 if not found then return jsonb_build_object('version','nurse-visit-v1','visit',null);end if;
 v:=public._nurse_visit_row(e.source,e.source_id);
 select * into c from public.nurse_visit_completions where source=e.source and source_id=e.source_id;
 return jsonb_build_object('version','nurse-visit-v1','visit',jsonb_build_object('startsAt',v->>'startsAt','mode',v->>'mode',
  'steps',(select coalesce(jsonb_agg(s)filter(where s->>'step'<>'started'),'[]')from jsonb_array_elements(public._nurse_visit_events(e.source,e.source_id,false))s),
  'completedAt',c.completed_at,'samplesTaken',c.summary->'samplesTaken','samplesPlanned',c.summary->'samplesPlanned'));
end$$;

revoke all on function public._nurse_visit_enabled(),public.nurse_visit_navigation(),public._nurse_visit_row(text,uuid),public._nurse_visit_tests(text,uuid),public._nurse_visit_items(text,uuid),
 public._nurse_visit_items_marked(text,uuid,boolean),public._nurse_visit_counts(jsonb),public._nurse_visit_events(text,uuid,boolean),public._nurse_visit_nurse(),
 public._nurse_visit_arrangement(text,uuid),public._nurse_visit_has_step(text,uuid,text),
 public._nurse_visit_is_admin(),public._nurse_visit_number(jsonb,numeric,numeric,boolean),public._nurse_visit_iso(timestamptz),
 public._nurse_visit_sync_lab(uuid,uuid,timestamptz),public._nurse_visit_record_step(uuid,text,uuid,text,uuid,public.workspace_staff),
 public.nurse_visit_list(),public.nurse_visit_detail(uuid,text,uuid),public.nurse_visit_mark(jsonb),public.nurse_visit_step(jsonb),public.nurse_visit_complete(jsonb),
 public.nurse_visit_record(uuid),public.patient_member_nurse_visit()from public,anon,authenticated,service_role;
grant execute on function public.nurse_visit_navigation(),public.nurse_visit_list(),public.nurse_visit_detail(uuid,text,uuid),public.nurse_visit_mark(jsonb),public.nurse_visit_step(jsonb),
 public.nurse_visit_complete(jsonb),public.nurse_visit_record(uuid),public.patient_member_nurse_visit()to authenticated;
