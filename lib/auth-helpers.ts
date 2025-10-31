import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { redirect } from 'next/navigation'
import { UserRole } from '@prisma/client'

export async function getSession() {
  return await getServerSession(authOptions)
}

export async function getCurrentUser() {
  const session = await getSession()
  return session?.user
}

export async function requireAuth(locale: string = 'en') {
  const session = await getSession()

  if (!session || !session.user) {
    redirect(`/${locale}/auth/signin`)
  }

  return session
}

export async function requireRole(allowedRoles: UserRole[], locale: string = 'en') {
  const session = await requireAuth(locale)

  if (!allowedRoles.includes(session.user.role)) {
    redirect(`/${locale}/unauthorized`)
  }

  return session
}

export async function requirePatient(locale: string = 'en') {
  return await requireRole([UserRole.PATIENT], locale)
}

export async function requireDoctor(locale: string = 'en') {
  return await requireRole([UserRole.DOCTOR], locale)
}

export async function requireAdmin(locale: string = 'en') {
  return await requireRole([UserRole.ADMIN], locale)
}

export function getDashboardPath(role: UserRole, locale: string = 'en'): string {
  switch (role) {
    case UserRole.PATIENT:
      return `/${locale}/patient/dashboard`
    case UserRole.DOCTOR:
      return `/${locale}/doctor/dashboard`
    case UserRole.ADMIN:
    case UserRole.ORG_ADMIN:
      return `/${locale}/admin/dashboard`
    default:
      return `/${locale}`
  }
}
