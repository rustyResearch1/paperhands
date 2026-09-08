'use client'

import { useMode } from '@/lib/mode'

export default function ModeSwitch() {
  const { mode, setMode } = useMode()
  return (
    <div className="seg" role="tablist" aria-label="Trading mode">
      <button role="tab" aria-selected={mode === 'practice'} onClick={() => setMode('practice')}>
        Practice
      </button>
      <button role="tab" aria-selected={mode === 'real'} onClick={() => setMode('real')}>
        Real
      </button>
    </div>
  )
}
