-- BC-04: "Add a medicine I take" could store the medicine twice. The server stored it, the reply was lost, the form said
-- to try again, and a second tap added a second row, so the reminders doubled too.
--
-- The form now sends one request id per set of values, and a repeat of an id the member already used answers as the first
-- time did, with the same row, however often it comes. The check is under the per-member lock the add already takes, so a
-- retry that overtakes a slow first request waits for it. It comes before the 20-medicine limit: a replay adds nothing,
-- so a full list must not refuse it. The same id with other values is refused, never stored.
--
-- A row made by editing a medicine's times (member_medicine_update) carries no request id, and member_medicines keeps no
-- direct grants, so the column is only ever read here. p_request_id defaults to null so the app still live while this
-- migration applies keeps adding, as before, until its deploy lands.

alter table public.member_medicines add column request_id uuid;
create unique index member_medicines_request on public.member_medicines(user_id,request_id)where request_id is not null;

drop function public.member_medicine_add(text,text,time[]);
-- Add one self-reported medicine. {status:'added',id} | {status:'conflict'} | {status:'invalid'} | {status:'limit'} | {status:'disabled'}.
create function public.member_medicine_add(p_name text,p_dose text,p_times time[],p_request_id uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();mid uuid;prior public.member_medicines;ts time[];
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 if p_name is null or length(btrim(p_name))not between 1 and 120 or(p_dose is not null and length(btrim(p_dose))>120)
  or not public._member_medicine_times_ok(p_times)then return jsonb_build_object('status','invalid');end if;
 ts:=(select array_agg(t order by t)from unnest(p_times)t);
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
 if(select count(*)from public.member_medicines where user_id=uid and stopped_at is null)>=20 then return jsonb_build_object('status','limit');end if;
 insert into public.member_medicines(user_id,name,dose,times,started_on,request_id)
  values(uid,btrim(p_name),nullif(btrim(p_dose),''),ts,(clock_timestamp()at time zone 'Asia/Yerevan')::date,p_request_id)
  returning id into mid;
 return jsonb_build_object('status','added','id',mid);
end$$;
revoke all on function public.member_medicine_add(text,text,time[],uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_medicine_add(text,text,time[],uuid)to authenticated;
