import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string, locale: string = 'en'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

export function formatCurrency(amount: number, currency: string = 'USD', locale: string = 'en'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount)
}

export function generateCaseNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')
  return `MSO-${year}-${random}`
}
