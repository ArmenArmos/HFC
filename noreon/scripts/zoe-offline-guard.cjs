// Network guard for the offline Zoe audits (T1, C1; Codex 20-21 Oct): --require it to make any socket, DNS or fetch call throw.
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload (node --require) */
const {syncBuiltinESMExports}=require('node:module');
const deny=()=>{throw Error('T1 offline guard: network forbidden');};
for(const name of ['node:net','node:tls']){const m=require(name);for(const k of ['connect','createConnection'])if(m[k])m[k]=deny;if(m.Socket)m.Socket.prototype.connect=deny;}
for(const name of ['node:http','node:https','node:http2','node:dgram','node:dns']){const m=require(name);for(const k of ['request','get','connect','createSocket','lookup','resolve'])if(m[k])m[k]=deny;}
globalThis.fetch=deny;globalThis.WebSocket=class{constructor(){deny();}};
syncBuiltinESMExports();
