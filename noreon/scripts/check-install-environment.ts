import assert from 'node:assert/strict';
import { chromeIntentUrl, detectInstallEnvironment as detect, installDismissed } from '@/lib/patient/install-environment';
const iphoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const iphoneChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const androidTelegram = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Telegram-Android/12.1.1 (Google Pixel 8; Android 14; SDK 34; HIGH)';
const androidWebView = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36';
const instagramIos = iphoneSafari.replace('Safari/604.1', 'Instagram 400.0.0.0 (iPhone16,2; iOS 18_6)');
const desktopChrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

assert.deepEqual(detect({ userAgent: iphoneSafari }), { surface: 'ios', os: 'ios' });
assert.deepEqual(detect({ userAgent: iphoneChrome }), { surface: 'ios', os: 'ios' }, 'iOS Chrome also adds from Share');
assert.deepEqual(detect({ userAgent: ipad, maxTouchPoints: 5 }), { surface: 'ios', os: 'ios' }, 'iPadOS reports a Mac user agent');
assert.deepEqual(detect({ userAgent: ipad, maxTouchPoints: 0 }), { surface: 'desktop', os: 'other' }, 'A real Mac is desktop');
assert.deepEqual(detect({ userAgent: androidChrome }), { surface: 'android', os: 'android' });
assert.deepEqual(detect({ userAgent: desktopChrome }), { surface: 'desktop', os: 'other' });
assert.deepEqual(detect({ userAgent: iphoneSafari, telegramBridge: true }), { surface: 'telegram', os: 'ios' }, 'iOS Telegram is found by its bridge, not its user agent');
assert.deepEqual(detect({ userAgent: androidTelegram }), { surface: 'telegram', os: 'android' });
assert.deepEqual(detect({ userAgent: androidChrome, telegramBridge: true }), { surface: 'telegram', os: 'android' });
assert.deepEqual(detect({ userAgent: androidWebView }), { surface: 'in-app', os: 'android' });
assert.deepEqual(detect({ userAgent: instagramIos }), { surface: 'in-app', os: 'ios' });
assert.deepEqual(detect({ userAgent: iphoneSafari, standalone: true, telegramBridge: true }), { surface: 'installed', os: 'ios' }, 'Installed wins over every other signal');
assert.deepEqual(detect({ userAgent: androidChrome, standalone: true }), { surface: 'installed', os: 'android' });

assert.equal(chromeIntentUrl('https://app.noreon.health/patient/dashboard?locale=hy#x'), 'intent://app.noreon.health/patient/dashboard?locale=hy#Intent;scheme=https;package=com.android.chrome;end');
assert.equal(chromeIntentUrl('http://localhost:3000/patient'), 'intent://localhost:3000/patient#Intent;scheme=http;package=com.android.chrome;end');
assert.equal(chromeIntentUrl('javascript:alert(1)'), null);
assert.equal(chromeIntentUrl('not a url'), null);

const now = Date.UTC(2026, 9, 17);
assert.equal(installDismissed(null, now), false);
assert.equal(installDismissed('garbage', now), false);
assert.equal(installDismissed(String(now + 1), now), true);
assert.equal(installDismissed(String(now - 1), now), false, 'The 14 days run out');
console.log('Install environment detection passed.');
