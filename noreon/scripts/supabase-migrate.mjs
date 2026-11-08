import { spawnSync } from 'node:child_process';
import { poolerDbUrl } from './supabase-db-url.mjs';
const args = process.argv.slice(2);
const url = poolerDbUrl();
if (url) args.push('--db-url', url);
const result = spawnSync('pnpm', ['supabase', ...args], {stdio:'inherit', env:process.env});
process.exit(result.status ?? 1);
