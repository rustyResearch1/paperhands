'use client'

import { useMode } from '@/lib/mode'

/** Render the practice view or the real view depending on the mode switch. */
export default function ModeGate({ practice, real }: { practice: React.ReactNode; real: React.ReactNode }) {
  const { mode } = useMode()
  return <>{mode === 'real' ? real : practice}</>
}
