import { useTranslations } from 'next-intl'
import Link from 'next/link'

export default function HomePage() {
  const t = useTranslations()

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="container mx-auto px-4 py-6">
        <nav className="flex items-center justify-between">
          <div className="text-2xl font-bold text-blue-600">
            {t('common.appName')}
          </div>
          <div className="flex gap-4">
            <Link
              href="/auth/signin"
              className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              {t('nav.signIn')}
            </Link>
          </div>
        </nav>
      </header>

      <main className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-6 text-5xl font-bold text-gray-900">
            Get Expert Medical Second Opinions
          </h1>
          <p className="mb-8 text-xl text-gray-600">
            Connect with world-class specialists for written second opinions and optional video
            consultations
          </p>
          <div className="flex justify-center gap-4">
            <Link
              href="/auth/signup"
              className="rounded-md bg-blue-600 px-8 py-3 text-lg text-white hover:bg-blue-700"
            >
              {t('nav.signUp')}
            </Link>
            <Link
              href="/about"
              className="rounded-md border border-gray-300 px-8 py-3 text-lg text-gray-700 hover:bg-gray-50"
            >
              {t('nav.about')}
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-8 md:grid-cols-3">
          <div className="rounded-lg bg-white p-6 shadow-md">
            <h3 className="mb-3 text-xl font-semibold">Submit Your Case</h3>
            <p className="text-gray-600">
              Upload your medical records, test results, and imaging for secure review
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-md">
            <h3 className="mb-3 text-xl font-semibold">Expert Review</h3>
            <p className="text-gray-600">
              A verified specialist reviews your case and provides a detailed second opinion
            </p>
          </div>
          <div className="rounded-lg bg-white p-6 shadow-md">
            <h3 className="mb-3 text-xl font-semibold">Get Your Opinion</h3>
            <p className="text-gray-600">
              Receive a comprehensive written opinion with optional video consultation
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
