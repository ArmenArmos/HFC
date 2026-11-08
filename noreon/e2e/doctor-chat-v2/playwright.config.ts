import {defineConfig} from '@playwright/test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export default defineConfig({testDir:'../web',testMatch:['doctor-chat-v2.spec.ts','doctor-patient-graphs.spec.ts','doctor-find-member.spec.ts'],outputDir:join(tmpdir(),'noreon-doctor-chat-v2-browser-results'),workers:1,retries:0,timeout:90_000,expect:{timeout:15_000},reporter:'list',use:{locale:'en-GB',timezoneId:'Asia/Yerevan',screenshot:'only-on-failure',trace:'retain-on-failure'},projects:[{name:'webkit',use:{browserName:'webkit'}}]});
