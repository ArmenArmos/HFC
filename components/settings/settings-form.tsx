'use client'

import { useState, useTransition } from 'react'
import { updateUserSettings } from '@/lib/actions/settings'

type Profile = { name: string | null; email: string; phone: string | null; locale: string }

const inp: React.CSSProperties = { width: '100%', borderRadius: 8, border: '1px solid #e5e7eb', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', background: 'white' }
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }

const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'hy', label: 'Հայերեն (Armenian)' },
  { value: 'ru', label: 'Русский (Russian)' },
]

export function SettingsForm({ profile }: { profile: Profile }) {
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState(profile.name ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [locale, setLocale] = useState(profile.locale ?? 'en')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    setError('')
    startTransition(async () => {
      const res = await updateUserSettings({ name, phone, locale })
      if (res.success) setSaved(true)
      else setError(res.error ?? 'Failed to save')
    })
  }

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <label style={lbl}>Full Name</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" style={inp} />
      </div>
      <div>
        <label style={lbl}>Email address</label>
        <input value={profile.email} readOnly style={{ ...inp, background: '#f9fafb', color: '#6b7280' }} />
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Email cannot be changed.</p>
      </div>
      <div>
        <label style={lbl}>Phone number</label>
        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 000 0000" style={inp} type="tel" />
      </div>
      <div>
        <label style={lbl}>Language preference</label>
        <select value={locale} onChange={e => setLocale(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
          {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      {saved && <p style={{ color: '#16a34a', fontSize: 13 }}>✓ Settings saved successfully</p>}

      <button type="submit" disabled={isPending} style={{
        height: 42, borderRadius: 8, background: '#2563eb', color: 'white', border: 'none',
        fontSize: 14, fontWeight: 600, cursor: isPending ? 'wait' : 'pointer', opacity: isPending ? 0.7 : 1,
      }}>
        {isPending ? 'Saving…' : 'Save Settings'}
      </button>
    </form>
  )
}
