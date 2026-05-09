'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updatePatientProfile } from '@/lib/actions/patient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown']
const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say']

interface Props {
  profile: any
}

export function PatientProfileForm({ profile }: Props) {
  const router = useRouter()
  const user = profile?.user
  const [form, setForm] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    dateOfBirth: profile?.dateOfBirth
      ? new Date(profile.dateOfBirth).toISOString().split('T')[0]
      : '',
    gender: profile?.gender ?? '',
    country: profile?.country ?? '',
    city: profile?.city ?? '',
    address: profile?.address ?? '',
    emergencyName: profile?.emergencyName ?? '',
    emergencyPhone: profile?.emergencyPhone ?? '',
    bloodType: profile?.bloodType ?? '',
    allergies: profile?.allergies ?? '',
    chronicConditions: profile?.chronicConditions ?? '',
    marketingOptIn: profile?.marketingOptIn ?? false,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }))
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError('')
    const res = await updatePatientProfile(form)
    setIsSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSuccess(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full Name</Label>
          <Input id="name" name="name" value={form.name} onChange={handleChange} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="+1 555 000 0000" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dateOfBirth">Date of Birth</Label>
          <Input id="dateOfBirth" name="dateOfBirth" type="date" value={form.dateOfBirth} onChange={handleChange} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gender">Gender</Label>
          <select
            id="gender"
            name="gender"
            value={form.gender}
            onChange={handleChange}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select…</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" value={form.country} onChange={handleChange} placeholder="e.g. Armenia" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" value={form.city} onChange={handleChange} placeholder="e.g. Yerevan" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" value={form.address} onChange={handleChange} placeholder="Street address" />
      </div>

      {/* Emergency Contact */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Emergency Contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emergencyName">Contact Name</Label>
            <Input id="emergencyName" name="emergencyName" value={form.emergencyName} onChange={handleChange} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyPhone">Contact Phone</Label>
            <Input id="emergencyPhone" name="emergencyPhone" type="tel" value={form.emergencyPhone} onChange={handleChange} />
          </div>
        </div>
      </div>

      {/* Medical Info */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Medical Information</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bloodType">Blood Type</Label>
            <select
              id="bloodType"
              name="bloodType"
              value={form.bloodType}
              onChange={handleChange}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select…</option>
              {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="allergies">Known Allergies</Label>
            <Textarea
              id="allergies"
              name="allergies"
              value={form.allergies}
              onChange={handleChange}
              rows={2}
              placeholder="Drug, food, or environmental allergies…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chronicConditions">Chronic Conditions</Label>
            <Textarea
              id="chronicConditions"
              name="chronicConditions"
              value={form.chronicConditions}
              onChange={handleChange}
              rows={2}
              placeholder="Ongoing medical conditions…"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="marketingOptIn"
          name="marketingOptIn"
          checked={form.marketingOptIn}
          onChange={(e) => setForm((p) => ({ ...p, marketingOptIn: e.target.checked }))}
          className="h-4 w-4 rounded border-gray-300"
        />
        <Label htmlFor="marketingOptIn" className="cursor-pointer font-normal text-gray-600">
          {"I'd like to receive health tips and platform updates by email"}
        </Label>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Profile saved successfully.</p>}

      <Button type="submit" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save Profile'}
      </Button>
    </form>
  )
}
