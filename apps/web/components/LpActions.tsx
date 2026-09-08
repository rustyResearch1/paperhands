'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { EXPLORER_URL } from '@paperhands/chain'
import { buildClose, buildCollect, type LpLike } from '@/lib/lpexecute'

function shortError(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? 'failed'
  return m.split('\n')[0]!.slice(0, 120)
}

/** Collect fees or close a v3 position — one wallet signature each, nothing custodied. */
export default function LpActions({ p, hasFees, hasLiquidity }: { p: LpLike; hasFees: boolean; hasLiquidity: boolean }) {
  const { address } = useAccount()
  const qc = useQueryClient()
  const tx = useWriteContract()
  const receipt = useWaitForTransactionReceipt({ hash: tx.data })
  const [what, setWhat] = useState<'collect' | 'close' | null>(null)

  useEffect(() => {
    if (receipt.isSuccess) qc.invalidateQueries({ queryKey: ['lp', address] })
  }, [receipt.isSuccess, qc, address])

  if (!address) return null
  const busy = tx.isPending || (Boolean(tx.data) && receipt.isLoading)

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-1">
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy || !hasFees}
          onClick={() => {
            setWhat('collect')
            tx.writeContract(buildCollect(p, address))
          }}
        >
          Collect
        </button>
        <button
          className="btn btn-danger btn-sm"
          disabled={busy || (!hasLiquidity && !hasFees)}
          onClick={() => {
            setWhat('close')
            tx.writeContract(buildClose(p, address))
          }}
        >
          Close
        </button>
      </div>
      {tx.isPending && <span className="text-[11px] text-muted">Confirm in wallet…</span>}
      {tx.data && receipt.isLoading && <span className="text-[11px] text-muted">Confirming…</span>}
      {tx.data && receipt.isSuccess && (
        <a className="text-[11px] text-up hover:underline" href={`${EXPLORER_URL}/tx/${tx.data}`} target="_blank" rel="noreferrer">
          {what === 'close' ? 'Closed' : 'Collected'} ↗
        </a>
      )}
      {tx.error && <span className="max-w-[16rem] text-[11px] text-down">{shortError(tx.error)}</span>}
    </div>
  )
}
