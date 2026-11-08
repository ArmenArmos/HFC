import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

type Config = { production: boolean; vercel: boolean; secret: string };
/**
 * The caller's network bucket from Vercel's own client-address header: an IPv4 address, or an
 * IPv6 /64 (one subscriber's prefix). Vercel's edge sets x-vercel-forwarded-for itself, so a
 * client-sent X-Forwarded-For or X-Real-IP never reaches this. Null for anything malformed.
 */
export function networkPrefix(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? '';
  if (!isIP(raw) || raw.includes('%')) return null;
  if (isIP(raw) === 4) return raw;
  const address = new URL(`http://[${raw}]/`).hostname.slice(1,-1);
  // Canonicalize IPv4-mapped IPv6 to the same bucket as native IPv4.
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(address);
  if (mapped) {
    const hi=parseInt(mapped[1],16), lo=parseInt(mapped[2],16);
    return [hi>>8,hi&255,lo>>8,lo&255].join('.');
  }
  const [left,right] = address.split('::');
  const a=left ? left.split(':') : [], b=right ? right.split(':') : [];
  const words=right === undefined ? a : [...a,...Array(8-a.length-b.length).fill('0'),...b];
  return words.slice(0,4).map(word=>parseInt(word,16).toString(16)).join(':')+'::/64';
}
export function admissionIdentity(headers: Pick<Headers,'get'>, config: Config, email?: string) {
  if (config.secret.length < 32) throw new Error('admission_unavailable');
  let address = 'local-development';
  if (config.vercel) {
    const prefix = networkPrefix(headers.get('x-vercel-forwarded-for'));
    if (!prefix) throw new Error('admission_unavailable');
    address = prefix;
  } else if (config.production) throw new Error('admission_unavailable');
  const hash=(kind:string,value:string)=>createHmac('sha256',config.secret).update(`${kind}:${value}`).digest('hex');
  const normalized=email?.trim().toLowerCase();
  if (email !== undefined && (!normalized || normalized.length>320)) throw new Error('admission_unavailable');
  return {source:hash('source',address),email:normalized ? hash('email',normalized) : undefined};
}
