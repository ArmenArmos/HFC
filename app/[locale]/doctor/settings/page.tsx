import { requireDoctor } from '@/lib/auth-helpers'
import { getUserSettings } from '@/lib/actions/settings'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsForm } from '@/components/settings/settings-form'

export default async function DoctorSettingsPage({ params: { locale } }: { params: { locale: string } }) {
  await requireDoctor(locale)
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
          <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              'New case assigned to me',
              'Patient sends a message',
              'Case deadline approaching (48h)',
              'Platform announcements',
            ].map(label => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
                <span className="text-gray-700">{label}</span>
              </label>
            ))}
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
