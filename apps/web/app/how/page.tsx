import Link from 'next/link'
import FillDiagram from '@/components/FillDiagram'
import PageHeader from '@/components/PageHeader'
import { proof } from '@/lib/proof'
import { timeAgo } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'How it works',
  description: 'Why every number on PaperHands is a fill rather than a chart price, and how the engine that produces them is checked against the chain itself.',
}

const n = (v: number) => v.toLocaleString('en-US')

/**
 * The "what we are" page. Written for a trader, not an engineer: each section
 * leads with the plain-English claim and what it costs you when a tool gets it
 * wrong, then states the mechanism underneath. Everything here is checkable in
 * the code, and the limits are on the same page as the claims.
 */
export default async function How() {
  const p = await proof()

  return (
    <div className="space-y-12">
      <PageHeader
        kicker="How it works"
        title="What you see is what you'd get"
        lede={
          <>
            Most trading screens show you a price. A price is the number of the last trade, and it is not what you will receive.
            Every number here is a <span className="hilite">fill for your size</span> — through the liquidity that exists right
            now. On Robinhood Chain and BNB Chain we compute it ourselves, the way the pool itself would. On Solana we take
            Jupiter&rsquo;s executable quote rather than inventing our own.
          </>
        }
      />

      <section className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div className="space-y-3">
          <div className="label">The whole idea</div>
          <h2 className="text-[22px] font-semibold tracking-tight">A price is one number. A fill is a journey.</h2>
          <p className="text-[15px] text-muted">
            On these markets, liquidity sits in slices at different prices. A small order takes the first slice and barely moves.
            A larger one eats through slice after slice, and you receive the blended average of all of them — always worse than the
            number on the chart, sometimes far worse.
          </p>
          <p className="text-[15px] text-muted">
            That gap is where paper-trading tools quietly lie, where a portfolio says you are up 500% on a bag you cannot sell, and
            where a screener shows &ldquo;$2M liquidity&rdquo; on a pool that cannot absorb two thousand dollars. We compute the
            gap instead of hiding it.
          </p>
        </div>
        <FillDiagram />
      </section>

      <Section
        num="01"
        title="The engine runs the pool's own arithmetic"
        plain="On the pools we price ourselves, we did not approximate the maths. We reimplemented the exact calculation the Uniswap contract performs, down to the rounding, and we check it against the chain."
        detail="The engine is a line-for-line port of Uniswap's core swap maths in whole-number arithmetic, walking the same tick-by-tick loop the pool executes. To prove it, we ask the chain's own quoter contract the identical question at the identical block. On v3 pools both answers must match to the last wei — the amount out and the price the pool ends at. On v4 we check the amount out and allow a divergence smaller than a millionth of a millionth of the trade, because one rounding step there is not yet a perfect match. That gap is documented in the code rather than rounded away."
        why="If your quote comes from a different formula than the one that executes, it will disagree with reality exactly when it matters: on size, in thin liquidity, at speed."
      />

      <Section
        num="02"
        title="It grades itself in public"
        plain="Every half hour the engine picks a busy pool, replays hundreds of that pool's real trades through itself, and records how many it reproduced exactly."
        detail={`${
          p.replayedSwaps > 0 ? `Right now: ${n(p.exactSwaps)} of ${n(p.replayedSwaps)} replayed swaps reproduced exactly, across ${n(p.poolsValidated)} pools. ` : ''
        }Read that number with its sample in mind: it rotates through the busiest pools we can replay, not the whole market, and it skips hooked pools entirely because those are priced by the chain rather than by us. Runs land between 75% and 100%. Where it falls short it is usually a pool whose liquidity history we only partly reconstructed, not the swap maths — but we publish the figure rather than the best one.`}
        why="Anyone can claim their simulation is accurate. This one is falsifiable against a contract nobody here controls, and it runs whether or not anyone is watching."
      />

      <Section
        num="03"
        title="Every venue a token has, including the strange ones"
        plain="A token usually trades in several pools at once. We quote all of them, split across two when that fills better, and route through the dollar when there is no direct pair."
        detail={`We cover Uniswap v3 fee tiers and v4 pools, and we read each pool's fee from the pool itself rather than assuming a standard tier. Most v4 pools here also charge a protocol fee on top of the advertised one — an extra sliver taken off what you put in, before the pool's own fee — and we fold it in using Uniswap's own formula, so the estimate is never rosier than the chain. Pools with a hook, custom code that runs during your swap and can change the outcome, are never guessed at: those go to the chain's own quoter, which actually executes the hook. Of ${n(p.pools)} pools indexed, ${n(p.v4Pools)} are v4 and ${n(p.hookedPools)} carry a hook.`}
        why="Quoting one pool when three exist means showing a worse price than you could have had, and guessing at a hook means being confidently wrong."
      />

      <Section
        num="04"
        title="It refuses rather than pretends"
        plain="Ask for more than a pool can absorb and you get 'only 38% of this fills', not an invented number. Practice orders are rejected on exactly the sizes that would fail for real."
        detail="The simulator stops when it runs out of liquidity it can actually see, and reports how much of your order filled — enforced on the server, not by a greyed-out button. Fees and price impact are two separate numbers, with the fee taken out of the impact figure, so a high-fee pool does not masquerade as a thin one. Where the quote comes from someone else — hooked pools priced by the chain, and Solana priced by Jupiter — we cannot measure a partial fill and do not pretend to: those are reported as filling completely."
        why="Reporting a full fill on size a pool cannot take is the most common way a paper-trading tool teaches a habit that costs real money later."
      />

      <Section
        num="05"
        title="Your bag is worth what someone would pay for it"
        plain="Positions are valued by quoting the sale of the whole bag, right now, through real liquidity — not by multiplying quantity by the last chart price."
        detail="Because the engine knows the state a pool is left in after a trade, it can immediately quote selling the position straight back. The difference between the chart-price value and that number is what the marked value overstates. Profit is reconstructed by replaying every trade with a cost basis, and where a wallet sold a bag it bought before our records begin, the position is flagged as partial instead of counted as pure profit."
        why="This is the mechanism behind being up 540% on screen and getting out at a loss. Impact on the way in does not refund itself."
      />

      <Section
        num="06"
        title="The index trusts nothing it has not verified"
        plain="Pools are found by watching the entire chain for trades, so a new pool appears seconds after its first swap, with no listing step and nobody to ask. Then every one is checked against Uniswap's own factory before it counts."
        detail={`Anyone can deploy a contract that emits the same events as a real pool — that is how fake volume and fake charts are made. Verification is a badge nowhere and a filter in about twenty different queries: ${n(p.pools - p.verifiedPools)} of ${n(p.pools)} indexed pools are recorded but kept out of the tape, the fresh-pool feed, the market stats, every alert, profit and loss, and the trade button. When a value cannot be read, we store nothing rather than a placeholder, because a guessed decimal place is a price wrong by a factor of a trillion.`}
        why="A screener that counts fake volume points you at the pool most likely to take your money."
      />

      <Section
        num="07"
        title="Alerts with their thresholds written down"
        plain="Three things, straight from the ledger: liquidity pulled, price dumped, volume surged. The triggers are published so you can decide whether they match your risk."
        detail="Liquidity pulled fires when a single withdrawal removes half or more of a pool's depth. A dump is a price down more than half against three hours ago, with real volume behind it. A surge is thirty minutes of volume at four times the previous thirty. Bad news is guaranteed up to 60% of the feed, so a busy day of green cannot bury a pool draining."
        why="A black-box signal cannot be reasoned about. A published threshold can be argued with, which is the point."
      />

      <Section
        num="08"
        title="The same engine, pointed at other chains"
        plain="Robinhood Chain and PancakeSwap on BNB Chain are quoted by our own engine. Solana goes through Jupiter, and on BNB Chain we take KyberSwap's route when it genuinely fills better."
        detail="The comparison is apples to apples: the same dollar amount into the same asset on each chain, scored by what you actually end up holding rather than by advertised fees. The runner-up route is shown beside the winner."
        why="Cost is not the fee. It is the fee plus impact plus spread, and only the final holding tells you which chain was cheaper."
      />

      <section className="card-flat p-6">
        <div className="label">Where we are honest</div>
        <h2 className="mt-1 text-[22px] font-semibold tracking-tight">The limits, on the same page as the claims</h2>
        <ul className="mt-4 space-y-3 text-[14.5px] text-muted">
          <li>
            <span className="font-semibold text-ink">A quote is a photograph of one block.</span> It does not model the traders who
            arrive before you, or anyone sandwiching your order. The engine is exact about the pool; the pool is not the whole world.
          </li>
          <li>
            <span className="font-semibold text-ink">We read a wide slice of the liquidity ladder, not an infinite one.</span> For
            most pools that covers the entire realistic price range. On the very tightest it is roughly a 13% move, and a swap that
            would walk past it is reported as a partial fill rather than extrapolated.
          </li>
          <li>
            <span className="font-semibold text-ink">Verified means real, not safe.</span> On v4 it means the official contract
            announced the pool. It says nothing about whether that pool&rsquo;s hook will treat you well, and we flag hooks rather
            than vouch for them.
          </li>
          <li>
            <span className="font-semibold text-ink">On hooked pools, two of our numbers go blind.</span> The chain&rsquo;s quoter
            tells us what you would receive but not where the pool ends up, so &ldquo;moves the pool&rdquo; and
            &ldquo;sold right back&rdquo; cannot be measured there. Treat a near-zero price move on a hooked pool as unknown
            rather than as good news.
          </li>
          <li>
            <span className="font-semibold text-ink">Times on fills are interpolated between real block headers</span>, so
            &ldquo;three minutes ago&rdquo; is accurate to a few seconds rather than to the second.
          </li>
          <li>
            <span className="font-semibold text-ink">Practice balances are not money</span>, and nothing here is financial advice.
            We never hold your keys or your funds: real trades are signed in your own wallet.
          </li>
        </ul>
      </section>

      <section>
        <div className="label">Right now, from our own ledger</div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat value={n(p.pools)} label="pools indexed" sub={`${n(p.v3Pools)} v3 · ${n(p.v4Pools)} v4`} />
          <Stat value={n(p.verifiedPools)} label="factory verified" sub={`${n(p.pools - p.verifiedPools)} excluded`} />
          <Stat value={n(p.tokens)} label="tokens known" />
          <Stat value={p.fills24h > 0 ? n(p.fills24h) : '—'} label="fills recorded · 24h" />
          <Stat
            value={p.exactPct === null ? '—' : `${p.exactPct.toFixed(1)}%`}
            label="replays exact"
            sub={p.lastValidatedAt ? `checked ${timeAgo(p.lastValidatedAt)} ago` : 'first check pending'}
          />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <Link href="/" className="btn btn-primary">
          See it on a live token
        </Link>
        <Link href="/tape" className="btn btn-ghost">
          Watch the tape
        </Link>
        <Link href="/docs" className="btn btn-ghost">
          Use the API
        </Link>
        <span className="text-[12.5px] text-faint">Every number above is produced by the same engine the API serves.</span>
      </section>
    </div>
  )
}

function Section({ num, title, plain, detail, why }: { num: string; title: string; plain: string; detail: React.ReactNode; why: string }) {
  return (
    <section className="grid gap-x-8 gap-y-3 border-t border-line pt-6 lg:grid-cols-[auto_1fr_18rem]">
      <div className="num text-[13px] text-faint lg:pt-1">{num}</div>
      <div className="space-y-2">
        <h2 className="text-[21px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[15px]">{plain}</p>
        <p className="text-[14px] text-muted">{detail}</p>
      </div>
      <aside className="text-[13.5px] text-muted lg:border-l lg:border-line lg:pl-6">
        <div className="label">Why it matters</div>
        <p className="mt-1">{why}</p>
      </aside>
    </section>
  )
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="card-flat p-4">
      <div className="num text-[20px] font-semibold">{value}</div>
      <div className="label mt-1">{label}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-faint">{sub}</div>}
    </div>
  )
}
