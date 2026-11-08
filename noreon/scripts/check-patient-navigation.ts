import assert from 'node:assert/strict';
import { patientDestination } from '@/lib/patient/navigation';
for (const [path, expected] of [
 ['/patient/dashboard','home'], ['/patient/progress','progress'],
 ['/patient/health','progress'], ['/patient/health/monitor','progress'],
 ['/patient/measurements/new','progress'], ['/patient/results','progress'],
 ['/patient/reports','progress'], ['/patient/team','team'],
 ['/patient/care','plan'],
 ['/patient/service','plan'], ['/patient/account/messages','me'],
 ['/patient/health/profile','me'], ['/patient/profile','me'], ['/patient/questions','me'],
 ['/patient/zoe','zoe'], ['/patient/zoe/urgent','zoe'],
 // Gohar QA 110: sub-pages highlight the tab they are opened from.
 ['/patient/medicines','plan'], ['/patient/review','plan'], ['/patient/learn/x','plan'],
 ['/patient/progress/earlier','progress'], ['/patient/results/history','progress'], ['/patient/documents/x','progress'],
 ['/patient/bp-week','progress'], ['/patient/bp-week/record','progress'],
 ['/patient/account/reminders','me'], ['/patient/telegram-link','me'],
] as const) assert.equal(patientDestination(path), expected, path);
console.log('Patient destinations preserve detail links and health-profile ownership.');
