import { Shield } from 'lucide-react'

/**
 * Auth layout: centered card with decorative watermark.
 * Used for login and signup pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 relative overflow-hidden">
      {/* Decorative watermark */}
      <Shield className="absolute -bottom-16 -right-16 h-96 w-96 text-primary/[0.03] rotate-12 pointer-events-none" />
      <div className="w-full max-w-md relative z-10">{children}</div>
    </div>
  )
}
