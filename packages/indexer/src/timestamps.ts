import type { ChainClient } from '@paperhands/chain'

/**
 * Block→timestamp estimator. Fetching headers for every block would be
 * thousands of RPC calls; instead anchor on two real headers and
 * interpolate, re-anchoring periodically. Candle bucketing tolerates
 * second-level error easily.
 */
export class BlockClock {
  private anchorBlock = 0n
  private anchorTs = 0
  private msPerBlock = 250
  private lastSync = 0

  constructor(private client: ChainClient) {}

  async sync(): Promise<void> {
    const latest = await this.client.getBlock({ blockTag: 'latest' })
    const span = 50_000n
    const past = await this.client.getBlock({
      blockNumber: latest.number > span ? latest.number - span : 1n,
    })
    const blocks = Number(latest.number - past.number)
    if (blocks > 0) {
      this.msPerBlock = (Number(latest.timestamp - past.timestamp) * 1000) / blocks
    }
    this.anchorBlock = latest.number
    this.anchorTs = Number(latest.timestamp)
    this.lastSync = Date.now()
  }

  needsSync(): boolean {
    return Date.now() - this.lastSync > 10 * 60 * 1000
  }

  /** Estimated unix seconds for a block. */
  estimate(block: bigint): number {
    const delta = Number(block - this.anchorBlock) * this.msPerBlock
    return Math.round(this.anchorTs + delta / 1000)
  }
}
