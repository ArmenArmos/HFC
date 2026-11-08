import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../web',testMatch:['plan-ready-card.spec.ts'],outputDir:'/tmp/noreon-plan-ready-browser-results',workers:1,retries:0,timeout:90_000,reporter:'list',use:{locale:'en-GB',timezoneId:'Asia/Yerevan'},projects:[{name:'webkit',use:{browserName:'webkit'}}]});
