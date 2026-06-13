import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'Finance Tracker',
  description: 'Personal finance tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. WOT) inject
          attributes on <body> before hydration; this scopes the suppression
          to body's own attributes only, not the component tree. */}
      <body suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
