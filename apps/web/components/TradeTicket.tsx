'use client'

import PracticeTicket from '@/components/PracticeTicket'
import RealTicket from '@/components/RealTicket'
import { useMode } from '@/lib/mode'

interface Props {
  pool: string
  baseAddress: string
  baseSymbol: string
  baseDecimals: number
  balanceWei: string
  positionQty: string
}

/** One order sheet, two settlement layers: the paper ledger or the user's wallet. */
export default function TradeTicket(props: Props) {
  const { mode } = useMode()
  if (mode === 'real') {
    return <RealTicket pool={props.pool} baseAddress={props.baseAddress} baseSymbol={props.baseSymbol} baseDecimals={props.baseDecimals} />
  }
  return (
    <PracticeTicket
      pool={props.pool}
      baseSymbol={props.baseSymbol}
      baseDecimals={props.baseDecimals}
      balanceWei={props.balanceWei}
      positionQty={props.positionQty}
    />
  )
}
