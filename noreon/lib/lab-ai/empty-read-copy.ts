import {pick,type Locale} from '@/lib/locale';
/** A completed read with no values needs a next step, including before identity confirmation. */
export const labEmptyReadMessage=(locale:Locale)=>pick(locale,{
 en:'No values could be read from this file. Open the PDF and enter them, or ask the clinic for a clearer copy.',
 hy:'Այս ֆայլից ոչ մի արժեք հնարավոր չեղավ կարդալ։ Բացեք PDF-ը և մուտքագրեք դրանք, կամ խնդրեք կլինիկային ավելի հստակ պատճեն տրամադրել։',
 ru:'Не удалось прочитать показатели из этого файла. Откройте PDF и внесите их вручную или попросите клинику предоставить более чёткую копию.',
});
