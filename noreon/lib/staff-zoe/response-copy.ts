import {st} from '@/lib/staff/staff-locale-copy';
import type {L} from './contracts';

export const staffZoeRefusal=(code:string,locale:L)=>code==='access'?st(locale,'You do not have access to this member now.','Այս պահին այս անդամի տվյալներին հասանելիություն չունեք։','Сейчас у вас нет доступа к этому участнику.'):code==='busy'?st(locale,'Zoe is still on your last question.','Զոյան դեռ զբաղված է ձեր վերջին հարցով։','Zoe ещё работает над предыдущим вопросом.'):st(locale,'That did not go through. Try again.','Չստացվեց։ Փորձեք նորից։','Не получилось. Попробуйте ещё раз.');
export const staffZoeReading=(locale:L)=>st(locale,'Zoe is reading the record…','Զոյան կարդում է գրառումը…','Zoe читает запись…');
