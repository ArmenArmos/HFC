import type { ReactNode } from 'react'
import './vitalens.css'

export const metadata = {
  title: 'VitaLens — Preventive Health',
  description: 'Know your future self. Personalized preventive health intelligence from your bloodwork.',
}

export default function VitaLensLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, padding: 0, background: '#f0ede8' }}>
        {children}
      </body>
    </html>
  )
}
