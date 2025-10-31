import { getRequestConfig } from 'next-intl/server'
import { notFound } from 'next/navigation'

// Supported locales
export const locales = ['en', 'hy', 'ru'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

export const localeNames: Record<Locale, string> = {
  en: 'English',
  hy: 'Հայերեն',
  ru: 'Русский',
}

export default getRequestConfig(async ({ locale }) => {
  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound()
  }

  return {
    messages: (await import(`./messages/${locale}.json`)).default,
  }
})
