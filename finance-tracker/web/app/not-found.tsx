import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      {/* Base UI composes via `render` (not Radix `asChild`); the rendered
          element is an anchor, so set nativeButton={false}. */}
      <Button render={<Link href="/" />} nativeButton={false}>
        Back to dashboard
      </Button>
    </main>
  )
}
