'use client'

import { useState } from 'react'

/** Contract / wallet address with a one-click copy — the "CA" every trencher pastes. */
export default function CopyAddress({ address, label, full, className }: { address: string; label?: string; full?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`
  return (
    <button
      type="button"
      className={`pill num ${copied ? 'pill-up' : ''} ${className ?? ''}`}
      title={`Copy ${address}`}
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(address)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {
          // clipboard blocked; the title still shows the address
        }
      }}
    >
      {copied ? 'copied ✓' : `${label ? `${label} ` : ''}${full ? address : short} ⧉`}
    </button>
  )
}
