'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDoctorProfile } from '@/lib/actions/doctor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface Props {
  profile: any
}

const TITLES = ['Dr.', 'Prof.', 'Assoc. Prof.', 'Mr.', 'Ms.']
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hy', label: 'Armenian' },
  { code: 'ru', label: 'Russian' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'ar', label: 'Arabic' },
]

export function DoctorProfileForm({ profile }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    title: profile?.title ?? '',
    bio: profile?.bio ?? '',
    licenseNumber: profile?.licenseNumber ?? '',
    licenseCountry: profile?.licenseCountry ?? '',
    yearsExperience: profile?.yearsExperience?.toString() ?? '',
    medicalSchool: profile?.medicalSchool ?? '',
    residency: profile?.residency ?? '',
    fellowships: profile?.fellowships ?? '',
    boardCertifications: profile?.boardCertifications ?? '',
    maxCasesPerWeek: profile?.maxCasesPerWeek?.toString() ?? '10',
    isAvailable: profile?.isAvailable ?? true,
    languages: profile?.languages ?? ['en'],
  })
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((p) => ({ ...p, [e.target.name]: e.target.value }))
    setSuccess(false)
  }

  const toggleLanguage = (code: string) => {
    setForm((p) => ({
      ...p,
      languages: p.languages.includes(code)
        ? p.languages.filter((l: string) => l !== code)
        : [...p.languages, code],
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError('')
    const res = await updateDoctorProfile({
      ...form,
      yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience) : undefined,
      maxCasesPerWeek: form.maxCasesPerWeek ? parseInt(form.maxCasesPerWeek) : undefined,
    })
    setIsSaving(false)
    if (!res.success) { setError(res.error ?? 'Failed to save'); return }
    setSuccess(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="title">Title</Label>
          <select
            id="title"
            name="title"
            value={form.title}
            onChange={handleChange}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select title</option>
            {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="licenseNumber">License Number</Label>
          <Input id="licenseNumber" name="licenseNumber" value={form.licenseNumber} onChange={handleChange} placeholder="Medical license #" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="licenseCountry">License Country</Label>
          <Input id="licenseCountry" name="licenseCountry" value={form.licenseCountry} onChange={handleChange} placeholder="e.g. United States" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="yearsExperience">Years of Experience</Label>
          <Input id="yearsExperience" name="yearsExperience" type="number" min={0} max={60} value={form.yearsExperience} onChange={handleChange} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="medicalSchool">Medical School</Label>
          <Input id="medicalSchool" name="medicalSchool" value={form.medicalSchool} onChange={handleChange} placeholder="e.g. Harvard Medical School" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="residency">Residency</Label>
          <Input id="residency" name="residency" value={form.residency} onChange={handleChange} placeholder="e.g. Mass General Hospital" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxCasesPerWeek">Max Cases / Week</Label>
          <Input id="maxCasesPerWeek" name="maxCasesPerWeek" type="number" min={1} max={50} value={form.maxCasesPerWeek} onChange={handleChange} />
        </div>
        <div className="flex items-center gap-3 pt-6">
          <input
            type="checkbox"
            id="isAvailable"
            checked={form.isAvailable}
            onChange={(e) => setForm((p) => ({ ...p, isAvailable: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <Label htmlFor="isAvailable">Available to accept new cases</Label>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fellowships">Fellowships</Label>
        <Input id="fellowships" name="fellowships" value={form.fellowships} onChange={handleChange} placeholder="e.g. Interventional Cardiology Fellowship, Cleveland Clinic" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="boardCertifications">Board Certifications</Label>
        <Input id="boardCertifications" name="boardCertifications" value={form.boardCertifications} onChange={handleChange} placeholder="e.g. ABIM – Internal Medicine, Cardiovascular Disease" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bio">Professional Bio</Label>
        <Textarea
          id="bio"
          name="bio"
          value={form.bio}
          onChange={handleChange}
          rows={4}
          maxLength={2000}
          placeholder="Brief professional biography visible to patients…"
        />
        <p className="text-right text-xs text-gray-400">{form.bio.length}/2000</p>
      </div>

      <div className="space-y-2">
        <Label>Languages Spoken</Label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => toggleLanguage(lang.code)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                form.languages.includes(lang.code)
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Profile updated successfully.</p>}

      <Button type="submit" disabled={isSaving}>
        {isSaving ? 'Saving…' : 'Save Profile'}
      </Button>
    </form>
  )
}
