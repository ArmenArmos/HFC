# Two real DB connections; explicit grant, no stack start or migration application.
import subprocess,os,json,pathlib,time,threading,sys
P=pathlib.Path(__file__).resolve().parent/'fixtures/clinic-admin-race'
from fixtures.clinic_db_target import clinic_sql_target
target=clinic_sql_target(os.environ)
assert target['ci'] or os.environ.get('NOREON_ADMIN_DB_GRANTED')=='true'
mode=sys.argv[1];assert mode in ['red','green'];assert not target['ci'] or mode=='green'
log=open(os.environ.get('NOREON_ADMIN_RACE_LOG','/tmp/clinic-admin-race-'+mode+'.log'),'x',buffering=1)
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
def clean(c):
 s=c.q((P/'cleanup.sql').read_text());assert 'ERROR:' not in s,s
A=DB('A');B=DB('B');C=DB('C');owned=False
try:
 assert C.q("select count(*)from supabase_migrations.schema_migrations where version='20261016061000';")=='1'
 assert C.q("select count(*)from supabase_migrations.schema_migrations where version='20261016061001';")==('0' if mode=='red' else '1')
 assert C.q("select count(*)from auth.users where id::text like 'c462%';")=='0'
 baseline_b240=C.q("select count(*)from auth.users where id::text like 'b240%';")
 for order in ['commit','rollback']:
  r=C.q((P/'setup.sql').read_text());assert 'ERROR:' not in r,r;owned=True
  assert 'committed' in A.q((P/'a.sql').read_text())
  response=[]
  t=threading.Thread(target=lambda:response.append(B.q((P/'b.sql').read_text())));t.start()
  if mode=='red':
   wait=''
   for _ in range(40):
    wait=C.q("select wait_event_type||'|'||wait_event from pg_stat_activity where application_name='clinic-admin-c462-b';")
    if wait=='Lock|transactionid':break
    time.sleep(.05)
   assert wait=='Lock|transactionid',wait
   A.q(order+';');t.join(10);assert not t.is_alive()
   if order=='commit':assert '23505' in response[0] and 'clinic_portal_memberships_user_id_clinic_id_key' in response[0],response;B.q('rollback;')
   else:assert 'committed' in response[0],response;B.q('commit;')
  else:
   t.join(2);assert not t.is_alive(),'Grant blocked instead of bounded conflict'
   assert '"reason": "conflict"' in response[0] and '"noWrite": true' in response[0],response
   B.q('commit;');A.q(order+';')
   retry=B.q((P/'b.sql').read_text())
   assert ('"reason": "conflict"' if order=='commit' else '"status": "committed"') in retry,retry
   B.q('commit;')
  r=C.q((P/'inspect.sql').read_text());assert 'ERROR:' not in r,r
  for table,where in [('clinic_portal_memberships',"clinic_id='c4620000-0000-4000-8000-000000000021'"),('clinic_admin_commands',"actor_id='c4620000-0000-4000-8000-000000000001'"),('clinic_portal_audit',"clinic_id='c4620000-0000-4000-8000-000000000021'")]:assert C.q('select count(*)from public.'+table+' where '+where+';')=='1'
  A.q('rollback;reset role;');B.q('rollback;reset role;');clean(C);owned=False
 assert C.q("select count(*)from auth.users where id::text like 'c462%';")=='0'
 assert C.q("select count(*)from auth.users where id::text like 'b240%';")==baseline_b240
 print(('REPRODUCED RED' if mode=='red' else 'PASS GREEN')+' same-target grant commit and rollback schedules; single membership/receipt/audit; fixtures clean')
finally:
 A.close();B.close()
 if owned:clean(C)
 C.close();log.close()
