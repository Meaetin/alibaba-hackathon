import type { Metadata, Viewport } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ToastProvider } from '@/contexts/ToastContext'
import { ToastContainer } from '@/components/ui/primitives/Toast'
import { TooltipProvider } from '@/components/ui/primitives/Tooltip'
import { Lora } from "next/font/google";
import { cn } from "@/lib/utils";
import { QueryProvider } from '@/components/QueryProvider';
import { ItineraryJobNotifier } from '@/components/notifications/ItineraryJobNotifier';
import { SITE_URL } from '@/lib/site';

const lora = Lora({ subsets: ['latin'], weight: ['400', '600'], style: ['normal', 'italic'], variable: '--font-lora' });

const DESCRIPTION =
  'Argo turns the links you save into places on a map, then plans the trip around them. ' +
  'Analyse videos and articles, build collections, and get a day-by-day itinerary that respects opening hours and travel time.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Argo — Your Itinerary Planner',
    template: '%s — Argo',
  },
  description: DESCRIPTION,
  applicationName: 'Argo',
  keywords: ['itinerary planner', 'travel planning', 'trip planner', 'travel collections'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Argo',
    title: 'Argo — Your Itinerary Planner',
    description: DESCRIPTION,
    url: '/',
    locale: 'en_SG',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Argo — Your Itinerary Planner',
    description: DESCRIPTION,
  },
  // Authenticated and token-gated routes are excluded from crawling in
  // robots.ts; this only governs how the indexable pages are listed.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
}

// viewport-fit=cover so env(safe-area-inset-*) resolves to non-zero on notched
// devices — the Sheet primitive and shell pad against these insets. (RSP-P0c)
export const viewport: Viewport = {
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("root-html font-sans", lora.variable)}>
      <head className="root-head">
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@100,200,300,400,500,600,700,800,900&display=swap" />
      </head>
      <body className="root-body font-primary antialiased bg-surface text-content">
        <QueryProvider>
          <ToastProvider>
            <ItineraryJobNotifier />
            <ThemeProvider>
              <TooltipProvider>
                {children}
              </TooltipProvider>
            </ThemeProvider>
            <ToastContainer />
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  )
}

