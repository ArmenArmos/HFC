'use client'

import { signOut } from 'next-auth/react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SignOutPage({ params: { locale } }: { params: { locale: string } }) {
  const router = useRouter()

  useEffect(() => {
    signOut({ redirect: false }).then(() => {
      router.push(`/${locale}`)
    })
  }, [locale, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-lg">Signing out...</p>
      </div>
    </div>
  )
}
