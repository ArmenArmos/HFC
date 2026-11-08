import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';

export function EmptyStaffChat({locale}:{locale:Locale}){
 return <div className="zk w-full"><ZoeTurn locale={locale} say={[st(locale,
  'Nothing needs your attention right now. You can ask me anything.',
  'Այս պահին ոչինչ ձեր ուշադրության կարիքը չունի։ Կարող եք ինձ ցանկացած հարց տալ։',
  'Сейчас ничто не требует вашего внимания. Вы можете задать мне любой вопрос.',
 )]}/></div>;
}
