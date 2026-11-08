"""Exact isolated targets; no connection, start, reset or shell interpolation."""
def clinic_sql_target(env):
    container=env.get('NOREON_TEST_DB_CONTAINER')
    database=env.get('NOREON_TEST_DB_NAME')
    ci=env.get('CI')=='true' and env.get('GITHUB_ACTIONS')=='true' and container=='supabase_db_noreon-core'
    owned=container=='supabase_db_noreon-clinic-settings-qa'
    if not owned and not ci:
        raise ValueError('Owned clinic QA or repository Actions CI database required')
    if (ci and database!='postgres') or (not ci and database not in ['postgres','noreon_clinic_selected_20261016']):
        raise ValueError('Explicit allowed NOREON_TEST_DB_NAME required')
    return {'container':container,'database':database,'ci':ci}
