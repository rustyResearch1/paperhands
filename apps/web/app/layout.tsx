import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Public_Sans, Source_Serif_4 } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import Ambient from '@/components/Ambient'
import ChainSwitch from '@/components/ChainSwitch'
import ModeSwitch from '@/components/ModeSwitch'
import NavLinks from '@/components/NavLinks'
import Providers from '@/components/Providers'
import WalletButton from '@/components/WalletButton'
import { formatEth } from '@/lib/format'
import { getOrCreateUser } from '@/lib/session'

const sans = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-public' })
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-serif-src' })
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-jetbrains' })

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
export const viewport: Viewport = { themeColor: '#eeebe5', width: 'device-width', initialScale: 1 }

/**
 * `primary` rides the mobile bar — five is what fits at a legible size. The rest
 * live in the header and the footer; /x and /docs previously had no link at all.
 */
const NAV = [
  { href: '/', label: 'Markets', primary: true },
  { href: '/tape', label: 'Tape', primary: true },
  { href: '/baskets', label: 'Baskets', primary: true },
  { href: '/lp', label: 'LP', primary: false },
  { href: '/x', label: 'Execution', primary: false },
  { href: '/wire', label: 'Wire', primary: true },
  { href: '/portfolio', label: 'Portfolio', primary: true },
]
const MORE = [
  { href: '/how', label: 'How it works' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/docs', label: 'API docs' },
]

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateUser()
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <Ambient />
          <header className="above sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
              <Link href="/" className="serif flex shrink-0 items-center gap-2 text-[19px] font-semibold tracking-tight">
                <span className="inline-block h-5 w-5 rounded-[5px] bg-ink" aria-hidden="true" />
                PaperHands
              </Link>
              <nav className="hidden items-center gap-1 text-[14px] lg:flex" aria-label="Main">
                <NavLinks items={NAV} variant="header" />
              </nav>
              <div className="ml-auto hidden items-center gap-3 sm:flex">
                <ChainSwitch />
                <ModeSwitch />
                <WalletButton bankroll={formatEth(BigInt(user.balance_quote), 3)} />
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-4 py-2 sm:hidden">
              <ChainSwitch />
              <ModeSwitch />
              <WalletButton bankroll={formatEth(BigInt(user.balance_quote), 3)} />
            </div>
          </header>
          <main className="above mx-auto max-w-6xl px-4 py-8">{children}</main>
          <nav className="above fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-bg/90 backdrop-blur-md lg:hidden" aria-label="Main">
            <NavLinks items={NAV.filter((n) => n.primary)} variant="mobile" />
          </nav>
          <footer className="above mx-auto max-w-6xl px-4 pb-24 pt-8 text-[12px] text-faint lg:pb-10">
            <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="More">
              {[...NAV.filter((n) => !n.primary), ...MORE].map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            Fills simulated against live Robinhood Chain liquidity · engine cross-checked wei-for-wei against the on-chain
            quoters · practice balances are not money · nothing here is financial advice.
          </footer>
        </Providers>
      </body>
    </html>
  )
}
