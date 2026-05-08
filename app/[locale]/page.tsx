import { useTranslations } from 'next-intl'
import Link from 'next/link'

const SPECIALTIES = [
  'Cardiology', 'Oncology', 'Neurology', 'Orthopedics',
  'Gastroenterology', 'Pulmonology', 'Endocrinology', 'Radiology',
]

const HOW_IT_WORKS = [
  {
    step: 1,
    icon: '📋',
    title: 'Submit Your Case',
    desc: 'Complete our guided wizard: describe your symptoms, upload medical records (PDF, DICOM, lab reports), and choose your service tier.',
  },
  {
    step: 2,
    icon: '🔍',
    title: 'Expert Review',
    desc: 'A verified specialist reviews every document and provides a structured, evidence-based second opinion — delivered as a signed PDF.',
  },
  {
    step: 3,
    icon: '💬',
    title: 'Receive & Discuss',
    desc: 'Download your opinion, message your specialist with follow-up questions, or book an optional video consultation.',
  },
]

const PLANS = [
  {
    name: 'Standard',
    price: '$199',
    turnaround: '5–7 business days',
    features: [
      'Written opinion by board-certified specialist',
      'Diagnosis, rationale & treatment plan (PDF)',
      'Secure encrypted file upload (50 MB/file)',
      'Secure messaging with assigned specialist',
      'Reference clinical guidelines & literature',
    ],
  },
  {
    name: 'Express',
    price: '$349',
    turnaround: '1–3 business days',
    highlighted: true,
    features: [
      'Everything in Standard',
      'Priority queue assignment',
      'Faster turnaround for urgent decisions',
      'Progress notifications',
      'Optional video consultation add-on',
    ],
  },
]

const TESTIMONIALS = [
  {
    quote: 'After my initial diagnosis, I was terrified. The specialist confirmed the findings but suggested a less invasive treatment approach I hadn\'t considered. It gave me confidence and saved me from unnecessary surgery.',
    name: 'Maria K.',
    role: 'Patient — Orthopedic case',
  },
  {
    quote: 'Our employer plan lets every employee get a second opinion before major procedures. The platform is fast, secure, and our HR team loves the seamless invoicing.',
    name: 'Armen H.',
    role: 'HR Director, Technology Company',
  },
  {
    quote: 'The opinion was thorough and cited recent AHA guidelines I wasn\'t aware of. Exactly the level of detail I needed from a peer specialist.',
    name: 'Dr. N.S.',
    role: 'Referring Physician',
  },
]

const SECURITY_ITEMS = [
  { icon: '🔒', title: 'End-to-End Encryption', desc: 'Files encrypted in transit and at rest using AES-256.' },
  { icon: '🛡️', title: 'RBAC Access Control', desc: 'Role-based permissions — only your assigned doctor sees your files.' },
  { icon: '📋', title: 'Full Audit Trail', desc: 'Every access to your data is logged with timestamp and IP.' },
  { icon: '🗑️', title: 'Data Retention Rights', desc: 'Request export or deletion of all your data at any time.' },
]

export default function HomePage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-white/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-blue-600">MSO</span>
            <span className="hidden text-sm font-medium text-gray-500 sm:block">Medical Second Opinion</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 md:flex">
            <a href="#how-it-works" className="hover:text-gray-900">How It Works</a>
            <a href="#specialties" className="hover:text-gray-900">Specialties</a>
            <a href="#pricing" className="hover:text-gray-900">Pricing</a>
            <a href="#security" className="hover:text-gray-900">Security</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href={`/${locale}/auth/signin`} className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Sign In
            </Link>
            <Link
              href={`/${locale}/auth/signup`}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-20 md:py-28">
        <div className="container mx-auto px-4 text-center">
          <div className="mx-auto max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              Trusted by patients in 30+ countries
            </div>
            <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight text-gray-900 md:text-6xl">
              Expert Medical<br />
              <span className="text-blue-600">Second Opinions</span>
            </h1>
            <p className="mb-8 text-lg text-gray-600 md:text-xl">
              Connect with world-class board-certified specialists for a comprehensive written second opinion —
              delivered securely within days, not weeks.
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href={`/${locale}/auth/signup`}
                className="w-full rounded-xl bg-blue-600 px-8 py-3.5 text-base font-semibold text-white shadow-md hover:bg-blue-700 sm:w-auto transition-colors"
              >
                Start Your Case — $199
              </Link>
              <a
                href="#how-it-works"
                className="w-full rounded-xl border border-gray-300 px-8 py-3.5 text-base font-semibold text-gray-700 hover:bg-gray-50 sm:w-auto transition-colors"
              >
                See How It Works
              </a>
            </div>
            <p className="mt-4 text-xs text-gray-400">
              Available in English · Հայերեն · Русский &nbsp;·&nbsp; Secure & HIPAA-aligned
            </p>
          </div>
        </div>
      </section>

      {/* Social Proof Strip */}
      <div className="border-y bg-gray-50 py-6">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap items-center justify-center gap-8 text-center">
            <div>
              <p className="text-2xl font-extrabold text-gray-900">2,400+</p>
              <p className="text-xs text-gray-500">Cases Completed</p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-2xl font-extrabold text-gray-900">180+</p>
              <p className="text-xs text-gray-500">Board-Certified Specialists</p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-2xl font-extrabold text-gray-900">4.9 ★</p>
              <p className="text-xs text-gray-500">Average Patient Rating</p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <p className="text-2xl font-extrabold text-gray-900">&lt;48h</p>
              <p className="text-xs text-gray-500">Median Express Delivery</p>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <section id="how-it-works" className="py-20">
        <div className="container mx-auto px-4">
          <SectionHeader tag="Simple Process" title="How It Works" />
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="relative rounded-2xl border bg-white p-8 shadow-sm">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-2xl font-bold text-white">
                  {item.step}
                </div>
                <div className="mb-3 text-3xl">{item.icon}</div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Specialties */}
      <section id="specialties" className="bg-gray-50 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader tag="Our Network" title="20+ Medical Specialties" />
          <p className="mx-auto mt-4 max-w-xl text-center text-gray-600">
            Our verified specialists cover all major disciplines. Select the specialty that matches your
            condition when creating your case.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {SPECIALTIES.map((s) => (
              <span
                key={s}
                className="rounded-full border border-blue-200 bg-white px-4 py-1.5 text-sm font-medium text-blue-700 shadow-sm"
              >
                {s}
              </span>
            ))}
            <span className="rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-500">
              + 12 more
            </span>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="container mx-auto px-4">
          <SectionHeader tag="Transparent Pricing" title="Simple, Per-Case Pricing" />
          <p className="mx-auto mt-4 max-w-xl text-center text-gray-600">
            No subscriptions. No hidden fees. Pay only when you need an opinion.
            Organizations can access volume pricing and monthly invoicing.
          </p>
          <div className="mt-12 mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 ${
                  plan.highlighted
                    ? 'border-blue-600 bg-blue-600 text-white shadow-xl'
                    : 'border-gray-200 bg-white shadow-sm'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-0.5 text-xs font-bold text-amber-900">
                    Most Popular
                  </div>
                )}
                <div className="mb-1 text-sm font-semibold opacity-70">{plan.turnaround}</div>
                <div className="mb-2 text-4xl font-extrabold">{plan.price}</div>
                <div className="mb-6 text-lg font-semibold">{plan.name}</div>
                <ul className="space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 shrink-0 ${plan.highlighted ? 'text-blue-200' : 'text-green-500'}`}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/${locale}/auth/signup`}
                  className={`mt-8 block rounded-xl px-6 py-3 text-center text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? 'bg-white text-blue-600 hover:bg-blue-50'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  Get Started
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-gray-500">
            Need volume pricing for your organization?{' '}
            <a href="mailto:enterprise@example.com" className="text-blue-600 hover:underline">
              Contact us for B2B plans →
            </a>
          </p>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-gray-50 py-20">
        <div className="container mx-auto px-4">
          <SectionHeader tag="Patient Stories" title="Trusted by Patients & Employers" />
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="rounded-2xl border bg-white p-6 shadow-sm">
                <p className="mb-4 text-gray-600 italic">"{t.quote}"</p>
                <div>
                  <p className="font-semibold text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-20">
        <div className="container mx-auto px-4">
          <SectionHeader tag="Privacy & Security" title="Your Data is Protected" />
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl border bg-white p-6 shadow-sm">
                <div className="mb-3 text-3xl">{item.icon}</div>
                <h3 className="mb-2 font-semibold text-gray-900">{item.title}</h3>
                <p className="text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-600 py-16">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-extrabold text-white">
            Make an Informed Decision About Your Health
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-blue-100">
            Don't face a major medical decision alone. Get a second opinion from a world-class specialist
            — delivered securely to your inbox within days.
          </p>
          <Link
            href={`/${locale}/auth/signup`}
            className="inline-block rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-blue-600 shadow-md hover:bg-blue-50 transition-colors"
          >
            Start Your Case Today
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-gray-900 py-10 text-sm text-gray-400">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div>
              <span className="font-bold text-white">MSO</span> · Medical Second Opinion Platform
            </div>
            <div className="flex gap-6">
              <a href="#" className="hover:text-white">Terms of Service</a>
              <a href="#" className="hover:text-white">Privacy Policy</a>
              <a href="mailto:support@example.com" className="hover:text-white">Support</a>
            </div>
            <div>© {new Date().getFullYear()} MSO. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function SectionHeader({ tag, title }: { tag: string; title: string }) {
  return (
    <div className="text-center">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
        {tag}
      </div>
      <h2 className="text-3xl font-extrabold text-gray-900 md:text-4xl">{title}</h2>
    </div>
  )
}
