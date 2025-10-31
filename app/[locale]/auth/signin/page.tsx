import { SignInForm } from '@/components/auth/sign-in-form'
import { useTranslations } from 'next-intl'

export default function SignInPage({ params: { locale } }: { params: { locale: string } }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4">
      <SignInForm locale={locale} />
    </div>
  )
}
