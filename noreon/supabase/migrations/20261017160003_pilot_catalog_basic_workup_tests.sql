-- The hypertension basic workup (decision tree v1.1 P176, lab catalogue NRN-LAB-CAT-001
-- sections A.3, A.4 and B.1) adds five tests to lib/clinical/seed/tests.ts: urine ACR,
-- urinalysis, potassium, sodium and a full blood count. Booked items find their price
-- by test key, so each one needs a catalogue row here.
--
-- Davidyants has still not supplied its price list (output/PENDING_QUESTIONS.md), so
-- every price below is fictional and marked 'staging-placeholder', like the first seed
-- in 20261017095207. A key an administrator already created is left untouched.
do $$
declare t uuid;r record;
begin
 for r in select * from(values
  ('urine-acr','STG-ACR-01','Urine albumin to creatinine ratio (ACR)','Միզի ալբումին/կրեատինին հարաբերություն (ACR)',5000),
  ('urinalysis','STG-UA-01','Urinalysis','Մեզի ընդհանուր հետազոտություն',2000),
  ('potassium','STG-K-01','Potassium','Կալիում',2000),
  ('sodium','STG-NA-01','Sodium','Նատրիում',2000),
  ('cbc-hb','STG-CBC-01','Full blood count','Արյան ընդհանուր հետազոտություն',3000)
 )as v(test_key,code,name_en,name_hy,price)loop
  continue when exists(select 1 from public.pilot_catalog_tests where test_key=r.test_key or partner_code=r.code);
  insert into public.pilot_catalog_tests(test_key,partner_code,name_en,name_hy,included_in_package,active_from)
   values(r.test_key,r.code,r.name_en,r.name_hy,false,date '2026-10-01')returning id into t;
  insert into public.pilot_catalog_prices(test_id,price_amd,price_source,effective_from,recorded_by_name,reason)
   values(t,r.price,'staging-placeholder',timestamptz '2026-10-01 00:00+04','Seed','STAGING placeholder; awaiting the Davidyants price list');
  insert into public.pilot_catalog_events(test_id,kind,actor_name,reason,detail)
   values(t,'created','Seed','STAGING placeholder; awaiting the Davidyants price list',jsonb_build_object('priceAmd',r.price,'source','staging-placeholder'));
 end loop;
end$$;
