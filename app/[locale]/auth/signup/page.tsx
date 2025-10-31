import { SignUpForm } from '@/components/auth/sign-up-form'

export default function SignUpPage({ params: { locale } }: { params: { locale: string } }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-blue-50 to-white px-4 py-8">
      <SignUpForm locale={locale} />
    </div>
  )
}
