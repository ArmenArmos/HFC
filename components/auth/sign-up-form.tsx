'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { registerUser } from '@/lib/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SignUpForm({ locale }: { locale: string }) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'PATIENT' as 'PATIENT' | 'DOCTOR',
  })
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const t = useTranslations('auth')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const formDataObj = new FormData()
    formDataObj.append('name', formData.name)
    formDataObj.append('email', formData.email)
    formDataObj.append('password', formData.password)
    formDataObj.append('confirmPassword', formData.confirmPassword)
    formDataObj.append('role', formData.role)
    formDataObj.append('locale', locale)

    try {
      const result = await registerUser(formDataObj)

      if (!result.success) {
        setError(result.error || 'Failed to create account')
        setIsLoading(false)
        return
      }

      // Redirect to sign in page
      router.push(`/${locale}/auth/signin?registered=true`)
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t('signUp')}</CardTitle>
        <CardDescription>Create your account to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              placeholder="John Doe"
              value={formData.name}
              onChange={handleChange}
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="name@example.com"
              value={formData.email}
              onChange={handleChange}
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">I am a</Label>
            <select
              id="role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              disabled={isLoading}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="PATIENT">Patient</option>
              <option value="DOCTOR">Doctor</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              required
              disabled={isLoading}
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
              disabled={isLoading}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Creating account...' : 'Create Account'}
          </Button>
        </form>

        <div className="mt-4 text-center text-sm">
          {t('hasAccount')}{' '}
          <a href={`/${locale}/auth/signin`} className="text-primary hover:underline">
            {t('signIn')}
          </a>
        </div>
      </CardContent>
    </Card>
  )
}
