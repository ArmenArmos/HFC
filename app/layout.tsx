import { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Medical Second Opinion',
  description: 'Connect with world-class specialists for expert medical second opinions',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}
