import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function UnauthorizedPage({ params: { locale } }: { params: { locale: string } }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-red-50 to-white px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-red-600">Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to access this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            This page requires specific permissions that your account does not have. Please contact
            an administrator if you believe this is an error.
          </p>
          <div className="flex gap-2">
            <Link href={`/${locale}`} className="flex-1">
              <Button variant="outline" className="w-full">
                Go Home
              </Button>
            </Link>
            <Link href={`/${locale}/dashboard`} className="flex-1">
              <Button className="w-full">Go to Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
