import LiveTape from '@/components/LiveTape'
import WalletSearch from '@/components/WalletSearch'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tape' }

export default function TapePage() {
  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight">Tape</h1>
          <p className="max-w-2xl text-muted">
            Every fill on Robinhood Chain as it lands in our ledger — the profitable wallets by default, everyone on demand — with fresh pools and the
            tracked wallets&rsquo; closed trades beside it. Read-only, no wallet, no login.
          </p>
        </div>
        <WalletSearch placeholder="Open a wallet…" />
      </div>
      <LiveTape />
    </div>
  )
}
