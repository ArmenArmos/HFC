import { requireAdmin } from '@/lib/auth-helpers'
import { getAllUsers } from '@/lib/actions/admin'
import { UserStatus, UserRole } from '@prisma/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import { UserStatusActions } from '@/components/admin/user-status-actions'

const ROLE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  ADMIN: 'default',
  DOCTOR: 'secondary',
  PATIENT: 'outline',
  ORG_ADMIN: 'secondary',
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  ACTIVE: 'success',
  PENDING_VERIFICATION: 'warning',
  SUSPENDED: 'destructive',
  DEACTIVATED: 'destructive',
}

export default async function AdminUsersPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { role?: string; status?: string; search?: string }
}) {
  await requireAdmin(locale)
  const users = await getAllUsers({
    role: searchParams.role as UserRole | undefined,
    status: searchParams.status as UserStatus | undefined,
    search: searchParams.search,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link href={`/${locale}/admin/dashboard`} className="text-sm text-blue-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold">Users Management</h1>
          <div className="w-28" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Filters */}
        <form method="GET" className="mb-6 flex flex-wrap gap-3">
          <input
            name="search"
            defaultValue={searchParams.search}
            placeholder="Search name or email…"
            className="rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <select name="role" defaultValue={searchParams.role ?? ''} className="rounded-md border border-input bg-white px-3 py-2 text-sm">
            <option value="">All Roles</option>
            {Object.values(UserRole).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select name="status" defaultValue={searchParams.status ?? ''} className="rounded-md border border-input bg-white px-3 py-2 text-sm">
            <option value="">All Statuses</option>
            {Object.values(UserStatus).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Filter
          </button>
          <Link href={`/${locale}/admin/users`} className="rounded-md border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Clear
          </Link>
        </form>

        <p className="mb-3 text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''} found</p>

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Joined</th>
                <th className="px-4 py-3 text-left">Organization</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{u.name ?? '—'}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ROLE_VARIANT[u.role] ?? 'outline'}>{u.role}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[u.status] ?? 'outline'}>
                      {u.status.replace(/_/g, ' ')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(u.createdAt, locale)}</td>
                  <td className="px-4 py-3 text-gray-500">{(u as any).organization?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <UserStatusActions userId={u.id} currentStatus={u.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="py-12 text-center text-gray-400">No users found.</div>
          )}
        </div>
      </main>
    </div>
  )
}
