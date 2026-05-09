import { requireAdmin } from '@/lib/auth-helpers'
import { getAuditLogs } from '@/lib/actions/admin'
import { AuditAction } from '@prisma/client'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

const ACTION_VARIANT: Record<string, 'default' | 'secondary' | 'warning' | 'destructive' | 'outline'> = {
  LOGIN: 'secondary',
  LOGOUT: 'outline',
  VIEW_CASE: 'outline',
  EDIT_CASE: 'default',
  UPLOAD_FILE: 'secondary',
  DOWNLOAD_FILE: 'secondary',
  DELETE_FILE: 'destructive',
  SUBMIT_OPINION: 'default',
  VIEW_PATIENT_DATA: 'warning',
  EXPORT_DATA: 'warning',
  DELETE_DATA: 'destructive',
}

function formatTimestamp(date: Date) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date))
}

export default async function AdminAuditLogsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { action?: string }
}) {
  await requireAdmin(locale)
  const logs = await getAuditLogs({
    action: searchParams.action as AuditAction | undefined,
  })

  return (
    <div className="p-6 lg:p-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Audit Logs</h1>
{/* Filters */}
        <form method="GET" className="mb-6 flex flex-wrap gap-3">
          <select name="action" defaultValue={searchParams.action ?? ''} className="rounded-md border border-input bg-white px-3 py-2 text-sm">
            <option value="">All Actions</option>
            {Object.values(AuditAction).map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Filter
          </button>
          <Link href={`/${locale}/admin/audit-logs`} className="rounded-md border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Clear
          </Link>
        </form>

        <p className="mb-3 text-sm text-gray-500">{logs.length} log entries (latest 200)</p>

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Timestamp</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Resource</th>
                <th className="px-4 py-3 text-left">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => {
                const user = (log as any).user
                return (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">
                      {formatTimestamp(log.createdAt)}
                    </td>
                    <td className="px-4 py-2">
                      <p className="font-medium text-gray-800">{user?.name ?? '—'}</p>
                      <p className="text-xs text-gray-400">{user?.email}</p>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={ACTION_VARIANT[log.action] ?? 'outline'}>
                        {log.action.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{log.resource ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{log.ipAddress ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {logs.length === 0 && (
            <div className="py-12 text-center text-gray-400">No audit logs found.</div>
          )}
        </div>
    </div>
  )
}
