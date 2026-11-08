import {defineConfig} from '@playwright/test';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export default defineConfig({testDir:'../web',testMatch:'chat-v2-voice.spec.ts',outputDir:join(tmpdir(),'noreon-voice-results'),workers:1,retries:0,timeout:60_000,expect:{timeout:10_000},reporter:'list',projects:[{name:'webkit',use:{browserName:'webkit'}}]});
