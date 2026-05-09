import { requireAdmin } from '@/lib/auth-helpers'
import { getAllDoctors } from '@/lib/actions/admin'
import { DoctorStatus } from '@prisma/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { DoctorVerifyActions } from '@/components/admin/doctor-verify-actions'

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  VERIFIED: 'success',
  PENDING_VERIFICATION: 'warning',
  SUSPENDED: 'destructive',
}

export default async function AdminDoctorsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { status?: string }
}) {
  await requireAdmin(locale)
  const doctors = await getAllDoctors({
    status: searchParams.status as DoctorStatus | undefined,
  })

  const tabs = [
    { label: 'All', value: '' },
    { label: 'Pending', value: 'PENDING_VERIFICATION' },
    { label: 'Verified', value: 'VERIFIED' },
    { label: 'Suspended', value: 'SUSPENDED' },
  ]

  return (
    <div className="p-6 lg:p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Doctors</h1>
{/* Filter tabs */}
        <div className="mb-6 flex gap-2 border-b pb-2">
          {tabs.map((tab) => (
            <Link key={tab.label} href={tab.value ? `?status=${tab.value}` : '?'}>
              <button
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  (searchParams.status ?? '') === tab.value
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.label}
              </button>
            </Link>
          ))}
        </div>

        <p className="mb-3 text-sm text-gray-500">{doctors.length} doctor{doctors.length !== 1 ? 's' : ''}</p>

        <div className="space-y-4">
          {doctors.map((d) => {
            const user = (d as any).user
            const specialties = (d as any).specialties?.map((ds: any) => ds.specialty?.nameEn).join(', ') || '—'
            return (
              <div key={d.id} className="rounded-lg border bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900">
                        {d.title} {user?.name ?? '—'}
                      </p>
                      <Badge variant={STATUS_VARIANT[d.status] ?? 'outline'}>
                        {d.status.replace(/_/g, ' ')}
                      </Badge>
                      {d.isAvailable && d.status === 'VERIFIED' && (
                        <Badge variant="success">Available</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{user?.email}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Specialties: {specialties}
                    </p>
                    {d.licenseNumber && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        License: {d.licenseNumber} · {d.licenseCountry}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-gray-400">
                      Joined {formatDate(user?.createdAt ?? new Date(), locale)} · {d.casesCompleted} cases completed
                    </p>
                  </div>
                  <DoctorVerifyActions doctorId={d.id} currentStatus={d.status} />
                </div>
              </div>
            )
          })}
          {doctors.length === 0 && (
            <div className="py-12 text-center text-gray-400">No doctors found.</div>
          )}
        </div>
    </div>
  )
}
