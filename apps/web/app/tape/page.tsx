import LiveTape from '@/components/LiveTape'
import PageHeader from '@/components/PageHeader'
import WalletSearch from '@/components/WalletSearch'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Tape' }

export default function TapePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Live"
        title="Tape"
        lede={
          <>
            Every fill on Robinhood Chain as it lands in our ledger — the profitable wallets by default, everyone on demand — with fresh pools and the tracked
            wallets&rsquo; closed trades beside it. Read-only, no wallet, no login.
          </>
        }
        aside={<WalletSearch placeholder="Open a wallet…" />}
      />
      <LiveTape />
    </div>
  )
}
