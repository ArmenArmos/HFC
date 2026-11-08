import assert from 'node:assert/strict';
import {realReviewEnabled} from '../lib/patient-care/real-review-config';
const enabled={NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://real.supabase.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-test-key'};
assert.equal(realReviewEnabled(enabled),true);
for(const overrides of [{NOREON_REAL_MEMBER_REVIEW_ENABLED:'false'},{NOREON_SHARED_DEMO:'true'},{NEXT_PUBLIC_SUPABASE_URL:''},{NOREON_WORKSPACE_SUPABASE_URL:'https://other.supabase.test'},{NOREON_WORKSPACE_SUPABASE_URL:'invalid'}])assert.equal(realReviewEnabled({...enabled,...overrides}),false,JSON.stringify(overrides));
assert.equal(realReviewEnabled({...enabled,NOREON_WORKSPACE_SUPABASE_URL:'https://real.supabase.test/'}),true);
console.log('Real review mode and same-auth-domain checks pass.');
