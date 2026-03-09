import type { Metadata } from 'next'
import { DM_Sans, DM_Serif_Display, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/layout/Providers'
import './globals.css'

const dmSans = DM_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
})

const dmSerif = DM_Serif_Display({
  variable: '--font-serif',
  weight: '400',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'FundScope — PE Fund Document Analysis',
  description:
    'AI-powered legal analysis platform for private equity fund documentation. Analyze LPAs, side letters, and term sheets with structured extraction, risk scoring, and citation-backed insights.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${dmSerif.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
