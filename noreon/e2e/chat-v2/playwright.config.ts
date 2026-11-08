import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This fixture never loads the database-backed E2E specs or their credentials.
export default defineConfig({
  testDir:'../web',testMatch:['chat-v2.spec.ts','chat-v2-next-step.spec.ts','chat-v2-living-visit.spec.ts'],
  outputDir:join(tmpdir(),'noreon-chat-v2-browser-results'),
  workers:1,retries:0,timeout:90_000,expect:{timeout:15_000},reporter:'list',
  use:{locale:'en-GB',timezoneId:'Asia/Yerevan',screenshot:'only-on-failure',trace:'retain-on-failure'},
  projects:[{name:'webkit',use:{browserName:'webkit'}},{name:'chromium',use:{browserName:'chromium'}}],
});
