import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import Ambient from '@/components/Ambient'
import ModeSwitch from '@/components/ModeSwitch'
import Providers from '@/components/Providers'
import WalletButton from '@/components/WalletButton'
import { formatEth } from '@/lib/format'
import { getOrCreateUser } from '@/lib/session'

const sans = Instrument_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-instrument' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex' })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://paperhands-production.up.railway.app'),
  title: { default: 'PaperHands — honest trading on Robinhood Chain', template: '%s · PaperHands' },
  description:
    'Practice with a paper bankroll or trade for real from your own wallet — every fill simulated exactly through live Uniswap liquidity, every bag valued at what the pool would actually pay.',
  openGraph: {
    title: 'PaperHands — honest trading on Robinhood Chain',
    description: 'Exact fills, honest PnL, whale replays, LP backtests. Practice or real, your wallet, no custody.',
    siteName: 'PaperHands',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'PaperHands', description: 'Honest trading on Robinhood Chain — practice or real.' },
}
export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1 }

const NAV = [
  { href: '/', label: 'Markets' },
  { href: '/wire', label: 'Wire' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/leaderboard', label: 'Leaderboard' },
]

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateUser()
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Ambient />
          <header className="above sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="inline-block h-6 w-6 rounded-lg bg-up" aria-hidden="true" />
                PaperHands
              </Link>
              <nav className="hidden items-center gap-1 text-[14px] md:flex">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="rounded-lg px-3 py-1.5 text-muted hover:bg-bg-2 hover:text-ink">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <ModeSwitch />
                <WalletButton bankroll={formatEth(BigInt(user.balance_quote), 3)} />
              </div>
            </div>
          </header>
          <main className="above mx-auto max-w-6xl px-4 py-8">{children}</main>
          <nav className="above fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-bg/90 backdrop-blur-md md:hidden">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="flex-1 py-3 text-center text-[12px] font-semibold text-muted">
                {n.label}
              </Link>
            ))}
          </nav>
          <footer className="above mx-auto max-w-6xl px-4 pb-24 pt-8 text-[12px] text-faint md:pb-10">
            Fills simulated against live Robinhood Chain liquidity · engine cross-checked wei-for-wei against the on-chain
            quoters · practice balances are not money · nothing here is financial advice.
          </footer>
        </Providers>
      </body>
    </html>
  )
}
