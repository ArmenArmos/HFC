import type { Locale } from '@/lib/locale';

const codes = new Set(['invalid_file', 'invalid_provenance', 'invalid', 'duplicate', 'report_limit', 'daily_limit', 'rate_limited', 'unauthorized', 'not_found', 'conflict', 'upload_failed', 'cleanup_pending', 'not_ready', 'unavailable']);
export function reportFailureCode(value: unknown): string {
  return typeof value === 'string' && codes.has(value) ? value : 'unavailable';
}

export function reportFailureMessage(value: unknown, locale: Locale): string {
  const t = (en: string, hy: string, ru: string) => locale === 'ru' ? ru : locale === 'hy' ? hy : en;
  switch (reportFailureCode(value)) {
    case 'invalid_file': return t('Use a readable PDF of up to 10 pages, JPEG or PNG, no larger than 2 MB.', 'Ընտրեք ընթեռնելի PDF՝ մինչև 10 էջ, JPEG կամ PNG՝ առավելագույնը 2 ՄԲ։', 'Выберите читаемый PDF до 10 страниц, JPEG или PNG размером не более 2 МБ.');
    case 'duplicate': return t('This file is already uploaded. You can find it in your report history below.', 'Այս ֆայլն արդեն վերբեռնված է։ Այն կարող եք գտնել ստորև՝ հետազոտությունների պատմությունում։', 'Этот файл уже загружен. Вы найдёте его в истории документов ниже.');
    case 'report_limit': return t('This case already has 10 reports. Remove a report you no longer need before adding another.', 'Այս դեպքն արդեն ունի 10 հետազոտություն։ Նորը ավելացնելուց առաջ հեռացրեք այլևս չպահանջվող փաստաթուղթը։', 'В этом случае уже есть 10 документов. Перед добавлением нового удалите документ, который больше не нужен.');
    case 'daily_limit': return t('Today’s processing limit has been reached. Try again tomorrow.', 'Այսօրվա մշակման սահմանաչափը սպառվել է։ Փորձեք վաղը։', 'Достигнут дневной лимит обработки. Попробуйте завтра.');
    case 'rate_limited': return t('Please wait a moment before trying again.', 'Խնդրում ենք մի փոքր սպասեք՝ կրկին փորձելուց առաջ։', 'Подождите немного, прежде чем попробовать снова.');
    case 'unauthorized': return t('Your session is unavailable. Reload the page and try again.', 'Ձեր մուտքն անհասանելի է։ Վերաբեռնեք էջը և փորձեք կրկին։', 'Ваша сессия недоступна. Обновите страницу и попробуйте снова.');
    case 'not_found': return t('This case is unavailable or has expired.', 'Այս դեպքն անհասանելի է կամ ժամկետանց է։', 'Этот случай недоступен или срок его действия истёк.');
    case 'conflict': return t('This report changed. Refresh the page before trying again.', 'Այս հետազոտությունը փոխվել է։ Կրկին փորձելուց առաջ թարմացրեք էջը։', 'Этот документ изменился. Обновите страницу, прежде чем попробовать снова.');
    case 'not_ready': return t('Wait for your report history to load, then try again.', 'Սպասեք հետազոտությունների պատմության բեռնմանը, ապա փորձեք կրկին։', 'Дождитесь загрузки истории документов и попробуйте снова.');
    case 'invalid_provenance': return t('This upload could not be verified. Select the file again and retry.', 'Այս վերբեռնումը չհաջողվեց հաստատել։ Կրկին ընտրեք ֆայլը և փորձեք։', 'Не удалось проверить эту загрузку. Выберите файл заново и повторите попытку.');
    case 'cleanup_pending': return t('This report is being removed. Please refresh the page shortly.', 'Այս փաստաթուղթը հեռացվում է։ Մի փոքր անց թարմացրեք էջը։', 'Этот документ удаляется. Обновите страницу через некоторое время.');
    default: return t('Your report could not be saved. Please try again.', 'Ձեր հետազոտությունը չհաջողվեց պահպանել։ Խնդրում ենք փորձեք կրկին։', 'Не удалось сохранить ваш документ. Попробуйте снова.');
  }
}
