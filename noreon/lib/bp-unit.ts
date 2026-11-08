import type {Locale} from '@/lib/locale';

/** Display only: stored readings and their units remain unchanged. */
export const bpUnit=(locale:Locale):string=>({en:'mmHg',hy:'մմ ս.ս.',ru:'мм рт. ст.'})[locale];
