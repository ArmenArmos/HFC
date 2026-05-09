import { requireAdmin } from '@/lib/auth-helpers'
import { getAllOrganizations } from '@/lib/actions/admin'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  EMPLOYER: 'Employer',
  INSURER: 'Insurance',
  BANK: 'Bank',
  HOSPITAL: 'Hospital',
}

export default async function AdminOrganizationsPage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  await requireAdmin(locale)
  const orgs = await getAllOrganizations()

  return (
    <div className="p-6 lg:p-8">
<div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">{orgs.length} organization{orgs.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Organization</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Contact</th>
                <th className="px-4 py-3 text-left">Seats</th>
                <th className="px-4 py-3 text-left">Users</th>
                <th className="px-4 py-3 text-left">Billing</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orgs.map((org) => (
                <tr key={org.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{TYPE_LABELS[org.type] ?? org.type}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    <p>{org.contactEmail}</p>
                    {org.contactPhone && <p className="text-xs">{org.contactPhone}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {org.seatCount}
                    {org.allowancePerYear && (
                      <span className="ml-1 text-xs text-gray-400">({org.allowancePerYear}/yr)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{(org as any)._count?.users ?? 0}</td>
                  <td className="px-4 py-3">
                    {org.invoicingMode
                      ? <Badge variant="secondary">Invoicing</Badge>
                      : <Badge variant="outline">Stripe</Badge>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={org.isActive ? 'success' : 'destructive'}>
                      {org.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(org.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orgs.length === 0 && (
            <div className="py-12 text-center text-gray-400">No organizations yet.</div>
          )}
        </div>
    </div>
  )
}
