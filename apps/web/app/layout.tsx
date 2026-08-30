import type { Metadata } from 'next'
import { IBM_Plex_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { getOrCreateUser } from '@/lib/session'
import { formatEth } from '@/lib/format'

const plex = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-plex',
})

export const metadata: Metadata = {
  title: 'PaperHands — paper trade Robinhood Chain memecoins',
  description:
    'Execution-honest paper trading on live Robinhood Chain liquidity. Prove you can find the winners before you spend real money.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateUser()
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-screen">
        <header className="border-b-2 border-ink bg-paper/95 sticky top-0 z-20 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="text-lg font-bold tracking-[0.18em]">PAPERHANDS</span>
              <span className="stamp text-stamp text-[10px]">not real money</span>
            </Link>
            <nav className="ml-auto flex items-center gap-5 text-[12px]">
              <Link href="/" className="hover:underline underline-offset-4">
                screener
              </Link>
              <Link href="/wire" className="hover:underline underline-offset-4">
                the wire
              </Link>
              <Link href="/portfolio" className="hover:underline underline-offset-4">
                portfolio
              </Link>
              <Link href="/leaderboard" className="hover:underline underline-offset-4">
                leaderboard
              </Link>
              <span className="rule-label border-l border-grid pl-5">
                bankroll{' '}
                <b className="text-ink text-[12px] normal-case tracking-normal">
                  {formatEth(BigInt(user.balance_quote))} ETH
                </b>
              </span>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 rule-label">
          simulated fills against live robinhood chain liquidity · engine cross-checked wei-for-wei vs
          on-chain quoter · nothing here is financial advice, or money
        </footer>
      </body>
    </html>
  )
}
