import { requirePatient } from '@/lib/auth-helpers'
import { getUserSettings } from '@/lib/actions/settings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsForm } from '@/components/settings/settings-form'

export default async function PatientSettingsPage({ params: { locale } }: { params: { locale: string } }) {
  await requirePatient(locale)
  const profile = await getUserSettings()
  if (!profile) return null

  return (
    <div className="p-6 lg:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your account preferences</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Account Information</CardTitle></CardHeader>
          <CardContent>
            <SettingsForm profile={{ name: profile.name, email: profile.email, phone: profile.phone, locale: profile.locale }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Privacy & Data</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-600">
            <p>Your health data is encrypted at rest and in transit. We are HIPAA-compliant.</p>
            <div className="flex flex-col gap-3">
              <button className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
                Download My Data
              </button>
              <button className="w-full rounded-lg border border-red-200 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition">
                Request Account Deletion
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>About</CardTitle></CardHeader>
          <CardContent className="text-sm text-gray-500 space-y-1">
            <p>Member since: {new Date(profile.createdAt).toLocaleDateString('en', { month: 'long', year: 'numeric' })}</p>
            <p>Role: {profile.role}</p>
            <p>Platform version: 2.0.0</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
