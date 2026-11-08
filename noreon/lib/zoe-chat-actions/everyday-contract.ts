/** App-only views carried by the existing menu card. No new storage kind or clinical logic. */
export const EVERYDAY_VIEWS = ['bp_week', 'earlier', 'result_history', 'previous_plans', 'lessons', 'answers', 'team', 'help'] as const;
export type EverydayView = typeof EVERYDAY_VIEWS[number];
export const isEverydayView = (value: unknown): value is EverydayView =>
  typeof value === 'string' && (EVERYDAY_VIEWS as readonly string[]).includes(value);
export const MEMBER_CARD_TARGETS=['visit','medicines','account','plan','bp',...EVERYDAY_VIEWS] as const;
export type MemberCardTarget=typeof MEMBER_CARD_TARGETS[number];
export const isMemberCardTarget=(value:unknown):value is MemberCardTarget=>
  typeof value==='string'&&(MEMBER_CARD_TARGETS as readonly string[]).includes(value);
/** Existing page links inside embedded progress/care content open the same cards. Classic is an explicit exit. */
export function memberCardTarget(href:string|null):MemberCardTarget|null {
  if(!href?.startsWith('/patient/'))return null;
  const url=new URL(href,'https://noreon.invalid');
  if(url.searchParams.get('view')==='classic')return null;
  if(url.pathname==='/patient/zoe'){
    const key=url.searchParams.get('card');return isMemberCardTarget(key)?key:null;
  }
  // Keep editing a particular upload and result trends on their existing routes.
  if(url.searchParams.has('edit')||url.searchParams.get('view')==='trends'||url.searchParams.get('section')==='trends')return null;
  const pages:Record<string,MemberCardTarget>={
    '/patient/bp-week':'bp_week','/patient/progress/earlier':'earlier','/patient/results/history':'result_history',
    '/patient/review':'previous_plans','/patient/care':'plan','/patient/learn':'lessons',
    '/patient/health/profile':'answers','/patient/team':'team','/patient/help':'help','/patient/measurements/new':'bp',
  };
  return pages[url.pathname]??null;
}
export const EVERYDAY_TITLE = {
  bp_week: {en: 'Your blood pressure week', hy: 'Ձեր ճնշման շաբաթը', ru: 'Ваша неделя давления'},
  earlier: {en: 'Add earlier results', hy: 'Ավելացնել նախկին արդյունքներ', ru: 'Добавить предыдущие результаты'},
  result_history: {en: 'Your result history', hy: 'Ձեր արդյունքների պատմությունը', ru: 'История ваших результатов'},
  previous_plans: {en: 'Previous plans and sources', hy: 'Նախորդ պլաններն ու աղբյուրները', ru: 'Предыдущие планы и источники'},
  lessons: {en: 'Your lessons', hy: 'Ձեր դասերը', ru: 'Ваши уроки'},
  answers: {en: 'Your answers', hy: 'Ձեր պատասխանները', ru: 'Ваши ответы'},
  team: {en: 'Your care team', hy: 'Ձեր խնամքի թիմը', ru: 'Ваша медицинская команда'},
  help: {en: 'Get help', hy: 'Օգնություն', ru: 'Получить помощь'},
} as const;
