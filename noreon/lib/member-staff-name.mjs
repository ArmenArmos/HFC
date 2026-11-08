/**
 * Staff attribution shown to members. Keep real display names, hide whole-word placeholders.
 * Plain JavaScript is shared with the native app's Node checks without a TypeScript loader.
 * @param {string | null | undefined} name
 */
export function memberStaffName(name) {
  const value = name?.trim();
  return !value || /(?<![\p{L}\p{N}_])(?:staging|test)(?![\p{L}\p{N}_])/iu.test(value) ? null : value;
}

/**
 * Anonymous doctor attribution in member screens and cards.
 * @param {string | null | undefined} name
 * @param {'en' | 'hy' | 'ru'} language
 */
export const memberDoctorLabel = (name, language) =>
  memberStaffName(name) ?? {en: 'Your doctor', hy: 'Ձեր բժիշկը', ru: 'Ваш врач'}[language];
