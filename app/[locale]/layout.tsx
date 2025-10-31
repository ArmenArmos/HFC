import { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { locales } from '@/i18n'
import { SessionProvider } from '@/components/auth/session-provider'

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode
  params: { locale: string }
}) {
  // Validate locale
  if (!locales.includes(locale as any)) {
    notFound()
  }

  // Fetch messages for the current locale
  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <SessionProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
          </NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
