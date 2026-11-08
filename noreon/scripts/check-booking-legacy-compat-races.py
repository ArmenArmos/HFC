# Actual cross-path compatibility schedules; explicitly owned selected scratch only.
import subprocess,os,json,pathlib,time,threading
from fixtures.clinic_db_target import clinic_sql_target
target=clinic_sql_target(os.environ)
assert target['ci'] or os.environ.get('NOREON_COMPAT_DB_GRANTED')=='true'
ROOT=pathlib.Path(__file__).resolve().parents[1]
log=open(os.environ['NOREON_COMPAT_RACE_LOG'],'x',buffering=1)
env=os.environ.copy()
if not target['ci']:env['DOCKER_HOST']='unix:///Users/khikardanielyan/.colima/noreon-settings-qa/docker.sock'
class DB:
 def __init__(self,name):
  self.name=name;self.p=subprocess.Popen(['docker','exec','-i',target['container'],'sh','-c','exec psql "$@" 2>&1','sh','-U','postgres','-d',target['database'],'-X','-qAt'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  self.q('\\set VERBOSITY verbose\nset statement_timeout=15000;')
 def q(self,s):
  log.write(self.name+' SQL '+s+'\n');self.p.stdin.write(s+"\n\\echo __END__\n");self.p.stdin.flush();r=[]
  while True:
   line=self.p.stdout.readline()
   if not line:raise RuntimeError('Connection ended')
   log.write(self.name+' '+line)
   if line.strip()=='__END__':break
   r.append(line.strip())
  return '\n'.join(r)
 def close(self):
  if self.p.poll() is None:self.p.stdin.write('rollback;\n\\q\n');self.p.stdin.flush();self.p.wait(timeout=20)
def uid(n):return 'c4640000-0000-4000-8000-'+str(n).zfill(12)
def lit(o):return "'"+json.dumps(o,separators=(',',':')).replace("'","''")+"'::jsonb"
def setup(c,has_case):
 s=(ROOT/'scripts/check-booking-email.sql').read_text().split('select public.select_booking_appointment(')[0]
 s='\n'.join(l for l in s.splitlines() if not l.startswith('select pg_temp.email_assert(') and not l.startswith('select pg_temp.email_reject('))
 s=s.replace('b2000000','c4640000').replace('create function pg_temp.','create or replace function pg_temp.')
 if not has_case:s='\n'.join(l for l in s.splitlines() if not l.startswith('insert into public.patient_clinical_cases'))
 s+='\nreset role;commit;'
 out=c.q(s);assert 'ERROR:' not in out,out
 return json.loads(c.q('select program from email_ctx;')),json.loads(c.q('select offer from email_offer;'))
def cleanup(c):
 # Exact own synthetic metadata only, after both writer transactions have ended.
 s="begin;set local session_replication_role=replica;"
 for table,col in [('booking_appointment_events','appointment_id'),('booking_appointment_versions','appointment_id'),('booking_scheduling_notices','appointment_id'),('booking_legacy_conversions','appointment_id'),('booking_appointment_commands','member_id'),('booking_manual_reservations','member_id'),('booking_appointments','member_id'),('booking_program_seals','member_id'),('patient_test_request_events','request_id'),('patient_test_requests','user_id'),('patient_clinical_case_events','user_id'),('patient_clinical_cases','user_id'),('workspace_staff','user_id'),('workspace_clinics','id'),('patient_assessments','user_id'),('patient_consents','user_id'),('profiles','id')]:
  s+="delete from public."+table+" where "+col+"::text like 'c4640000%';"
 # Capacity keys are structured; bind through own offer UUID before deleting offer.
 s+="delete from public.booking_manual_capacity where key in(select capacity_key from public.booking_offer_snapshots where id::text like 'c4640000%');delete from public.booking_offer_snapshots where id::text like 'c4640000%';"
 s+="delete from auth.sessions where user_id::text like 'c4640000%';delete from auth.users where id::text like 'c4640000%';set local session_replication_role=origin;commit;drop table if exists email_ctx,email_offer;"
 out=c.q(s);assert 'ERROR:' not in out,out
A=DB('A');B=DB('B');C=DB('C');owned=False
try:
 assert C.q("select count(*)from supabase_migrations.schema_migrations where version='20261016061002';")=='1'
 assert C.q("select count(*)from auth.users where id::text like 'c4640000%';")=='0'
 prior=C.q('select to_jsonb(s) from public.workspace_scheduling_settings s;')
 for has_case in [False,True]:
  for first in ['legacy','pilot']:
   for outcome in ['commit','rollback']:
    program,offer=setup(C,has_case);owned=True
    terms={'startsAt':offer['startsAt'],'timezone':'Asia/Yerevan','mode':'clinic','location':'Synthetic requested location'}
    requirements=[{k:i[k] for k in ['id','title','method']} for i in program['items'] if i['method'] in ['lab','clinic']]
    legacy="select public.create_patient_test_request('"+uid(1)+"','"+uid(40)+"','"+program['sourceToken']+"',"+lit(terms)+","+lit(requirements)+",'synthetic-engine-v1');"
    pilot="select public.select_booking_appointment('"+uid(20)+"','"+uid(1)+"','"+uid(1)+"','"+uid(20)+"','"+uid(30)+"','source-v1',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic schedule',p_text_content=>'Synthetic approved content only');"
    firstsql=legacy if first=='legacy' else pilot;secondsql=pilot if first=='legacy' else legacy
    ar=A.q("set application_name='compat-c464-a';begin;set local role service_role;"+firstsql);assert 'ERROR:' not in ar,ar
    results=[];t=threading.Thread(target=lambda:results.append(B.q("set application_name='compat-c464-b';begin;set local role service_role;"+secondsql)));t.start()
    # Missing-case INSERT can wait on first enrollment; existing case is NOWAIT.
    for _ in range(20):
     if not t.is_alive():break
     wait=C.q("select wait_event_type||'|'||wait_event from pg_stat_activity where application_name='compat-c464-b';")
     if wait=='Lock|transactionid':break
     time.sleep(.025)
    A.q(outcome+';');t.join(5);assert not t.is_alive(),'Cross-path wait exceeded bounded schedule'
    result=results[0]
    if 'ERROR:' in result:
     assert any(code in result for code in ['55P03','40001']),result
     B.q('rollback;')
     # Controlled test retry after conclusive rollback, never application auto-retry.
     result=B.q('begin;set local role service_role;'+secondsql)
    if outcome=='commit':
     assert '40001' in result,result;B.q('rollback;');winner=first
    else:
     assert 'ERROR:' not in result,result;B.q('commit;');winner='pilot' if first=='legacy' else 'legacy'
    A.q('reset role;');B.q('reset role;')
    for table,col,count in [('patient_test_requests','user_id',int(winner=='legacy')),('patient_test_request_events','request_id',int(winner=='legacy')),('booking_appointments','member_id',int(winner=='pilot')),('booking_scheduling_notices','appointment_id',int(winner=='pilot')),('booking_manual_reservations','member_id',int(winner=='pilot'))]:
     actual=C.q("select count(*)from public."+table+" where "+col+"::text like 'c4640000%';");assert actual==str(count),(table,actual,count)
    assert C.q("select count(*)from public.patient_clinical_case_events where user_id='"+uid(1)+"'and kind='enrolled';")==('0' if has_case else '1')
    cleanup(C);owned=False
 # Restore only fixture-modified singleton fields, not schema or unrelated rows.
 row=json.loads(prior);C.q("update public.workspace_scheduling_settings set copy_email="+("null" if row['copy_email'] is None else "'"+row['copy_email'].replace("'","''")+"'")+",revision="+str(row['revision'])+" where id;")
 assert C.q("select count(*)from auth.users where id::text like 'c4640000%';")=='0'
 print('PASS8 cross-path schedules: both orders/commit/rollback/first enrollment, no dual authorities or orphan request/notice/reservation/enrollment')
finally:
 A.close();B.close()
 if owned:cleanup(C)
 C.close();log.close()
