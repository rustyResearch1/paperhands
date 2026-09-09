import Link from 'next/link'
import { notFound } from 'next/navigation'
import BasketCard from '@/components/BasketCard'
import CopyAddress from '@/components/CopyAddress'
import { walletBasket } from '@/lib/baskets'
import { formatUsd } from '@/lib/format'
import { ethUsdRate } from '@/lib/usd'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Basket' }

export default async function WalletBasketPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params
  const address = raw.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(address)) notFound()
  const b = walletBasket(address)
  const rate = ethUsdRate()
  return (
    <div className="space-y-5">
      <div className="rise flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="label">Basket</div>
          <h1 className="num text-[22px] font-semibold tracking-tight">
            {address.slice(0, 10)}…{address.slice(-8)}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <CopyAddress address={address} label="copy" />
            {b.rank !== null && <span className="pill pill-up">#{b.rank} on the Wire</span>}
            <span className="text-muted">
              {b.holdings.length} holdings · {b.markEth.toFixed(2)} ETH{rate ? ` · ${formatUsd(b.markEth * rate)}` : ''} marked
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <Link href={`/w/${address}`} className="text-pen hover:underline">
            ← Wallet
          </Link>
          <Link href="/baskets" className="text-pen hover:underline">
            All baskets
          </Link>
        </div>
      </div>
      <BasketCard address={address} ethUsd={rate} />
    </div>
  )
}
